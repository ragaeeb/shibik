import path from 'node:path';

import { MARKUP_EXTENSIONS, REWRITE_FOLDERS, TEXT_EXTENSIONS } from '@/constants.js';
import { readTextFile, walkDir, writeTextFile } from '@/files.js';
import { log } from '@/logger.js';
import { normalizeRelativeRef, withTrailingSlash } from '@/site-paths.js';
import { escapeRegex } from '@/url.js';

type AliasPair = [string, string];

type RewriteTextInput = {
    aliasPairs: AliasPair[];
    content: string;
    filePath: string;
    knownHosts: Set<string>;
    originHost: string;
    outDir: string;
};

type HostPattern = {
    host: string;
    pattern: RegExp;
    protoLess: RegExp;
};

type AliasPattern = {
    pattern: RegExp;
};

type RewritePatternSet = {
    absFolderRegex: RegExp;
    aliasPatterns: AliasPattern[];
    baseHrefRegex: RegExp;
    cssAbsFolderRegex: RegExp;
    cssRelFolderRegex: RegExp;
    externalHosts: HostPattern[];
    originPattern: RegExp;
    originProtoLess: RegExp;
    relFolderRegex: RegExp;
    rootAttrRegex: RegExp;
    rootConcatRegex: RegExp;
};

type RewriteFileContext = {
    contentRootSlash: string;
    externalRootSlash: string;
    fileDir: string;
    filePath: string;
    fileToRootSlash: string;
    hostRootSlash: string;
    isExternal: boolean;
    isMarkup: boolean;
    outDir: string;
};

type RewriteResult = {
    content: string;
    modified: boolean;
};

const folderPattern = REWRITE_FOLDERS.map(escapeRegex).join('|');
const UMD_DEFINE_EXPORT_PATTERN =
    /"function"==typeof define\?define\(function\(\)\{return ([A-Za-z_$][\w$]*)\}\):e\.exports=\1/g;
const UMD_DEFINE_CHARCODE_PATTERN =
    /"f"==\(typeof define\)\[0\]\?define\(function\(\)\{return ([A-Za-z_$][\w$]*)\}\):e\.exports=\1/g;
const NEXT_MANIFEST_MARKER_PATTERN = /__BUILD_MANIFEST|__SSG_MANIFEST/;
const NEXT_MANIFEST_STATIC_PATTERN = /(["'`])(?:\.\.\/)+static\//g;
const FETCH_JSON_CONTENT_TYPE_PATTERN =
    /([A-Za-z_$][\w$]*)\.headers\.get\(["']Content-Type["']\)\s*==\s*["']application\/json["']/g;

const replaceIfMatched = (content: string, pattern: RegExp, replacement: string): RewriteResult => {
    if (!pattern.test(content)) {
        return { content, modified: false };
    }

    return {
        content: content.replace(pattern, replacement),
        modified: true,
    };
};

const applyHostRewrites = (
    content: string,
    patterns: RewritePatternSet,
    context: RewriteFileContext,
): RewriteResult => {
    let nextContent = content;
    let modified = false;

    const originResult = replaceIfMatched(nextContent, patterns.originPattern, context.contentRootSlash);
    nextContent = originResult.content;
    modified ||= originResult.modified;

    const protoLessResult = replaceIfMatched(nextContent, patterns.originProtoLess, context.contentRootSlash);
    nextContent = protoLessResult.content;
    modified ||= protoLessResult.modified;

    for (const hostPattern of patterns.externalHosts) {
        const externalReplacement = `${context.externalRootSlash}_external/${hostPattern.host}/`;
        const directResult = replaceIfMatched(nextContent, hostPattern.pattern, externalReplacement);
        nextContent = directResult.content;
        modified ||= directResult.modified;

        const protoResult = replaceIfMatched(nextContent, hostPattern.protoLess, externalReplacement);
        nextContent = protoResult.content;
        modified ||= protoResult.modified;
    }

    return { content: nextContent, modified };
};

const applyFolderRewrites = (
    content: string,
    patterns: RewritePatternSet,
    context: RewriteFileContext,
): RewriteResult => {
    let nextContent = content;
    let modified = false;
    const absoluteFolderRoot = context.isExternal ? context.hostRootSlash : context.contentRootSlash;

    for (const [pattern, replacement] of [
        [patterns.absFolderRegex, `$1${absoluteFolderRoot}$2/`],
        [patterns.cssAbsFolderRegex, `url($1${absoluteFolderRoot}$2/`],
    ] as const) {
        const result = replaceIfMatched(nextContent, pattern, replacement);
        nextContent = result.content;
        modified ||= result.modified;
    }

    if (context.isExternal) {
        return { content: nextContent, modified };
    }

    for (const [pattern, replacement] of [
        [patterns.relFolderRegex, `$1${context.contentRootSlash}$2/`],
        [patterns.cssRelFolderRegex, `url($1${context.contentRootSlash}$2/`],
    ] as const) {
        const result = replaceIfMatched(nextContent, pattern, replacement);
        nextContent = result.content;
        modified ||= result.modified;
    }

    return { content: nextContent, modified };
};

const applyAliasRewrites = (
    content: string,
    aliasPairs: AliasPair[],
    patterns: RewritePatternSet,
    context: RewriteFileContext,
): RewriteResult => {
    let nextContent = content;
    let modified = false;

    for (const [index, [, relPath]] of aliasPairs.entries()) {
        const rel = context.isMarkup
            ? `/${relPath.replace(/^\/+/, '')}`
            : normalizeRelativeRef(path.relative(context.fileDir, path.join(context.outDir, relPath)));
        const aliasPattern = patterns.aliasPatterns[index];
        if (!aliasPattern) {
            continue;
        }

        const result = replaceIfMatched(nextContent, aliasPattern.pattern, `$1${rel}`);
        nextContent = result.content;
        modified ||= result.modified;
    }

    return { content: nextContent, modified };
};

const applyMarkupRewrites = (
    content: string,
    patterns: RewritePatternSet,
    context: RewriteFileContext,
): RewriteResult => {
    if (!context.isMarkup) {
        return { content, modified: false };
    }

    let nextContent = content;
    let modified = false;

    const result = replaceIfMatched(nextContent, patterns.baseHrefRegex, `$1$2${context.contentRootSlash}$2`);
    nextContent = result.content;
    modified ||= result.modified;

    return { content: nextContent, modified };
};

const applyJavaScriptPatches = (content: string, filePath: string): RewriteResult => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.js' && ext !== '.mjs' && ext !== '.cjs') {
        return { content, modified: false };
    }

    let nextContent = content.replace(
        UMD_DEFINE_EXPORT_PATTERN,
        '("function"==typeof define&&define(function(){return $1}),e.exports=$1)',
    );
    nextContent = nextContent.replace(
        UMD_DEFINE_CHARCODE_PATTERN,
        '(("function"==typeof define||"f"==(typeof define)[0])&&define(function(){return $1}),e.exports=$1)',
    );
    const isNextManifest =
        filePath.includes(`${path.sep}_next${path.sep}static${path.sep}`) &&
        NEXT_MANIFEST_MARKER_PATTERN.test(nextContent);
    if (isNextManifest) {
        nextContent = nextContent.replace(NEXT_MANIFEST_STATIC_PATTERN, '$1static/');
    }

    nextContent = nextContent.replace(
        FETCH_JSON_CONTENT_TYPE_PATTERN,
        'String($1.headers.get("Content-Type")||"").includes("application/json")',
    );

    return {
        content: nextContent,
        modified: nextContent !== content,
    };
};

const createRewritePatterns = (
    originHost: string,
    knownHosts: Set<string>,
    aliasPairs: AliasPair[],
): RewritePatternSet => {
    const externalHosts = Array.from(knownHosts)
        .filter((host) => host && host !== originHost)
        .map((host) => ({
            host,
            pattern: new RegExp(`https?:\\/\\/${escapeRegex(host)}\\/`, 'g'),
            protoLess: new RegExp(`\\/\\/${escapeRegex(host)}\\/`, 'g'),
        }));

    return {
        absFolderRegex: new RegExp(`(['"\\x60])\\/(${folderPattern})\\/`, 'g'),
        aliasPatterns: aliasPairs.map(([base]) => ({
            pattern: new RegExp(`(['"\\x60])\\/${escapeRegex(base)}`, 'g'),
        })),
        baseHrefRegex: /(<base\b[^>]*\bhref=)(['"])(?!https?:|data:|mailto:|tel:)[^'"]*\2/gi,
        cssAbsFolderRegex: new RegExp(`url\\((['"]?)\\/(${folderPattern})\\/`, 'g'),
        cssRelFolderRegex: new RegExp(`url\\((['"]?)(${folderPattern})\\/`, 'g'),
        externalHosts,
        originPattern: new RegExp(`https?:\\/\\/${escapeRegex(originHost)}\\/`, 'g'),
        originProtoLess: new RegExp(`\\/\\/${escapeRegex(originHost)}\\/`, 'g'),
        relFolderRegex: new RegExp(`(['"\\x60])(${folderPattern})\\/`, 'g'),
        rootAttrRegex: /\b(href|src|action|content)=(['"])\/(?!\/)([^"'<>]+)\2/gi,
        rootConcatRegex: /(['"])\/\1(?=\s*\+)/g,
    };
};

const createRewriteFileContext = (filePath: string, outDir: string): RewriteFileContext => {
    const ext = path.extname(filePath).toLowerCase();
    const isMarkup = MARKUP_EXTENSIONS.has(ext);
    const fileDir = path.dirname(filePath);
    const fileToRootSlash = withTrailingSlash(normalizeRelativeRef(path.relative(fileDir, outDir)));
    const externalRoot = path.join(outDir, '_external');
    const relativeToExternal = path.relative(externalRoot, filePath);
    const externalParts = relativeToExternal.startsWith('..') ? [] : relativeToExternal.split(path.sep).filter(Boolean);
    const externalHost = externalParts[0];
    const isExternal = Boolean(externalHost);
    const hostRootFs = isExternal ? path.join(externalRoot, externalHost) : outDir;
    const hostRootSlash = withTrailingSlash(normalizeRelativeRef(path.relative(fileDir, hostRootFs)));

    return {
        contentRootSlash: isMarkup ? '/' : fileToRootSlash,
        externalRootSlash: isMarkup ? '/' : fileToRootSlash,
        fileDir,
        filePath,
        fileToRootSlash,
        hostRootSlash,
        isExternal,
        isMarkup,
        outDir,
    };
};

const applyRewritePipeline = (
    content: string,
    aliasPairs: AliasPair[],
    patterns: RewritePatternSet,
    context: RewriteFileContext,
): RewriteResult => {
    const hostResult = applyHostRewrites(content, patterns, context);
    const folderResult = applyFolderRewrites(hostResult.content, patterns, context);
    const aliasResult = applyAliasRewrites(folderResult.content, aliasPairs, patterns, context);
    const markupResult = applyMarkupRewrites(aliasResult.content, patterns, context);
    const jsPatchResult = applyJavaScriptPatches(markupResult.content, context.filePath);

    return {
        content: jsPatchResult.content,
        modified:
            hostResult.modified ||
            folderResult.modified ||
            aliasResult.modified ||
            markupResult.modified ||
            jsPatchResult.modified,
    };
};

export const buildAliasMap = (outDir: string): AliasPair[] => {
    const aliasRoots = new Set<string>(REWRITE_FOLDERS);
    const aliasMap = new Map<string, string | null>();

    for (const file of walkDir(outDir)) {
        const rel = path.relative(outDir, file).replace(/\\/g, '/');
        const parts = rel.split('/');
        const first = parts[0];
        if (!first || !aliasRoots.has(first)) {
            continue;
        }

        const base = path.basename(rel);
        if (!aliasMap.has(base)) {
            aliasMap.set(base, rel);
        } else if (aliasMap.get(base) !== rel) {
            aliasMap.set(base, null);
        }
    }

    return Array.from(aliasMap.entries()).filter((entry): entry is AliasPair => typeof entry[1] === 'string');
};

export const rewriteTextContent = ({
    aliasPairs,
    content,
    filePath,
    knownHosts,
    originHost,
    outDir,
}: RewriteTextInput) => {
    return applyRewritePipeline(
        content,
        aliasPairs,
        createRewritePatterns(originHost, knownHosts, aliasPairs),
        createRewriteFileContext(filePath, outDir),
    );
};

export const rewritePaths = async (outDir: string, originHost: string, knownHosts: Set<string>) => {
    const aliasPairs = buildAliasMap(outDir);
    const patterns = createRewritePatterns(originHost, knownHosts, aliasPairs);
    let modifiedFiles = 0;

    for (const file of walkDir(outDir)) {
        const ext = path.extname(file).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) {
            continue;
        }

        let content: string;
        try {
            content = await readTextFile(file);
        } catch (error) {
            log(
                'WARN',
                `Skipping unreadable file during rewrite: ${path.relative(outDir, file)} (${error instanceof Error ? error.message : String(error)})`,
            );
            continue;
        }

        const result = applyRewritePipeline(content, aliasPairs, patterns, createRewriteFileContext(file, outDir));
        if (!result.modified) {
            continue;
        }

        await writeTextFile(file, result.content);
        modifiedFiles++;
    }

    log('INFO', `Rewrote paths in ${modifiedFiles} files.`);
};
