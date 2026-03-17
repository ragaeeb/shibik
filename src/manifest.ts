import path from 'node:path';

import { readTextFile, walkDir } from '@/files.js';

const MAX_SEQUENCE_FRAMES = 10_000;

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isStringArray = (value: unknown): value is string[] => {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
};

const looksLikeAssetPath = (value: string) => {
    const lower = value.toLowerCase();
    if (lower.startsWith('data:') || lower.startsWith('blob:')) {
        return false;
    }

    if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('//')) {
        return true;
    }

    if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) {
        return true;
    }

    if (value.startsWith('assets/') || value.startsWith('b/') || value.startsWith('preloader/')) {
        return true;
    }

    const extMatch = lower.match(/\.([a-z0-9]{2,8})(\?|#|$)/);
    return Boolean(extMatch);
};

const addAssetPath = (asset: string, assets: Set<string>) => {
    if (looksLikeAssetPath(asset)) {
        assets.add(asset);
    }
};

const stripRealExtension = (basePath: string) => {
    const match = basePath.match(/\.([a-z0-9]{2,8})(?=$|[?#])/i);
    if (!match) {
        return basePath;
    }

    if (/^n\d+$/i.test(match[1])) {
        return basePath;
    }

    return basePath.slice(0, -match[0].length);
};

const addAssetVariants = (basePath: string, variants: string[] | string, assets: Set<string>) => {
    const extensions = Array.isArray(variants) ? variants : [variants];
    const baseNoExt = stripRealExtension(basePath);

    for (const ext of extensions) {
        addAssetPath(`${baseNoExt}.${ext}`, assets);
    }
};

const tryAddTexturePackerAssets = (type: string, basePath: string, variants: unknown, assets: Set<string>) => {
    if (type !== 'texturePacker' || !(typeof variants === 'string' || isStringArray(variants))) {
        return false;
    }

    addAssetPath(`${basePath}.json`, assets);
    addAssetVariants(basePath, variants, assets);
    return true;
};

const tryAddSequenceAssets = (
    type: string,
    basePath: string,
    frameCount: unknown,
    variants: unknown,
    assets: Set<string>,
) => {
    if (type !== 'sequence' || typeof frameCount !== 'number' || !isStringArray(variants)) {
        return false;
    }

    addAssetVariants(basePath, variants, assets);
    const maxFrames = Math.max(0, Math.min(MAX_SEQUENCE_FRAMES, Math.floor(frameCount)));
    for (let index = 0; index < maxFrames; index++) {
        addAssetVariants(`${basePath}.n${index}`, variants, assets);
    }

    return true;
};

const tryAddVariantAssets = (basePath: string, variants: unknown, assets: Set<string>) => {
    if (isStringArray(variants) || typeof variants === 'string') {
        addAssetVariants(basePath, variants, assets);
        return true;
    }

    return false;
};

const handleManifestFileValue = (type: string, value: unknown, assets: Set<string>) => {
    if (typeof value === 'string') {
        addAssetPath(value, assets);
        return;
    }

    if (!Array.isArray(value) || typeof value[0] !== 'string') {
        extractManifestAssets(value, assets);
        return;
    }

    const basePath = value[0];
    if (tryAddTexturePackerAssets(type, basePath, value[3], assets)) {
        return;
    }

    if (tryAddSequenceAssets(type, basePath, value[1], value[2], assets)) {
        return;
    }

    if (tryAddVariantAssets(basePath, value[3], assets)) {
        return;
    }

    if (path.extname(basePath)) {
        addAssetPath(basePath, assets);
    }
};

const extractManifestAssets = (node: unknown, assets: Set<string>) => {
    if (!isObjectRecord(node)) {
        return;
    }

    const type = typeof node.type === 'string' ? node.type : '';
    const files = node.files;
    if (isObjectRecord(files)) {
        for (const value of Object.values(files)) {
            handleManifestFileValue(type, value, assets);
        }
    }

    for (const value of Object.values(node)) {
        extractManifestAssets(value, assets);
    }
};

const extractAssetsFromJson = (node: unknown, assets: Set<string>) => {
    if (typeof node === 'string') {
        addAssetPath(node, assets);
        return;
    }

    if (Array.isArray(node)) {
        const stringEntries = node.filter((value): value is string => typeof value === 'string');
        const extList = node.find(isStringArray);
        if (stringEntries.length > 0 && extList && extList.length > 0) {
            addAssetVariants(stringEntries[0], extList, assets);
        }

        for (const item of node) {
            extractAssetsFromJson(item, assets);
        }

        return;
    }

    if (!isObjectRecord(node)) {
        return;
    }

    for (const value of Object.values(node)) {
        extractAssetsFromJson(value, assets);
    }
};

export const collectManifestAssetPaths = (node: unknown) => {
    const assets = new Set<string>();
    extractManifestAssets(node, assets);
    extractAssetsFromJson(node, assets);
    return Array.from(assets);
};

export const resolveAssetUrl = (asset: string, manifestBaseUrl: string) => {
    if (asset.startsWith('http://') || asset.startsWith('https://')) {
        return asset;
    }

    if (asset.startsWith('//')) {
        return `${new URL(manifestBaseUrl).protocol}${asset}`;
    }

    if (asset.startsWith('/')) {
        return new URL(asset, manifestBaseUrl).toString();
    }

    if (asset.startsWith('./') || asset.startsWith('../')) {
        return new URL(asset, manifestBaseUrl).toString();
    }

    return new URL(asset, manifestBaseUrl).toString();
};

const getManifestBaseUrl = (outDir: string, filePath: string, origin: string) => {
    const relativeDir = path.relative(outDir, path.dirname(filePath)).replace(/\\/g, '/');
    const parts = relativeDir.split('/').filter(Boolean);

    if (parts[0] === '_external' && parts[1]) {
        const host = parts[1];
        const hostRelativeDir = parts.slice(2).join('/');
        const protocol = new URL(origin).protocol;
        return `${protocol}//${host}/${hostRelativeDir ? `${hostRelativeDir}/` : ''}`;
    }

    return new URL(relativeDir ? `${relativeDir}/` : '/', origin).toString();
};

export const collectManifestAssets = async (outDir: string, origin: string) => {
    const resolved = new Set<string>();

    for (const file of walkDir(outDir)) {
        const name = path.basename(file).toLowerCase();
        if (!name.includes('manifest') || (!name.endsWith('.json') && !name.endsWith('.webmanifest'))) {
            continue;
        }

        let json: unknown;
        try {
            json = JSON.parse(await readTextFile(file));
        } catch {
            continue;
        }

        const manifestBaseUrl = getManifestBaseUrl(outDir, file, origin);
        for (const asset of collectManifestAssetPaths(json)) {
            resolved.add(resolveAssetUrl(asset, manifestBaseUrl));
        }
    }

    return Array.from(resolved);
};
