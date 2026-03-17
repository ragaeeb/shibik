import path from 'node:path';

import { getApiMockLookupPaths, isResponseMockCandidate } from '@/api-mocks.js';
import { downloadWithBrowserFallback } from '@/browser-fallback.js';
import { directoryExists, ensureDir, isHtmlChallengeBody, pathExists } from '@/files.js';
import { log } from '@/logger.js';
import { stripUnsafeRequestHeaders } from '@/request-headers.js';
import { mapUrlToLocalPath } from '@/site-paths.js';
import { sleep } from '@/timing.js';
import type { Config, DownloadResult, DownloadSummary } from '@/types.js';
import { remapLocalhostUrl, shouldSkipUrl } from '@/url.js';

const htmlContentExtensions = new Set(['.html', '.htm', '.svg', '.xml']);

const getErrorMessage = (error: unknown) => {
    return error instanceof Error ? error.message : String(error);
};

const ensureDownloadDirectory = async (dir: string) => {
    if ((await pathExists(dir)) && !(await directoryExists(dir))) {
        return false;
    }

    await ensureDir(dir);
    return true;
};

const getCapturedHeaders = (urlStr: string, config: Config, originHost: string) => {
    if (!config.requestHeaders || config.requestHeaders.size === 0) {
        return null;
    }

    try {
        if (new URL(urlStr).host !== originHost) {
            return null;
        }
    } catch {
        return null;
    }

    return config.requestHeaders.get(urlStr) ?? null;
};

const buildRequestHeaders = (urlStr: string, config: Config, originHost: string) => {
    const baseHeaders: Record<string, string> = {
        Accept: '*/*',
        'User-Agent': config.userAgent,
    };

    if (config.cookieHeader && new URL(urlStr).host === originHost) {
        baseHeaders.Cookie = config.cookieHeader;
    }

    const captured = getCapturedHeaders(urlStr, config, originHost);
    const merged = captured ? { ...baseHeaders, ...stripUnsafeRequestHeaders(captured) } : baseHeaders;
    merged['User-Agent'] = config.userAgent;

    if (baseHeaders.Cookie) {
        merged.Cookie = baseHeaders.Cookie;
    }

    return merged;
};

const hasReusableDownload = async (absPath: string) => {
    const file = Bun.file(absPath);
    return (await file.exists()) && file.size > 0 && !(await isHtmlChallengeBody(absPath));
};

const hasStoredApiMock = async (urlStr: string, outDir: string, originHost: string) => {
    if (!isResponseMockCandidate(urlStr, originHost)) {
        return false;
    }

    try {
        const url = new URL(urlStr);
        for (const candidate of getApiMockLookupPaths(outDir, url.pathname, url.search)) {
            const file = Bun.file(candidate);
            if (await file.exists()) {
                return true;
            }
        }
    } catch {
        return false;
    }

    return false;
};

type DownloadResponseMeta = {
    absPath: string;
    contentRange: string;
    contentType: string;
    status: number;
};

export const validateDownloadResponseMeta = ({ absPath, contentRange, contentType, status }: DownloadResponseMeta) => {
    if (status === 206 || contentRange) {
        throw new Error('Partial content response');
    }

    const ext = path.extname(absPath).toLowerCase();
    if (contentType.includes('text/html') && ext && !htmlContentExtensions.has(ext)) {
        throw new Error(`HTML response for ${ext || 'asset'}`);
    }
};

const validateDownloadResponse = (absPath: string, response: Response) => {
    validateDownloadResponseMeta({
        absPath,
        contentRange: response.headers.get('content-range') || '',
        contentType: response.headers.get('content-type') || '',
        status: response.status,
    });
};

const writeDownloadResponse = async (absPath: string, response: Response) => {
    await Bun.write(absPath, response);
};

const cleanupDownloadFile = async (absPath: string) => {
    const file = Bun.file(absPath);
    if (await file.exists()) {
        await file.delete();
    }
};

const attemptDownload = async (urlStr: string, absPath: string, config: Config, originHost: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
        const response = await fetch(urlStr, {
            headers: buildRequestHeaders(urlStr, config, originHost),
            redirect: 'follow',
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        validateDownloadResponse(absPath, response);
        await writeDownloadResponse(absPath, response);
    } finally {
        clearTimeout(timeout);
    }
};

export const getWorkerCount = (itemCount: number, limit: number) => {
    if (itemCount <= 0) {
        return 0;
    }

    return Math.max(1, Math.min(limit, itemCount));
};

export const runWithConcurrency = async <T>(
    items: T[],
    limit: number,
    worker: (item: T, idx: number) => Promise<void>,
) => {
    const workerCount = getWorkerCount(items.length, limit);
    if (workerCount === 0) {
        return;
    }

    let index = 0;
    const workers = Array.from({ length: workerCount }, async () => {
        while (index < items.length) {
            const current = index++;
            await worker(items[current], current);
        }
    });

    await Promise.all(workers);
};

export const downloadUrl = async (
    inputUrl: string,
    config: Config,
    outDir: string,
    originHost: string,
): Promise<DownloadResult> => {
    const urlStr = remapLocalhostUrl(inputUrl, config.origin);
    if (shouldSkipUrl(urlStr)) {
        return 'skipped';
    }

    let absPath: string;
    try {
        ({ absPath } = mapUrlToLocalPath(urlStr, outDir, originHost));
    } catch (error: unknown) {
        log('WARN', `Invalid URL skipped: ${urlStr} (${getErrorMessage(error)})`);
        return 'failed';
    }

    try {
        if (!(await ensureDownloadDirectory(path.dirname(absPath)))) {
            return 'failed';
        }
    } catch (error: unknown) {
        log('WARN', `Directory create failed: ${path.dirname(absPath)} (${getErrorMessage(error)})`);
        return 'failed';
    }

    if (await hasReusableDownload(absPath)) {
        return 'skipped';
    }

    if (await hasStoredApiMock(urlStr, outDir, originHost)) {
        return 'skipped';
    }

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        try {
            await attemptDownload(urlStr, absPath, config, originHost);
            return 'downloaded';
        } catch (error: unknown) {
            await cleanupDownloadFile(absPath);
            if (attempt >= config.maxRetries) {
                log('WARN', `Download failed (${attempt}/${config.maxRetries}): ${urlStr} (${getErrorMessage(error)})`);
                return 'failed';
            }

            await sleep(300 * attempt);
        }
    }

    return 'failed';
};

export const downloadAll = async (
    urls: string[],
    config: Config,
    outDir: string,
    originHost: string,
): Promise<DownloadSummary> => {
    const unique = Array.from(new Set(urls));
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    const failedUrls: string[] = [];

    await runWithConcurrency(unique, config.concurrency, async (urlStr, idx) => {
        const result = await downloadUrl(urlStr, config, outDir, originHost);

        if (result === 'downloaded') {
            downloaded++;
        } else if (result === 'failed') {
            failed++;
            failedUrls.push(urlStr);
        } else {
            skipped++;
        }

        if (config.verbose && result === 'downloaded') {
            log('INFO', `Downloaded (${idx + 1}/${unique.length}): ${urlStr}`);
        } else if ((idx + 1) % 100 === 0) {
            log(
                'INFO',
                `Progress ${idx + 1}/${unique.length} (downloaded ${downloaded}, skipped ${skipped}, failed ${failed})`,
            );
        }
    });

    log('INFO', `Download complete. Downloaded ${downloaded}, skipped ${skipped}, failed ${failed}.`);
    return { downloaded, failed, failedUrls, skipped };
};

export const collectMissingDownloads = async (urls: string[], outDir: string, originHost: string, origin: string) => {
    const missing: string[] = [];
    const unique = Array.from(new Set(urls));

    for (const rawUrl of unique) {
        const urlStr = remapLocalhostUrl(rawUrl, origin);
        if (shouldSkipUrl(urlStr)) {
            continue;
        }

        if (await hasStoredApiMock(urlStr, outDir, originHost)) {
            continue;
        }

        let absPath: string;
        try {
            ({ absPath } = mapUrlToLocalPath(urlStr, outDir, originHost));
        } catch {
            continue;
        }

        if (!(await pathExists(absPath)) || (await directoryExists(absPath))) {
            missing.push(urlStr);
            continue;
        }

        const file = Bun.file(absPath);
        if (file.size === 0 || (await isHtmlChallengeBody(absPath))) {
            missing.push(urlStr);
        }
    }

    return missing;
};

export const downloadAllWithVerification = async (
    urls: string[],
    config: Config,
    outDir: string,
    originHost: string,
) => {
    const summary = await downloadAll(urls, config, outDir, originHost);
    let missing = await collectMissingDownloads(urls, outDir, originHost, config.origin);
    if (missing.length === 0) {
        return { ...summary, failed: 0, failedUrls: [] };
    }

    log('INFO', `Retrying ${missing.length} missing downloads.`);
    await downloadAll(missing, config, outDir, originHost);
    missing = await collectMissingDownloads(urls, outDir, originHost, config.origin);
    if (missing.length > 0) {
        await downloadWithBrowserFallback(missing, config, originHost);
        missing = await collectMissingDownloads(urls, outDir, originHost, config.origin);
    }

    return { ...summary, failed: missing.length, failedUrls: missing };
};
