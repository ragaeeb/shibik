import path from 'node:path';
import { getApiMockLookupPaths, isResponseMockCandidate } from '@/api-mocks.js';

import { directoryExists } from '@/files.js';
import { mapLocalTestUrlToPath } from '@/site-paths.js';

const localContentTypes: Record<string, string> = {
    '.avif': 'image/avif',
    '.bin': 'application/octet-stream',
    '.css': 'text/css',
    '.drc': 'application/octet-stream',
    '.exr': 'image/aces',
    '.gif': 'image/gif',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.hdr': 'image/vnd.radiance',
    '.htm': 'text/html',
    '.html': 'text/html',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.ktx2': 'image/ktx2',
    '.mjs': 'application/javascript',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.ogg': 'audio/ogg',
    '.otf': 'font/otf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
    '.webm': 'video/webm',
    '.webmanifest': 'application/manifest+json',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

const getRequestPath = (rootDir: string, pathname: string) => {
    const requestPathname = pathname;
    let normalizedPath = pathname;
    if (normalizedPath.endsWith('/')) {
        normalizedPath = `${normalizedPath}index.html`;
    }

    const filePath = mapLocalTestUrlToPath(`http://local.test${normalizedPath}`, rootDir);
    if (!filePath) {
        return null;
    }

    return { filePath, pathname: normalizedPath, requestPathname };
};

const resolveExistingFilePath = async (filePath: string) => {
    let resolvedPath = filePath;
    if (await directoryExists(resolvedPath)) {
        resolvedPath = path.join(resolvedPath, 'index.html');
    }

    const file = Bun.file(resolvedPath);
    if (!(await file.exists())) {
        return null;
    }

    return { file, filePath: resolvedPath };
};

const resolveApiMockFile = async (rootDir: string, requestUrl: string, pathname: string, search: string, method: string) => {
    if (!isResponseMockCandidate(requestUrl, new URL(requestUrl).host, method)) {
        return null;
    }

    for (const candidate of getApiMockLookupPaths(rootDir, pathname, search)) {
        const file = Bun.file(candidate);
        if (!(await file.exists())) {
            continue;
        }

        return { file, filePath: candidate };
    }

    return null;
};

const getContentType = (filePath: string, file: Bun.BunFile) => {
    const ext = path.extname(filePath).toLowerCase();
    return (localContentTypes[ext] ?? file.type) || 'application/octet-stream';
};

export const startStaticServer = (rootDir: string) => {
    return Bun.serve({
        fetch: async (req) => {
            const url = new URL(req.url);
            const requestPath = getRequestPath(rootDir, url.pathname);
            if (!requestPath) {
                return new Response('Forbidden', { status: 403 });
            }

            const resolvedFile =
                (await resolveExistingFilePath(requestPath.filePath)) ??
                (await resolveApiMockFile(rootDir, req.url, requestPath.requestPathname, url.search, req.method));
            if (!resolvedFile) {
                return new Response('Not Found', { status: 404 });
            }

            return new Response(resolvedFile.file, {
                headers: { 'Content-Type': getContentType(resolvedFile.filePath, resolvedFile.file) },
            });
        },
        port: 0,
    });
};
