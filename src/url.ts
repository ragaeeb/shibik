import { createHash } from 'node:crypto';
import path from 'node:path';

import { DUPLICATE_SEGMENTS, TRACKING_SUBSTRINGS } from '@/constants.js';

export const sanitizeSegment = (segment: string) => {
    let safe = segment;

    try {
        safe = decodeURIComponent(segment);
    } catch {
        safe = segment;
    }

    safe = safe.replace(/[<>:"|?*\x00-\x1F]/g, '_');
    if (safe === '.' || safe === '..') {
        safe = safe.replace(/\./g, '_');
    }
    return safe;
};

export const safeFilenameFromPath = (relPath: string) => {
    const ext = path.extname(relPath);
    const base = relPath.slice(0, relPath.length - ext.length);
    const hash = createHash('sha1').update(relPath).digest('hex').slice(0, 12);
    const flattenedBase = base.replace(/[\\/]+/g, '_').replace(/^_+|_+$/g, '');
    const safeBase = (flattenedBase || 'asset').slice(-80);
    return `${safeBase}_${hash}${ext || '.bin'}`;
};

export const shouldSkipUrl = (urlStr: string) => {
    if (urlStr.startsWith('data:') || urlStr.startsWith('blob:') || urlStr.startsWith('about:')) {
        return true;
    }
    if (urlStr.startsWith('chrome-extension:')) return true;
    if (/^https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink|1999\/xhtml)/i.test(urlStr)) return true;
    if (urlStr === 'http://' || urlStr === 'https://') return true;
    if (/^https?:\/\/fonts\.(gstatic|googleapis)\.com\/?$/i.test(urlStr)) return true;
    if (/[<>]/.test(urlStr) || /[{}]/.test(urlStr) || urlStr.includes('${') || urlStr.includes('#{')) {
        return true;
    }
    const lower = urlStr.toLowerCase();
    return TRACKING_SUBSTRINGS.some((sub) => lower.includes(sub));
};

export const normalizeEmbeddedUrl = (value: string) => {
    let cleaned = value.trim();
    cleaned = cleaned.replace(/^['"]|['"]$/g, '');
    cleaned = cleaned.replace(/&quot;|&#34;|&apos;|&#39;/gi, '');
    cleaned = cleaned.replace(/\\u002f/gi, '/');
    cleaned = cleaned.replace(/\\x2f/gi, '/');
    cleaned = cleaned.replace(/\\\//g, '/');
    cleaned = cleaned.replace(/\\\\/g, '\\');
    cleaned = cleaned.replace(/[),;]+$/g, '');
    cleaned = cleaned.replace(/\\+$/g, '');
    cleaned = cleaned.replace(/\s+/g, '');
    if (cleaned.includes('<') || cleaned.includes('>')) return '';
    if (/https?:\/\/.*https?:\/\//i.test(cleaned)) return '';
    if (/%22,%22|","/i.test(cleaned)) return '';
    if (/newblob\(|new\s*blob/i.test(cleaned)) return '';
    if (/application\/javascript|text\/javascript/i.test(cleaned)) return '';
    if (/image\/(png|jpe?g|webp|avif)/i.test(cleaned) && !/\.(png|jpe?g|webp|avif)(\?|#|$)/i.test(cleaned)) {
        return '';
    }
    return cleaned;
};

export const remapLocalhostUrl = (urlStr: string, origin: string) => {
    try {
        const url = new URL(urlStr);
        const host = url.hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
            const originUrl = new URL(origin);
            url.protocol = originUrl.protocol;
            url.hostname = originUrl.hostname;
            url.port = originUrl.port || '';
            url.host = originUrl.host;
            return url.toString();
        }
    } catch {
        return urlStr;
    }

    return urlStr;
};

export const hasAssetExtension = (urlStr: string) => {
    const lower = urlStr.toLowerCase();
    return /\.(avif|webp|png|jpg|jpeg|gif|svg|ico|apng|exr|hdr|mp4|webm|mp3|m4a|ogg|wav|glb|gltf|bin|ktx2|drc|riv|wasm|js|mjs|css|json|webmanifest|woff2?|ttf|otf|map)(\?|#|$)/.test(
        lower,
    );
};

export const looksLikeAssetUrl = (urlStr: string, originHost: string, requireAsset: boolean) => {
    if (shouldSkipUrl(urlStr)) return false;
    let host = '';
    let pathname = '';

    try {
        const url = new URL(urlStr);
        host = url.host;
        pathname = url.pathname;
    } catch {
        return false;
    }

    const hasAsset =
        hasAssetExtension(urlStr) ||
        /\/(assets|static|images|img|media|fonts|models|textures|files|website-files|cdn)\//i.test(pathname);

    if (requireAsset) {
        if (!hasAsset) return false;
        if (pathname.endsWith('/') && !hasAssetExtension(urlStr)) return false;
        return true;
    }

    if (host && host !== originHost) return hasAsset;
    return true;
};

export const escapeRegex = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const collapseDuplicateSegments = (urlStr: string) => {
    try {
        const url = new URL(urlStr);
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length < 2) return null;
        const collapsed: string[] = [];

        for (const part of parts) {
            if (collapsed.length && collapsed[collapsed.length - 1] === part && DUPLICATE_SEGMENTS.has(part)) {
                continue;
            }
            collapsed.push(part);
        }

        const newPath = `/${collapsed.join('/')}`;
        if (newPath === url.pathname) return null;
        url.pathname = newPath;
        return url.toString();
    } catch {
        return null;
    }
};
