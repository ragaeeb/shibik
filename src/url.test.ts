import { describe, expect, it } from 'bun:test';

import {
    collapseDuplicateSegments,
    hasAssetExtension,
    looksLikeAssetUrl,
    normalizeEmbeddedUrl,
    remapLocalhostUrl,
    safeFilenameFromPath,
    shouldSkipUrl,
} from '@/url.js';

describe('normalizeEmbeddedUrl', () => {
    it('should decode escaped slashes and trim quotes', () => {
        expect(normalizeEmbeddedUrl('"\\/assets\\/demo.png"')).toBe('/assets/demo.png');
    });

    it('should reject embedded javascript mime fragments', () => {
        expect(normalizeEmbeddedUrl('application/javascript;base64,AAAA')).toBe('');
    });

    it('should preserve signed query parameters', () => {
        expect(
            normalizeEmbeddedUrl(
                'https://cdn.example.com/file.png?X-Amz-Signature=abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789',
            ),
        ).toBe(
            'https://cdn.example.com/file.png?X-Amz-Signature=abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789',
        );
    });
});

describe('remapLocalhostUrl', () => {
    it('should remap localhost URLs onto the real origin', () => {
        expect(remapLocalhostUrl('http://localhost:3000/assets/demo.png', 'https://example.com')).toBe(
            'https://example.com/assets/demo.png',
        );
    });
});

describe('collapseDuplicateSegments', () => {
    it('should collapse repeated asset directory segments', () => {
        expect(collapseDuplicateSegments('https://example.com/res/res/file.bin')).toBe(
            'https://example.com/res/file.bin',
        );
    });
});

describe('safeFilenameFromPath', () => {
    it('should preserve the extension while appending a stable hash', () => {
        const fileName = safeFilenameFromPath('very/long/path/file.ktx2');
        expect(fileName).toMatch(/file_[a-f0-9]{12}\.ktx2$/);
        expect(fileName.includes('/')).toBe(false);
        expect(fileName.includes('\\')).toBe(false);
    });
});

describe('shouldSkipUrl', () => {
    it('should skip template-like or tracking urls', () => {
        expect(shouldSkipUrl('https://example.com/${asset}.png')).toBe(true);
        expect(shouldSkipUrl('https://img.example.com/images/{op}/hero')).toBe(true);
        expect(shouldSkipUrl('https://img.example.com/images/t_icon_#{size}/hero.png')).toBe(true);
        expect(shouldSkipUrl('https://www.google-analytics.com/collect')).toBe(true);
    });
});

describe('hasAssetExtension', () => {
    it('should detect known asset extensions', () => {
        expect(hasAssetExtension('https://example.com/assets/app.css?v=1')).toBe(true);
        expect(hasAssetExtension('https://example.com/textures/sky.exr')).toBe(true);
        expect(hasAssetExtension('https://example.com/textures/sky.hdr')).toBe(true);
        expect(hasAssetExtension('https://example.com/assets/app.cssjunk')).toBe(false);
        expect(hasAssetExtension('https://example.com/brand/demo')).toBe(false);
    });
});

describe('looksLikeAssetUrl', () => {
    it('should require asset-like paths when requested', () => {
        expect(looksLikeAssetUrl('https://example.com/brand/demo', 'example.com', true)).toBe(false);
        expect(looksLikeAssetUrl('https://cdn.example.com/models/scene.glb', 'example.com', true)).toBe(true);
    });
});
