import path from 'node:path';

import type { HTTPResponse, Page } from 'puppeteer';
import puppeteer from 'puppeteer';

import { isResponseMockCandidate, storeCapturedApiResponse } from '@/api-mocks.js';
import { writeCapturedResponse } from '@/captured-responses.js';
import { ensureDir } from '@/files.js';
import { log } from '@/logger.js';
import { mapUrlToLocalPath } from '@/site-paths.js';
import type { Config } from '@/types.js';
import { hasAssetExtension, shouldSkipUrl } from '@/url.js';

const stripFallbackHeaders = (headers: Record<string, string>) => {
    const blocked = new Set(['accept-encoding', 'connection', 'content-length', 'host', 'user-agent']);

    return Object.fromEntries(
        Object.entries(headers).filter(
            ([key, value]) => Boolean(value) && !key.startsWith(':') && !blocked.has(key.toLowerCase()),
        ),
    );
};

const buildFallbackHeaders = (urlStr: string, config: Config, originHost: string) => {
    const captured = config.requestHeaders.get(urlStr) ?? {};
    const headers: Record<string, string> = {
        Accept: '*/*',
        Referer: config.url,
        ...stripFallbackHeaders(captured),
    };

    if (new URL(urlStr).host === originHost && config.cookieHeader) {
        headers.Cookie = config.cookieHeader;
    }

    return headers;
};

const isBrowserFallbackCandidate = (urlStr: string, config: Config, originHost: string) => {
    if (shouldSkipUrl(urlStr)) {
        return false;
    }

    try {
        const url = new URL(urlStr);
        return url.host === originHost || config.requestHeaders.has(urlStr);
    } catch {
        return false;
    }
};

const isValidFallbackResponse = (urlStr: string, response: HTTPResponse) => {
    if (!response.ok()) {
        return false;
    }

    const contentType = (response.headers()['content-type'] ?? '').toLowerCase();
    return !(contentType.includes('text/html') && hasAssetExtension(urlStr));
};

export const extractDataUrlPayload = (value: string) => {
    const commaIndex = value.indexOf(',');
    if (commaIndex < 0) {
        return null;
    }

    return value.slice(commaIndex + 1);
};

export const isValidFetchedContent = (urlStr: string, contentType: string) => {
    return !(contentType.toLowerCase().includes('text/html') && hasAssetExtension(urlStr));
};

const fetchTextWithPageContext = (page: Page, urlStr: string) => {
    return page.evaluate(async (targetUrl) => {
        const response = await fetch(targetUrl, {
            cache: 'no-store',
            credentials: 'include',
        });

        return {
            body: await response.text(),
            contentType: response.headers.get('content-type') ?? '',
            ok: response.ok,
            status: response.status,
        };
    }, urlStr);
};

const fetchBinaryWithPageContext = (page: Page, urlStr: string) => {
    return page.evaluate(async (targetUrl) => {
        const response = await fetch(targetUrl, {
            cache: 'no-store',
            credentials: 'include',
        });
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(reader.error ?? new Error('Failed to read response blob.'));
            reader.readAsDataURL(blob);
        });

        return {
            contentType: response.headers.get('content-type') ?? '',
            dataUrl,
            ok: response.ok,
            status: response.status,
        };
    }, urlStr);
};

const writeBinaryFetchResult = async (urlStr: string, dataUrl: string, config: Config, originHost: string) => {
    const base64 = extractDataUrlPayload(dataUrl);
    if (!base64) {
        return false;
    }

    const { absPath } = mapUrlToLocalPath(urlStr, config.outDir, originHost);
    await ensureDir(path.dirname(absPath));
    await Bun.write(absPath, Buffer.from(base64, 'base64'));
    return true;
};

const downloadWithPageFetch = async (page: Page, urlStr: string, config: Config, originHost: string) => {
    if (isResponseMockCandidate(urlStr, originHost)) {
        const response = await fetchTextWithPageContext(page, urlStr);
        if (!response.ok || !isValidFetchedContent(urlStr, response.contentType)) {
            return false;
        }

        return await storeCapturedApiResponse(urlStr, response.body, response.contentType, config.outDir, new Set());
    }

    const response = await fetchBinaryWithPageContext(page, urlStr);
    if (!response.ok || !isValidFetchedContent(urlStr, response.contentType)) {
        return false;
    }

    return await writeBinaryFetchResult(urlStr, response.dataUrl, config, originHost);
};

const downloadWithNavigation = async (page: Page, urlStr: string, config: Config, originHost: string) => {
    await page.setExtraHTTPHeaders(buildFallbackHeaders(urlStr, config, originHost));
    const response = await page.goto(urlStr, {
        timeout: config.timeoutMs,
        waitUntil: 'load',
    });
    if (!response || !isValidFallbackResponse(urlStr, response)) {
        return false;
    }

    if (isResponseMockCandidate(urlStr, originHost)) {
        return await storeCapturedApiResponse(
            urlStr,
            await response.text(),
            response.headers()['content-type'] ?? '',
            config.outDir,
            new Set(),
        );
    }

    return await writeCapturedResponse(response, config.outDir, originHost);
};

export const downloadWithBrowserFallback = async (urls: string[], config: Config, originHost: string) => {
    const candidates = Array.from(
        new Set(urls.filter((urlStr) => isBrowserFallbackCandidate(urlStr, config, originHost))),
    );
    if (candidates.length === 0) {
        return [];
    }

    log('INFO', `Browser fallback for ${candidates.length} protected downloads.`);
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: config.headless,
    });

    try {
        const page = await browser.newPage();
        const navigationPage = await browser.newPage();
        await page.setUserAgent({ userAgent: config.userAgent });
        await navigationPage.setUserAgent({ userAgent: config.userAgent });
        await page
            .goto(config.url, {
                timeout: config.timeoutMs,
                waitUntil: 'domcontentloaded',
            })
            .catch(() => null);
        const failed: string[] = [];

        for (const urlStr of candidates) {
            try {
                const ok =
                    new URL(urlStr).host === originHost
                        ? await downloadWithPageFetch(page, urlStr, config, originHost)
                        : await downloadWithNavigation(navigationPage, urlStr, config, originHost);
                if (!ok) {
                    failed.push(urlStr);
                }
            } catch {
                failed.push(urlStr);
            }
        }

        return failed;
    } finally {
        await browser.close();
    }
};
