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

    it('should resolve encoded external asset requests to the sanitized local file path', () => {
        const sourceUrl =
            'https://cdn.prod.website-files.com/6891a5aecbde722a4a9adbba/68a3da2305ef5935615cdc49_1-We%20listen_we%20craft_we%20deliver%20(1).avif';
        const { absPath } = mapUrlToLocalPath(sourceUrl, '/tmp/out', 'www.1820productions.com');

        expect(
            mapLocalTestUrlToPath(
                'http://local.test/_external/cdn.prod.website-files.com/6891a5aecbde722a4a9adbba/68a3da2305ef5935615cdc49_1-We%20listen_we%20craft_we%20deliver%20(1).avif',
                '/tmp/out',
            ),
        ).toBe(absPath);
    });

    it('should preserve decoded spaces in asset file paths so generic static servers can resolve them', () => {
        const { absPath } = mapUrlToLocalPath('https://ciwsimulator.com/models/rafale%20fini.glb', '/tmp/out', 'ciwsimulator.com');

        expect(absPath).toBe('/tmp/out/models/rafale fini.glb');
        expect(
            mapLocalTestUrlToPath('http://local.test/models/rafale%20fini.glb', '/tmp/out'),
        ).toBe('/tmp/out/models/rafale fini.glb');
    });
});

describe('getEntryDir', () => {
    it('should normalize file entries to their containing directory', () => {
        expect(getEntryDir('/brand/demo/index.html?mode=preview')).toBe('/brand/demo/');
    });
});
