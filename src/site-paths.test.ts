import { describe, expect, it } from 'bun:test';

import path from 'node:path';

import { getEntryDir, mapLocalTestUrlToPath, mapUrlToLocalPath } from '@/site-paths.js';

describe('mapUrlToLocalPath', () => {
    it('should map same-host routes without extensions to nested index files', () => {
        expect(mapUrlToLocalPath('https://example.com/brand/demo', '/tmp/out', 'example.com').absPath).toBe(
            '/tmp/out/brand/demo/index.html',
        );
    });

    it('should map external hosts under the _external directory', () => {
        expect(mapUrlToLocalPath('https://cdn.example.com/models/scene.glb', '/tmp/out', 'example.com').absPath).toBe(
            '/tmp/out/_external/cdn.example.com/models/scene.glb',
        );
    });

    it('should flatten long fallback paths into a single filename under _long', () => {
        const longPath = `https://example.com/assets/${'demo/'.repeat(60)}scene.glb`;
        const { absPath } = mapUrlToLocalPath(longPath, '/tmp/out', 'example.com');
        const relativeToLongDir = path.relative('/tmp/out/_long', absPath);

        expect(absPath.startsWith('/tmp/out/_long/')).toBe(true);
        expect(relativeToLongDir.includes(path.sep)).toBe(false);
    });
});

describe('mapLocalTestUrlToPath', () => {
    it('should reject sibling traversal paths that share the output prefix', () => {
        expect(mapLocalTestUrlToPath('http://local.test/..%2Fout-other/secret.txt', '/tmp/out')).toBeNull();
    });
});

describe('getEntryDir', () => {
    it('should normalize file entries to their containing directory', () => {
        expect(getEntryDir('/brand/demo/index.html?mode=preview')).toBe('/brand/demo/');
    });
});
