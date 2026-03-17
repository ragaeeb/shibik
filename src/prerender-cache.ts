import path from 'node:path';

import { isResponseMockCandidate, storeApiMockValue } from '@/api-mocks.js';

const PRERENDER_CACHE_REGEX = /<script\b[^>]*\bid=(['"])rb3-prerender-data-cache\1[^>]*>([\s\S]*?)<\/script>/i;
const INLINE_CONTENT_PANEL_MODULE = 'rbgemc-rb3/inline-content-panel/inline-content-panel-controller';
const PAGE_CONFIG_GLOB = new Bun.Glob('v3/config/pages/**/*.json');

type PageConfigPanel = {
    config?: {
        endpoint?: string;
    };
    panelModule?: string;
};

type PrerenderEntry = [string, unknown];

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const extractPrerenderCacheEntries = (html: string) => {
    const match = PRERENDER_CACHE_REGEX.exec(html);
    if (!match?.[2]) {
        return [] as PrerenderEntry[];
    }

    try {
        const parsed = JSON.parse(match[2]) as unknown;
        if (!isPlainRecord(parsed)) {
            return [] as PrerenderEntry[];
        }

        return Object.entries(parsed).filter(
            (entry): entry is PrerenderEntry => typeof entry[0] === 'string' && entry[0].startsWith('/'),
        );
    } catch {
        return [] as PrerenderEntry[];
    }
};

const extractHtmlLang = (html: string) => {
    const match = html.match(/<html\b[^>]*\blang=(['"])([^'"]+)\1/i);
    return match?.[2]?.trim().toLowerCase() || 'en-us';
};

const normalizeLocale = (locale: string) => locale.trim().toLowerCase();

const getConfigPanels = (value: unknown) => {
    if (!isPlainRecord(value)) {
        return [] as PageConfigPanel[];
    }

    const data = value.data;
    if (!isPlainRecord(data)) {
        return [] as PageConfigPanel[];
    }

    const nested = data.data;
    if (!isPlainRecord(nested) || !Array.isArray(nested.panels)) {
        return [] as PageConfigPanel[];
    }

    return nested.panels.filter((panel): panel is PageConfigPanel => isPlainRecord(panel));
};

const getPageConfigLocale = (value: unknown) => {
    if (!isPlainRecord(value)) {
        return null;
    }

    const data = value.data;
    if (!isPlainRecord(data)) {
        return null;
    }

    const nested = data.data;
    if (!isPlainRecord(nested)) {
        return null;
    }

    const domainConfig = nested.domainConfig;
    if (!isPlainRecord(domainConfig) || !Array.isArray(domainConfig.supportedLocales)) {
        return null;
    }

    const [locale] = domainConfig.supportedLocales;
    return typeof locale === 'string' && locale.trim() ? normalizeLocale(locale) : null;
};

const buildInlineContentApiUrl = (endpoint: string, origin: string, locale: string) => {
    const trimmed = endpoint.trim();
    if (!trimmed.startsWith('/v3/query/')) {
        return null;
    }

    const url = new URL(`/v3/api/graphql/v1${trimmed}`, origin);
    if (!url.searchParams.has('rb3Schema')) {
        url.searchParams.set('rb3Schema', 'v1:inlineContent');
    }
    if (!url.searchParams.has('rb3Locale')) {
        url.searchParams.set('rb3Locale', locale);
    }

    return url.toString();
};

const collectInlineContentFallbackUrls = (value: unknown, origin: string, fallbackLocale: string) => {
    const urls = new Set<string>();
    const locale = getPageConfigLocale(value) ?? fallbackLocale;

    for (const panel of getConfigPanels(value)) {
        if (panel.panelModule !== INLINE_CONTENT_PANEL_MODULE) {
            continue;
        }

        const endpoint = panel.config?.endpoint;
        if (typeof endpoint !== 'string') {
            continue;
        }

        const inlineContentUrl = buildInlineContentApiUrl(endpoint, origin, locale);
        if (inlineContentUrl) {
            urls.add(inlineContentUrl);
        }
    }

    return Array.from(urls);
};

const EMPTY_INLINE_CONTENT_RESPONSE = {
    data: {
        data: {
            eligibleForPromotion: 'not-applicable',
            items: [],
        },
    },
};

const persistPanelFallbackMocks = async (html: string, origin: string, outDir: string) => {
    const locale = extractHtmlLang(html);
    const fallbackUrls = new Set<string>();

    for (const [, value] of extractPrerenderCacheEntries(html)) {
        for (const inlineContentUrl of collectInlineContentFallbackUrls(value, origin, locale)) {
            const stored = await storeApiMockValue(inlineContentUrl, EMPTY_INLINE_CONTENT_RESPONSE, outDir);
            if (stored) {
                fallbackUrls.add(inlineContentUrl);
            }
        }
    }

    return Array.from(fallbackUrls);
};

export const extractPrerenderRequestUrls = (html: string, origin: string) => {
    const urls = new Set<string>();

    for (const [requestPath] of extractPrerenderCacheEntries(html)) {
        urls.add(new URL(requestPath, origin).toString());
    }

    const locale = extractHtmlLang(html);
    for (const [, value] of extractPrerenderCacheEntries(html)) {
        for (const inlineContentUrl of collectInlineContentFallbackUrls(value, origin, locale)) {
            urls.add(inlineContentUrl);
        }
    }

    return Array.from(urls);
};

export const persistStoredPageConfigFallbackMocks = async (outDir: string, origin: string) => {
    const fallbackUrls = new Set<string>();

    for (const relativePath of PAGE_CONFIG_GLOB.scanSync({ absolute: false, cwd: outDir })) {
        const filePath = path.join(outDir, relativePath);

        try {
            const value = JSON.parse(await Bun.file(filePath).text()) as unknown;
            for (const inlineContentUrl of collectInlineContentFallbackUrls(value, origin, 'en-us')) {
                fallbackUrls.add(inlineContentUrl);
                await storeApiMockValue(inlineContentUrl, EMPTY_INLINE_CONTENT_RESPONSE, outDir);
            }
        } catch {
            // Ignore incomplete page config artifacts during best-effort fallback synthesis.
        }
    }

    return Array.from(fallbackUrls);
};

export const persistPrerenderCacheMocks = async (html: string, origin: string, outDir: string, originHost: string) => {
    for (const [requestPath, value] of extractPrerenderCacheEntries(html)) {
        const urlStr = new URL(requestPath, origin).toString();
        if (!isResponseMockCandidate(urlStr, originHost)) {
            continue;
        }

        await storeApiMockValue(urlStr, value, outDir);
    }

    await persistPanelFallbackMocks(html, origin, outDir);
};
