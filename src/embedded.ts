import path from 'node:path';
import { readdir } from 'node:fs/promises';

import { EMBEDDED_ASSET_FOLDERS, TEXT_EXTENSIONS } from '@/constants.js';
import { directoryExists, readTextFile, walkDirWithSkips } from '@/files.js';
import { getEntryDir } from '@/site-paths.js';
import { collapseDuplicateSegments, looksLikeAssetUrl, normalizeEmbeddedUrl, remapLocalhostUrl } from '@/url.js';

type EmbeddedContentInput = {
    content: string;
    entryPath: string;
    fileRelativeDir: string;
    origin: string;
};

type EmbeddedContext = {
    appBase: URL;
    base: URL;
    preferNextStatic: boolean;
    origin: string;
    originHost: string;
    protocol: string;
    urls: Set<string>;
};

type NestedOverrideResult = {
    extraUrls: Set<string>;
    overrides: Map<string, string>;
};

const assetFolderPattern = EMBEDDED_ASSET_FOLDERS.join('|');
const embeddedAssetFolderSet = new Set<string>(EMBEDDED_ASSET_FOLDERS);
const embeddedAssetExtensionPattern =
    'avif|webp|png|jpe?g|gif|svg|mp3|m4a|ogg|wav|mp4|webm|glb|gltf|bin|ktx2|drc|hdr|exr|json|riv|wasm|js|mjs|css|woff2?|ttf|otf|ico|webmanifest|map';
const urlRegex = /(https?:\/\/[^\s"'`)\]]+|\/\/[^\s"'`)\]]+)/g;
const relRegex = new RegExp(
    `(['"\\x60])((?:\\.{0,2}\\/|\\/)[^'"\\x60\\s]+?\\.(?:${embeddedAssetExtensionPattern})(?:\\?[^'"\\x60]*)?)(?=\\1)`,
    'gi',
);
const bareAssetRegex = new RegExp(
    `(['"\\x60])((?:${assetFolderPattern})\\/[^'"\\x60\\s]+?\\.(?:${embeddedAssetExtensionPattern})(?:\\?[^'"\\x60]*)?)(?=\\1)`,
    'gi',
);
const assetPrefixRegex = new RegExp(`(['"\\x60])((?:${assetFolderPattern})\\/)(?=\\1)`, 'gi');
const assetFilenameRegex = new RegExp(
    `(['"\\x60])([a-z0-9][a-z0-9._-]{2,}\\.(?:${embeddedAssetExtensionPattern}))(?:[?#][^'"\\x60]*)?(?=\\1)`,
    'gi',
);
const cssUrlRegex = /(?:^|[\s:;,])url\(([^)]+)\)/gi;
const srcsetRegex = /\bsrcset\s*=\s*(['"])([^'"]+)\1/gi;

const createEmbeddedContext = ({
    content,
    entryPath,
    fileRelativeDir,
    origin,
}: EmbeddedContentInput): EmbeddedContext => {
    const originUrl = new URL(origin);
    const normalizedDir = fileRelativeDir.replace(/\\/g, '/');
    const isNextStaticDir = normalizedDir === '_next/static' || normalizedDir.startsWith('_next/static/');
    const preferNextStatic = isNextStaticDir && /__BUILD_MANIFEST|__SSG_MANIFEST/i.test(content);
    return {
        appBase: new URL(`${origin}${getEntryDir(entryPath)}`),
        base: new URL(`${origin}/${fileRelativeDir ? `${fileRelativeDir}/` : ''}`),
        origin,
        originHost: originUrl.host,
        preferNextStatic,
        protocol: originUrl.protocol,
        urls: new Set<string>(),
    };
};

const rewriteNextStaticUrl = (urlStr: string, context: EmbeddedContext) => {
    if (!context.preferNextStatic) {
        return urlStr;
    }

    let url: URL;
    try {
        url = new URL(urlStr);
    } catch {
        return urlStr;
    }

    if (url.host !== context.originHost || !url.pathname.startsWith('/static/')) {
        return urlStr;
    }

    url.pathname = `/_next${url.pathname}`;
    return url.toString();
};

const addResolvedUrl = (candidateUrl: string | null, context: EmbeddedContext) => {
    if (!candidateUrl) {
        return;
    }

    const full = rewriteNextStaticUrl(remapLocalhostUrl(candidateUrl, context.origin), context);
    if (full.startsWith('./_external/') || full.startsWith('/_external/')) {
        return;
    }

    if (full.startsWith(context.origin) && full.includes('/_external/')) {
        return;
    }

    if (!looksLikeAssetUrl(full, context.originHost, true)) {
        return;
    }

    try {
        const host = new URL(full).host;
        if (host === 'localhost' || host.startsWith('127.0.0.1')) {
            return;
        }
    } catch {
        return;
    }

    context.urls.add(full);
    const deduped = collapseDuplicateSegments(full);
    if (deduped) {
        context.urls.add(deduped);
    }
};

const resolveCandidateUrl = (candidate: string, context: EmbeddedContext): string | null => {
    if (!candidate || candidate.startsWith('./_external/') || candidate.startsWith('/_external/')) {
        return null;
    }

    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
        return candidate;
    }

    if (candidate.startsWith('//')) {
        return `${context.protocol}${candidate}`;
    }

    if (candidate.startsWith('/')) {
        return `${context.origin}${candidate}`;
    }

    return new URL(candidate, context.base).toString();
};

const collectAbsoluteUrls = (content: string, context: EmbeddedContext) => {
    for (const match of content.matchAll(urlRegex)) {
        let candidate = normalizeEmbeddedUrl(match[1] ?? '');
        if (!candidate) {
            continue;
        }

        if (candidate.includes('http://') || candidate.includes('https://')) {
            const first = candidate.startsWith('http://') || candidate.startsWith('https://');
            if (!first && /https?:\/\//i.test(candidate)) {
                continue;
            }
        }

        if (candidate.startsWith('//')) {
            candidate = `${context.protocol}${candidate}`;
        }

        addResolvedUrl(candidate, context);
    }
};

const collectRelativeUrls = (content: string, context: EmbeddedContext) => {
    for (const match of content.matchAll(relRegex)) {
        const candidate = normalizeEmbeddedUrl(match[2] ?? '');
        addResolvedUrl(resolveCandidateUrl(candidate, context), context);
    }
};

const collectBareAssetUrls = (content: string, context: EmbeddedContext) => {
    for (const match of content.matchAll(bareAssetRegex)) {
        const candidate = normalizeEmbeddedUrl(match[2] ?? '');
        if (!candidate || candidate.startsWith('./') || candidate.startsWith('../') || candidate.startsWith('/')) {
            continue;
        }

        addResolvedUrl(new URL(candidate, context.appBase).toString(), context);
    }
};

const findUniqueNestedAssetChild = async (rootDir: string, childEntries: string[], candidateDir: string) => {
    const matchingChildren: string[] = [];
    for (const child of childEntries) {
        const childDir = path.join(rootDir, child);
        if (!(await directoryExists(childDir))) {
            continue;
        }

        const nestedTargetDir = path.join(childDir, candidateDir);
        if (await directoryExists(nestedTargetDir)) {
            matchingChildren.push(child);
        }
    }

    return matchingChildren.length === 1 ? matchingChildren[0] : null;
};

const buildNestedAssetPathInfo = ({
    candidate,
    child,
    entryPath,
    fileRelativeDir,
    origin,
    rootFolder,
}: {
    candidate: string;
    child: string;
    entryPath: string;
    fileRelativeDir: string;
    origin: string;
    rootFolder: string;
}) => {
    const resolvedPath = candidate.startsWith('./') || candidate.startsWith('../')
        ? new URL(candidate, `${origin}/${fileRelativeDir ? `${fileRelativeDir}/` : ''}`).pathname
        : new URL(candidate, `${origin}${getEntryDir(entryPath)}`).pathname;
    const relativePath = resolvedPath.replace(/^\/+/, '');
    if (!relativePath || relativePath.startsWith(`${rootFolder}/`)) {
        return null;
    }

    return {
        nestedUrl: new URL(`${rootFolder}/${child}/${relativePath}`, `${origin}/`).toString(),
        relativePath,
        rootUrl: new URL(resolvedPath, origin).toString(),
    };
};

const collectKtxModelVariantUrls = (url: string) => {
    if (!url.endsWith('-ktx.glb')) {
        return [];
    }

    return [url.replace(/-ktx\.glb$/, '-ktx-512.glb')];
};

const buildAssetNestedOverrides = async (
    outDir: string,
    origin: string,
    entryPath: string,
    fileRelativeDir: string,
    content: string,
) => {
    const result: NestedOverrideResult = {
        extraUrls: new Set<string>(),
        overrides: new Map<string, string>(),
    };
    const fileDirParts = fileRelativeDir.split('/').filter(Boolean);
    const rootFolder = fileDirParts[0];
    if (!rootFolder || !embeddedAssetFolderSet.has(rootFolder)) {
        return result;
    }

    const rootDir = path.join(outDir, rootFolder);
    let childEntries: string[];
    try {
        childEntries = await readdir(rootDir);
    } catch {
        return result;
    }

    const candidates = new Set<string>();
    for (const match of content.matchAll(bareAssetRegex)) {
        const candidate = normalizeEmbeddedUrl(match[2] ?? '');
        if (!candidate || candidate.startsWith('./') || candidate.startsWith('../') || candidate.startsWith('/')) {
            continue;
        }
        candidates.add(candidate);
    }

    for (const match of content.matchAll(relRegex)) {
        const candidate = normalizeEmbeddedUrl(match[2] ?? '');
        if (!candidate || (!candidate.startsWith('./') && !candidate.startsWith('../'))) {
            continue;
        }
        candidates.add(candidate);
    }

    for (const candidate of candidates) {
        const candidatePath = candidate.startsWith('./') || candidate.startsWith('../')
            ? new URL(candidate, `${origin}/${fileRelativeDir ? `${fileRelativeDir}/` : ''}`).pathname.replace(/^\/+/, '')
            : candidate;
        const candidateDir = path.dirname(candidatePath);
        const child = await findUniqueNestedAssetChild(rootDir, childEntries, candidateDir);
        if (!child) {
            continue;
        }

        const nestedInfo = buildNestedAssetPathInfo({
            candidate,
            child,
            entryPath,
            fileRelativeDir,
            origin,
            rootFolder,
        });
        if (!nestedInfo) {
            continue;
        }

        result.overrides.set(nestedInfo.rootUrl, nestedInfo.nestedUrl);
        for (const variantUrl of collectKtxModelVariantUrls(nestedInfo.nestedUrl)) {
            result.extraUrls.add(variantUrl);
        }
    }

    return result;
};

const collectAssetPrefixes = (content: string) => {
    const prefixes = new Set<string>();
    for (const match of content.matchAll(assetPrefixRegex)) {
        const candidate = normalizeEmbeddedUrl(match[2] ?? '');
        if (candidate) {
            prefixes.add(candidate);
        }
    }
    return prefixes;
};

const collectAssetFilenames = (content: string) => {
    const filenames = new Set<string>();
    for (const match of content.matchAll(assetFilenameRegex)) {
        const candidate = normalizeEmbeddedUrl(match[2] ?? '');
        if (candidate && !candidate.includes('/')) {
            filenames.add(candidate);
        }
    }
    return filenames;
};

const addCombinedAssetUrls = (context: EmbeddedContext, prefixes: Set<string>, filenames: Set<string>) => {
    let comboCount = 0;
    const comboLimit = 500;
    for (const prefix of prefixes) {
        for (const filename of filenames) {
            addResolvedUrl(new URL(`${prefix}${filename}`, context.appBase).toString(), context);
            comboCount++;
            if (comboCount >= comboLimit) {
                return;
            }
        }
    }
};

const collectCombinedAssetUrls = (content: string, context: EmbeddedContext) => {
    const prefixes = collectAssetPrefixes(content);
    const filenames = collectAssetFilenames(content);
    if (prefixes.size === 0 || filenames.size === 0) {
        return;
    }

    addCombinedAssetUrls(context, prefixes, filenames);
};

const collectCssUrls = (content: string, context: EmbeddedContext) => {
    for (const match of content.matchAll(cssUrlRegex)) {
        const prefix = content.slice(Math.max(0, (match.index ?? 0) - 8), match.index ?? 0).toLowerCase();
        if (/\bnew\s*$/.test(prefix)) {
            continue;
        }

        const candidate = normalizeEmbeddedUrl(match[1] ?? '');
        if (!candidate || candidate.startsWith('data:') || candidate.startsWith('#') || candidate.startsWith('var(')) {
            continue;
        }

        const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(candidate);
        const isBareLocalAsset =
            candidate.includes('.') && !hasScheme && !candidate.startsWith('/') && !candidate.startsWith('//');
        if (candidate.startsWith('./') || candidate.startsWith('../') || candidate.includes('/') || isBareLocalAsset) {
            addResolvedUrl(resolveCandidateUrl(candidate, context), context);
        }
    }
};

const collectListUrls = (entries: string[], context: EmbeddedContext) => {
    for (const entry of entries) {
        const candidate = normalizeEmbeddedUrl(entry);
        addResolvedUrl(resolveCandidateUrl(candidate, context), context);
    }
};

const extractBalancedFunctionBodies = (content: string, functionName: string) => {
    const bodies: string[] = [];
    const lower = content.toLowerCase();
    const needle = `${functionName.toLowerCase()}(`;
    let startIndex = 0;

    while (startIndex < lower.length) {
        const matchIndex = lower.indexOf(needle, startIndex);
        if (matchIndex < 0) {
            break;
        }

        let cursor = matchIndex + needle.length;
        let depth = 1;
        let quote: '"' | "'" | '`' | null = null;
        const bodyStart = cursor;

        while (cursor < content.length) {
            const char = content[cursor];
            if (quote) {
                if (char === '\\') {
                    cursor += 2;
                    continue;
                }

                if (char === quote) {
                    quote = null;
                }
                cursor++;
                continue;
            }

            if (char === '"' || char === "'" || char === '`') {
                quote = char;
                cursor++;
                continue;
            }

            if (char === '(') {
                depth++;
                cursor++;
                continue;
            }

            if (char === ')') {
                depth--;
                if (depth === 0) {
                    bodies.push(content.slice(bodyStart, cursor));
                    cursor++;
                    break;
                }
            }

            cursor++;
        }

        startIndex = cursor;
    }

    return bodies;
};

const splitTopLevelList = (value: string) => {
    const parts: string[] = [];
    let depth = 0;
    let quote: '"' | "'" | '`' | null = null;
    let segmentStart = 0;

    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if (quote) {
            if (char === '\\') {
                index++;
                continue;
            }

            if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            continue;
        }

        if (char === '(') {
            depth++;
            continue;
        }

        if (char === ')') {
            depth = Math.max(0, depth - 1);
            continue;
        }

        if (char === ',' && depth === 0) {
            parts.push(value.slice(segmentStart, index).trim());
            segmentStart = index + 1;
        }
    }

    const trailing = value.slice(segmentStart).trim();
    if (trailing) {
        parts.push(trailing);
    }

    return parts;
};

const collectSrcsetUrls = (content: string, context: EmbeddedContext) => {
    for (const match of content.matchAll(srcsetRegex)) {
        const entries = (match[2] ?? '')
            .split(',')
            .map((part) => part.trim())
            .map((entry) => entry.split(/\s+/)[0] ?? '');
        collectListUrls(entries, context);
    }
};

const collectImageSetUrls = (content: string, context: EmbeddedContext) => {
    for (const body of extractBalancedFunctionBodies(content, 'image-set')) {
        const entries = splitTopLevelList(body);
        const urls = entries.map((entry) => {
            const [urlBody] = extractBalancedFunctionBodies(entry, 'url');
            return urlBody ?? entry.split(/\s+/)[0] ?? '';
        });
        collectListUrls(urls, context);
    }
};

export const collectEmbeddedUrlsFromContent = (input: EmbeddedContentInput) => {
    const context = createEmbeddedContext(input);
    collectAbsoluteUrls(input.content, context);
    collectRelativeUrls(input.content, context);
    collectBareAssetUrls(input.content, context);
    collectCombinedAssetUrls(input.content, context);
    collectCssUrls(input.content, context);
    collectSrcsetUrls(input.content, context);
    collectImageSetUrls(input.content, context);
    return Array.from(context.urls);
};

export const collectEmbeddedUrls = async (outDir: string, origin: string, entryPath: string) => {
    const urls = new Set<string>();
    const entryDir = getEntryDir(entryPath);
    const entryDirFs = entryDir === '/' ? '' : entryDir.replace(/^\/+/, '');
    const rootNext = path.join(outDir, '_next');
    const entryNext = entryDirFs ? path.join(outDir, entryDirFs, '_next') : '';
    const skipEntryNext = entryNext && (await directoryExists(rootNext)) && (await directoryExists(entryNext));

    for (const file of walkDirWithSkips(outDir, new Set(['_external']))) {
        if (skipEntryNext && file.startsWith(entryNext + path.sep)) {
            continue;
        }
        const ext = path.extname(file).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) {
            continue;
        }

        let content: string;
        try {
            content = await readTextFile(file);
        } catch {
            continue;
        }

        const relDir = path.relative(outDir, path.dirname(file)).replace(/\\/g, '/');
        const nestedOverrides = await buildAssetNestedOverrides(
            outDir,
            origin,
            entryPath,
            relDir === '.' ? '' : relDir,
            content,
        );
        for (const url of collectEmbeddedUrlsFromContent({
            content,
            entryPath,
            fileRelativeDir: relDir === '.' ? '' : relDir,
            origin,
        })) {
            const override = nestedOverrides.overrides.get(url);
            if (override) {
                urls.add(override);
                continue;
            }
            urls.add(url);
        }
        for (const extraUrl of nestedOverrides.extraUrls) {
            urls.add(extraUrl);
        }
    }

    return Array.from(urls);
};
