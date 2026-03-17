import path from 'node:path';

import type { HTTPResponse } from 'puppeteer';

import { isApiCandidate } from '@/api-mocks.js';
import { ensureDir } from '@/files.js';
import { getHeaderValue, hasRangeRequestHeaders } from '@/request-headers.js';
import { mapUrlToLocalPath } from '@/site-paths.js';
import { looksLikeAssetUrl, shouldSkipUrl } from '@/url.js';

const PERSISTABLE_RESOURCE_TYPES = new Set(['font', 'image', 'manifest', 'media', 'other', 'script', 'stylesheet']);

const hasPersistableContentType = (contentType: string) => {
    const lowered = contentType.toLowerCase();
    return (
        lowered.includes('application/javascript') ||
        lowered.includes('text/javascript') ||
        lowered.includes('text/css') ||
        lowered.includes('application/json') ||
        lowered.includes('image/') ||
        lowered.includes('font/') ||
        lowered.includes('audio/') ||
        lowered.includes('video/') ||
        lowered.includes('model/') ||
        lowered.includes('application/wasm') ||
        lowered.includes('application/octet-stream') ||
        lowered.includes('application/manifest+json') ||
        lowered.includes('application/xml') ||
        lowered.includes('image/svg+xml')
    );
};

type CapturedResponseMeta = {
    method: string;
    originHost: string;
    requestHeaders: Record<string, string>;
    resourceType: string;
    responseHeaders: Record<string, string>;
    status: number;
    urlStr: string;
};

export const shouldPersistCapturedResponseMeta = ({
    method,
    originHost,
    requestHeaders,
    resourceType,
    responseHeaders,
    status,
    urlStr,
}: CapturedResponseMeta) => {
    if (shouldSkipUrl(urlStr) || isApiCandidate(urlStr, originHost)) {
        return false;
    }

    if (method !== 'GET') {
        return false;
    }

    if (status < 200 || status >= 300) {
        return false;
    }

    if (status === 206 || getHeaderValue(responseHeaders, 'content-range')) {
        return false;
    }

    if (hasRangeRequestHeaders(requestHeaders)) {
        return false;
    }

    if (resourceType === 'document' || resourceType === 'xhr' || resourceType === 'fetch') {
        return false;
    }

    const contentType = getHeaderValue(responseHeaders, 'content-type');
    if (contentType.toLowerCase().includes('text/html')) {
        return false;
    }

    return (
        PERSISTABLE_RESOURCE_TYPES.has(resourceType) ||
        hasPersistableContentType(contentType) ||
        looksLikeAssetUrl(urlStr, originHost, true)
    );
};

const shouldPersistCapturedResponse = (response: HTTPResponse, originHost: string) => {
    const request = response.request();

    return shouldPersistCapturedResponseMeta({
        method: request.method(),
        originHost,
        requestHeaders: request.headers(),
        resourceType: request.resourceType(),
        responseHeaders: response.headers(),
        status: response.status(),
        urlStr: response.url(),
    });
};

export const writeCapturedResponse = async (response: HTTPResponse, outDir: string, originHost: string) => {
    const urlStr = response.url();
    const { absPath } = mapUrlToLocalPath(urlStr, outDir, originHost, response.headers()['content-type']);
    await ensureDir(path.dirname(absPath));

    const body = await response.buffer();
    if (body.byteLength === 0) {
        return false;
    }

    await Bun.write(absPath, body);
    return true;
};

export const persistCapturedResponse = async (response: HTTPResponse, outDir: string, originHost: string) => {
    if (!shouldPersistCapturedResponse(response, originHost)) {
        return false;
    }

    return await writeCapturedResponse(response, outDir, originHost);
};
