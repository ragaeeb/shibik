import { createHash } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline/promises';

import { ensureDir, pathExists, writeTextFile } from '@/files.js';
import { log } from '@/logger.js';
import { resolvePathWithinRoot } from '@/path-safety.js';
import { hasAssetExtension } from '@/url.js';

export const isApiCandidate = (urlStr: string, originHost: string) => {
    try {
        const url = new URL(urlStr);
        return url.host === originHost && url.pathname.includes('/api/');
    } catch {
        return false;
    }
};

export const isResponseMockCandidate = (urlStr: string, originHost: string) => {
    try {
        const url = new URL(urlStr);
        return (
            url.host === originHost &&
            (url.pathname.includes('/api/') || (Boolean(url.search) && !hasAssetExtension(urlStr)))
        );
    } catch {
        return false;
    }
};

const isJsonContentType = (contentType: string) => {
    const lowered = contentType.toLowerCase();
    return lowered.includes('application/json') || lowered.includes('text/json') || lowered.includes('+json');
};

export const parseJsonBody = (body: string, contentType: string) => {
    const trimmed = body.trim();
    if (!trimmed) {
        return { ok: false as const };
    }

    const looksJson = isJsonContentType(contentType) || trimmed.startsWith('{') || trimmed.startsWith('[');
    if (!looksJson) {
        return { ok: false as const };
    }

    try {
        return { ok: true as const, value: JSON.parse(trimmed) as unknown };
    } catch {
        return { ok: false as const };
    }
};

const API_DEFAULT_FILE = '__default__.json';

const buildQueryFileName = (search: string) => {
    const hash = createHash('sha1').update(search).digest('hex').slice(0, 12);
    return `__query_${hash}.json`;
};

const normalizeApiPathname = (pathname: string) => {
    let normalized = pathname;
    if (!normalized.startsWith('/')) {
        normalized = `/${normalized}`;
    }

    if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }

    return normalized;
};

export const canonicalizeApiPathname = (pathname: string) => {
    const normalized = normalizeApiPathname(pathname);

    try {
        return encodeURI(decodeURI(normalized));
    } catch {
        return encodeURI(normalized);
    }
};

export const buildApiMockLookupKeys = (pathname: string, search = '') => {
    const normalized = normalizeApiPathname(pathname);
    const variants = new Set<string>([normalized, canonicalizeApiPathname(normalized)]);

    try {
        variants.add(decodeURI(normalized));
    } catch {
        // Ignore malformed percent-encoding and keep the normalized form.
    }

    return Array.from(variants).map((value) => `${value}${search}`);
};

const buildApiMockCacheKey = (pathname: string, search = '') => {
    return `${canonicalizeApiPathname(pathname)}${search}`;
};

const resolveApiMockDir = (outDir: string, pathname: string) => {
    const normalized = canonicalizeApiPathname(pathname);
    let filesystemPath = normalized;
    try {
        filesystemPath = decodeURI(normalized);
    } catch {
        filesystemPath = normalized;
    }

    return resolvePathWithinRoot(outDir, filesystemPath);
};

export const resolveApiMockPath = (outDir: string, pathname: string, search = '') => {
    const absDir = resolveApiMockDir(outDir, pathname);
    if (!absDir) {
        return null;
    }

    return path.join(absDir, search ? buildQueryFileName(search) : API_DEFAULT_FILE);
};

export const getApiMockLookupPaths = (outDir: string, pathname: string, search = '') => {
    const queryPath = search ? resolveApiMockPath(outDir, pathname, search) : null;
    const defaultPath = resolveApiMockPath(outDir, pathname);
    return Array.from(new Set([queryPath, defaultPath].filter((value): value is string => Boolean(value))));
};

const collectApiUrls = (failedUrls: string[], originHost: string) => {
    return Array.from(new Set(failedUrls.filter((urlStr) => isResponseMockCandidate(urlStr, originHost))));
};

const canPrompt = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

const writeApiMock = async (absPath: string, value: unknown, outDir: string) => {
    await ensureDir(path.dirname(absPath));
    await writeTextFile(absPath, `${JSON.stringify(value, null, 2)}\n`);
    log('INFO', `Wrote API mock: ${path.relative(outDir, absPath)}`);
};

export const storeApiMockValue = async (urlStr: string, value: unknown, outDir: string) => {
    let url: URL;
    try {
        url = new URL(urlStr);
    } catch {
        return false;
    }

    const absPath = resolveApiMockPath(outDir, url.pathname, url.search);
    if (!absPath) {
        return false;
    }

    if (await pathExists(absPath)) {
        return false;
    }

    await writeApiMock(absPath, value, outDir);
    return true;
};

export const storeCapturedApiResponse = async (
    urlStr: string,
    body: string,
    contentType: string,
    outDir: string,
    captured: Set<string>,
) => {
    let url: URL;
    try {
        url = new URL(urlStr);
    } catch {
        return false;
    }

    const cacheKey = buildApiMockCacheKey(url.pathname, url.search);
    if (captured.has(cacheKey)) {
        return false;
    }

    const parsed = parseJsonBody(body, contentType);
    if (!parsed.ok) {
        return false;
    }

    const stored = await storeApiMockValue(urlStr, parsed.value, outDir);
    if (stored) {
        captured.add(cacheKey);
    }

    return stored;
};

const readJsonInput = async (rl: readline.Interface) => {
    log('INFO', 'Paste JSON response. End with an empty line to finish (blank line first to skip).');
    process.stdout.write('> ');

    return await new Promise<string | null>((resolve) => {
        const lines: string[] = [];

        const cleanup = () => {
            rl.off('line', onLine);
            rl.off('close', onClose);
        };

        const finish = () => {
            cleanup();
            resolve(lines.length > 0 ? lines.join('\n') : null);
        };

        const onLine = (line: string) => {
            const trimmed = line.trim();
            if (trimmed === '') {
                finish();
                return;
            }

            lines.push(line);
            process.stdout.write('> ');
        };

        const onClose = () => {
            finish();
        };

        rl.on('line', onLine);
        rl.on('close', onClose);
    });
};

const promptForApiMock = async (rl: readline.Interface, urlStr: string, outDir: string, prompted: Set<string>) => {
    const url = new URL(urlStr);
    const key = buildApiMockCacheKey(url.pathname, url.search);
    if (prompted.has(key)) {
        return;
    }
    prompted.add(key);

    const absPath = resolveApiMockPath(outDir, url.pathname, url.search);
    if (!absPath || (await pathExists(absPath))) {
        return;
    }

    log('WARN', `API endpoint returned ${url.pathname}. Provide a mock JSON response to continue.`);
    const answer = await readJsonInput(rl);
    if (!answer) {
        return;
    }

    try {
        const parsed = JSON.parse(answer);
        await storeApiMockValue(urlStr, parsed, outDir);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log('WARN', `Invalid JSON for ${url.pathname}: ${message}`);
    }
};

export const promptForApiMocks = async (
    failedUrls: string[],
    outDir: string,
    originHost: string,
    prompted: Set<string>,
) => {
    const apiUrls = collectApiUrls(failedUrls, originHost);
    if (apiUrls.length === 0) {
        return;
    }

    if (!canPrompt()) {
        log('INFO', 'Skipping API mock prompt (no TTY).');
        return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        for (const urlStr of apiUrls) {
            await promptForApiMock(rl, urlStr, outDir, prompted);
        }
    } finally {
        rl.close();
    }
};
