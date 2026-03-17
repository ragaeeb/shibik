import path from 'node:path';

import { resolvePathWithinRoot } from '@/path-safety.js';
import { hasAssetExtension, safeFilenameFromPath, sanitizeSegment } from '@/url.js';

export type LocalPathMapping = {
    absPath: string;
    host: string;
    relPath: string;
};

export const mapUrlToLocalPath = (
    urlStr: string,
    outDir: string,
    originHost: string,
    _contentType?: string,
): LocalPathMapping => {
    const url = new URL(urlStr);
    const host = url.host;
    const isOrigin = host === originHost;
    const baseDir = isOrigin ? outDir : path.join(outDir, '_external', host);
    let pathname = url.pathname;

    if (!pathname || pathname === '/') {
        pathname = '/index.html';
    } else if (pathname.endsWith('/')) {
        pathname = `${pathname}index.html`;
    } else if (!path.extname(pathname) && isOrigin && !hasAssetExtension(urlStr)) {
        pathname = `${pathname}/index.html`;
    }

    const safeSegments = pathname.replace(/^\/+/, '').split('/').filter(Boolean).map(sanitizeSegment);
    const relPath = safeSegments.join(path.sep);
    let absPath = path.join(baseDir, relPath);
    let relFromOutDir = path.relative(outDir, absPath).replace(/\\/g, '/');

    if (absPath.length > 240 || relFromOutDir.length > 200) {
        const hashedName = safeFilenameFromPath(relPath);
        absPath = path.join(baseDir, '_long', hashedName);
        relFromOutDir = path.relative(outDir, absPath).replace(/\\/g, '/');
    }

    return {
        absPath,
        host,
        relPath: relFromOutDir,
    };
};

export const normalizeRelativeRef = (relPath: string) => {
    const normalized = relPath.replace(/\\/g, '/');
    if (!normalized || normalized === '.') {
        return '.';
    }

    return normalized.startsWith('.') ? normalized : `./${normalized}`;
};

export const withTrailingSlash = (relPath: string) => {
    return relPath === '.' ? './' : relPath.endsWith('/') ? relPath : `${relPath}/`;
};

export const getEntryDir = (entryPath: string) => {
    const entryUrl = new URL(entryPath, 'https://local.test');
    let pathname = entryUrl.pathname || '/';

    if (!pathname.endsWith('/')) {
        if (path.extname(pathname)) {
            pathname = pathname.replace(/\/[^/]*$/, '/');
        } else {
            pathname = `${pathname}/`;
        }
    }

    if (!pathname.startsWith('/')) {
        pathname = `/${pathname}`;
    }

    return pathname;
};

export const mapLocalTestUrlToPath = (urlStr: string, outDir: string) => {
    try {
        const url = new URL(urlStr);
        let pathname = decodeURIComponent(url.pathname);

        if (pathname.endsWith('/')) {
            pathname = `${pathname}index.html`;
        }

        if (!resolvePathWithinRoot(outDir, pathname)) {
            return null;
        }

        const safeSegments = pathname.replace(/^\/+/, '').split('/').filter(Boolean).map(sanitizeSegment);
        return resolvePathWithinRoot(outDir, safeSegments.join('/'));
    } catch {
        return null;
    }
};
