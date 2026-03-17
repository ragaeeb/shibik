import { describe, expect, it } from 'bun:test';

import { resolveAssetUrl } from '@/manifest.js';

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
});
