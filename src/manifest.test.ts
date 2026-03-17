import { describe, expect, it } from 'bun:test';

import { collectManifestAssetPaths, resolveAssetUrl } from '@/manifest.js';

describe('resolveAssetUrl', () => {
    it('should resolve relative assets against an external manifest base url', () => {
        const resolved = resolveAssetUrl(
            'b/1mJlWYf_YHJZ.avif',
            'https://p-p.redbull.com/rb-red-bulle-of-wheels-11-prod/',
        );

        expect(resolved).toBe('https://p-p.redbull.com/rb-red-bulle-of-wheels-11-prod/b/1mJlWYf_YHJZ.avif');
    });

    it('should keep host-relative assets on the external host root', () => {
        const resolved = resolveAssetUrl(
            '/b/1mJlWYf_YHJZ.avif',
            'https://p-p.redbull.com/rb-red-bulle-of-wheels-11-prod/',
        );

        expect(resolved).toBe('https://p-p.redbull.com/b/1mJlWYf_YHJZ.avif');
    });

    it('should resolve bare filenames against the manifest base url', () => {
        const resolved = resolveAssetUrl('favicon.ico', 'https://p-p.redbull.com/rb-red-bulle-of-wheels-11-prod/');

        expect(resolved).toBe('https://p-p.redbull.com/rb-red-bulle-of-wheels-11-prod/favicon.ico');
    });
});

describe('collectManifestAssetPaths', () => {
    it('should collect bare filenames from manifest file lists', () => {
        const assets = collectManifestAssetPaths({
            files: {
                icon: 'favicon.ico',
                pwa: 'icon-192.png',
            },
        });

        expect(assets).toContain('favicon.ico');
        expect(assets).toContain('icon-192.png');
    });
});
