import path from 'node:path';
import { promptForApiMocks } from '@/api-mocks.js';
import { findMissingAssets } from '@/browser.js';
import { REWRITE_FOLDERS } from '@/constants.js';
import { downloadAllWithVerification } from '@/download.js';
import { ensureDir, pathExists, writeLinesFile, writePlaceholderForMissing } from '@/files.js';
import { log } from '@/logger.js';
import { rewritePaths } from '@/rewrite.js';
import { getEntryDir, mapLocalTestUrlToPath, mapUrlToLocalPath } from '@/site-paths.js';
import type { Config } from '@/types.js';

const RECOVERY_ROOT_FOLDERS = ['v3', 'js', ...REWRITE_FOLDERS] as const;

const extractAssetRootPath = (pathname: string) => {
    let bestIndex = -1;

    for (const folder of RECOVERY_ROOT_FOLDERS) {
        const index = pathname.indexOf(`/${folder}/`);
        if (index <= 0) {
            continue;
        }

        if (bestIndex === -1 || index < bestIndex) {
            bestIndex = index;
        }
    }

    return bestIndex >= 0 ? pathname.slice(bestIndex) : null;
};

const buildCaptureByPath = (capturedUrls: string[]) => {
    const map = new Map<string, string>();

    for (const urlStr of capturedUrls) {
        try {
            const url = new URL(urlStr);
            if (!map.has(url.pathname)) {
                map.set(url.pathname, urlStr);
            }
        } catch {
            // Ignore malformed URLs surfaced during best-effort capture.
        }
    }

    return map;
};

const mapMissingToRemote = (
    missingUrl: string,
    origin: string,
    captureByPath: Map<string, string>,
    entryDir: string,
) => {
    if (missingUrl.startsWith('data:') || missingUrl.startsWith('blob:')) {
        return null;
    }

    const missing = new URL(missingUrl);
    const pathname = missing.pathname;
    const search = missing.search;
    const externalIndex = pathname.indexOf('/_external/');
    if (externalIndex >= 0) {
        const externalPath = pathname.slice(externalIndex);
        const parts = externalPath.split('/').filter(Boolean);
        const host = parts[1];
        const rest = parts.slice(2).join('/');
        if (host && rest) {
            return [`${new URL(origin).protocol}//${host}/${rest}${search}`];
        }
    }

    const candidates = new Set<string>();
    const captured = captureByPath.get(pathname);
    if (captured) {
        candidates.add(captured);
    }

    candidates.add(`${origin}${pathname}${search}`);
    if (entryDir !== '/' && pathname.startsWith(entryDir)) {
        candidates.add(`${origin}${pathname.slice(entryDir.length - 1)}${search}`);
    }

    const assetRootPath = extractAssetRootPath(pathname);
    if (assetRootPath) {
        candidates.add(`${origin}${assetRootPath}${search}`);
    }

    return Array.from(candidates);
};

const addKnownHost = (knownHosts: Set<string>, urlStr: string) => {
    try {
        knownHosts.add(new URL(urlStr).host);
    } catch {
        // Ignore malformed URLs surfaced during best-effort capture.
    }
};

const resolveMissingEntries = (
    missingList: string[],
    origin: string,
    captureByPath: Map<string, string>,
    entryDir: string,
) => {
    return missingList
        .map((localUrl) => ({
            localUrl,
            remoteUrls: mapMissingToRemote(localUrl, origin, captureByPath, entryDir) ?? [],
        }))
        .filter((entry) => entry.remoteUrls.length > 0);
};

const addRemoteHosts = (
    knownHosts: Set<string>,
    resolvedMissing: Array<{ localUrl: string; remoteUrls: string[] }>,
) => {
    const allRemote = new Set<string>();

    for (const entry of resolvedMissing) {
        for (const urlStr of entry.remoteUrls) {
            allRemote.add(urlStr);
            addKnownHost(knownHosts, urlStr);
        }
    }

    return Array.from(allRemote);
};

const writeRecoveryPlaceholders = async (
    resolvedMissing: Array<{ localUrl: string; remoteUrls: string[] }>,
    failedUrls: string[],
    outDir: string,
) => {
    const failedSet = new Set(failedUrls);

    for (const entry of resolvedMissing) {
        const unresolved = entry.remoteUrls.every((urlStr) => failedSet.has(urlStr));
        if (unresolved) {
            await writePlaceholderForMissing(entry.localUrl, outDir);
        }
    }
};

const copyResolvedMissing = async (
    resolvedMissing: Array<{ localUrl: string; remoteUrls: string[] }>,
    failedUrls: string[],
    outDir: string,
    originHost: string,
) => {
    const failedSet = new Set(failedUrls);

    for (const entry of resolvedMissing) {
        const targetPath = mapLocalTestUrlToPath(entry.localUrl, outDir);
        if (!targetPath || (await pathExists(targetPath))) {
            continue;
        }

        for (const urlStr of entry.remoteUrls) {
            if (failedSet.has(urlStr)) {
                continue;
            }

            try {
                const { absPath } = mapUrlToLocalPath(urlStr, outDir, originHost);
                const sourceFile = Bun.file(absPath);
                if (!(await sourceFile.exists())) {
                    continue;
                }

                await ensureDir(path.dirname(targetPath));
                await Bun.write(targetPath, sourceFile);
                break;
            } catch {}
        }
    }
};

export const runLocalRecovery = async (
    outDir: string,
    config: Config,
    capturedUrls: string[],
    origin: string,
    originHost: string,
    knownHosts: Set<string>,
    apiPrompted: Set<string>,
) => {
    if (!config.localTest) {
        return;
    }

    const captureByPath = buildCaptureByPath(capturedUrls);
    const entryDir = getEntryDir(config.entryPath);

    for (let round = 1; round <= config.localTestRounds; round++) {
        log('INFO', `Local 404 check round ${round}/${config.localTestRounds}...`);
        const missing = await findMissingAssets(outDir, config);
        if (missing.size === 0) {
            log('INFO', 'No missing assets detected.');
            return;
        }

        const missingList = Array.from(missing);
        await writeLinesFile(path.join(outDir, '.clone', `missing-round-${round}.txt`), missingList);

        const resolvedMissing = resolveMissingEntries(missingList, origin, captureByPath, entryDir);
        if (resolvedMissing.length === 0) {
            log('WARN', 'Missing assets detected, but no remote URLs resolved.');
            return;
        }

        const summary = await downloadAllWithVerification(
            addRemoteHosts(knownHosts, resolvedMissing),
            config,
            outDir,
            originHost,
        );

        await promptForApiMocks(summary.failedUrls, outDir, originHost, apiPrompted);

        if (summary.failedUrls.length > 0) {
            await writeRecoveryPlaceholders(resolvedMissing, summary.failedUrls, outDir);
        }

        await copyResolvedMissing(resolvedMissing, summary.failedUrls, outDir, originHost);

        if (config.rewrite) {
            await rewritePaths(outDir, originHost, knownHosts);
        }
    }
};
