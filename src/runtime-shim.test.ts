import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    buildAbsoluteExternalAliases,
    buildExternalPathAliases,
    injectRuntimeScriptTag,
    normalizeRuntimePath,
} from '@/runtime-shim.js';

describe('injectRuntimeScriptTag', () => {
    it('should inject the runtime script at the start of the head', () => {
        const html = '<!doctype html><html><head><title>Test</title></head><body></body></html>';
        const nextHtml = injectRuntimeScriptTag(html);

        expect(nextHtml).toContain(
            '<head><script src="/__shibik_runtime.js" data-shibik-runtime="true"></script><title>Test</title>',
        );
    });

    it('should not inject the runtime script twice', () => {
        const html =
            '<!doctype html><html><head><script src="/__shibik_runtime.js" data-shibik-runtime="true"></script></head><body></body></html>';

        expect(injectRuntimeScriptTag(html)).toBe(html);
    });
});

describe('buildExternalPathAliases', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('should expose unique root aliases for external b assets', async () => {
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibik-runtime-'));
        tempDirs.push(outDir);

        const externalDir = path.join(outDir, '_external', 'p-p.redbull.com', 'rb-red-bulle-of-wheels-11-prod', 'b');
        mkdirSync(externalDir, { recursive: true });
        writeFileSync(path.join(externalDir, '1mJlWYf_YHJZ.avif'), 'asset');

        const aliases = await buildExternalPathAliases(outDir);
        expect(aliases['/b/1mJlWYf_YHJZ.avif']).toBe(
            '/_external/p-p.redbull.com/rb-red-bulle-of-wheels-11-prod/b/1mJlWYf_YHJZ.avif',
        );
    });

    it('should expose unique root aliases for external asset folders', async () => {
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibik-runtime-'));
        tempDirs.push(outDir);

        const externalDir = path.join(
            outDir,
            '_external',
            'cdn.cookielaw.org',
            'scripttemplates',
            '202602.1.0',
            'assets',
        );
        mkdirSync(externalDir, { recursive: true });
        writeFileSync(path.join(externalDir, 'otCommonStyles.css'), 'asset');

        const aliases = await buildExternalPathAliases(outDir);
        expect(aliases['/assets/otCommonStyles.css']).toBe(
            '/_external/cdn.cookielaw.org/scripttemplates/202602.1.0/assets/otCommonStyles.css',
        );
    });
});

describe('buildAbsoluteExternalAliases', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('should expose absolute external urls for runtime rewriting', async () => {
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibik-runtime-'));
        tempDirs.push(outDir);

        const externalDir = path.join(outDir, '_external', 'cdn.cookielaw.org', 'assets');
        mkdirSync(externalDir, { recursive: true });
        writeFileSync(path.join(externalDir, 'otCommonStyles.css'), 'asset');

        const aliases = await buildAbsoluteExternalAliases(outDir);
        expect(aliases['https://cdn.cookielaw.org/assets/otCommonStyles.css']).toBe(
            '/_external/cdn.cookielaw.org/assets/otCommonStyles.css',
        );
        expect(aliases['//cdn.cookielaw.org/assets/otCommonStyles.css']).toBe(
            '/_external/cdn.cookielaw.org/assets/otCommonStyles.css',
        );
    });
});

describe('normalizeRuntimePath', () => {
    it('should not collapse nested resource folders when entry dir is root', () => {
        const result = normalizeRuntimePath('/resources/textures/worldTexture.webp', '/');
        expect(result).toBe('/resources/textures/worldTexture.webp');
    });

    it('should collapse entry-dir-prefixed asset paths', () => {
        const result = normalizeRuntimePath('/demo/assets/app.js', '/demo/');
        expect(result).toBe('/assets/app.js');
    });

    it('should collapse duplicate root asset segments', () => {
        const result = normalizeRuntimePath('/assets/assets/app.js', '/');
        expect(result).toBe('/assets/app.js');
    });
});
