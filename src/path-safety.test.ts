import { describe, expect, it } from 'bun:test';

import { resolvePathWithinRoot } from '@/path-safety.js';

describe('resolvePathWithinRoot', () => {
    it('should resolve nested paths inside the root directory', () => {
        expect(resolvePathWithinRoot('/tmp/shibuk', '/assets/demo.png')).toBe('/tmp/shibuk/assets/demo.png');
    });

    it('should reject parent-directory traversal', () => {
        expect(resolvePathWithinRoot('/tmp/shibuk', '/../secrets.txt')).toBeNull();
    });

    it('should reject sibling-directory traversal that still shares the root prefix', () => {
        expect(resolvePathWithinRoot('/tmp/shibuk', '/../shibuk-other/demo.png')).toBeNull();
    });
});
