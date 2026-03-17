import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { collectEmbeddedUrls, collectEmbeddedUrlsFromContent, collectManifestAssetPaths } from '@/discovery.js';
import { ensureDir } from '@/files.js';

describe('collectManifestAssetPaths', () => {
    it('should expand sequence manifests into concrete asset variants', () => {
        const assets = collectManifestAssetPaths({
            files: {
                intro: ['textures/frame', 2, ['webp', 'png']],
            },
            type: 'sequence',
        });

        expect(assets).toEqual(
            expect.arrayContaining([
                'textures/frame.webp',
                'textures/frame.png',
                'textures/frame.n0.webp',
                'textures/frame.n0.png',
                'textures/frame.n1.webp',
                'textures/frame.n1.png',
            ]),
        );
    });

    it('should expand texture packer manifests into atlas and image variants', () => {
        const assets = collectManifestAssetPaths({
            files: {
                atlas: ['textures/gui', 0, null, ['png', 'webp']],
            },
            type: 'texturePacker',
        });

        expect(assets).toEqual(expect.arrayContaining(['textures/gui.json', 'textures/gui.png', 'textures/gui.webp']));
    });
});

describe('collectEmbeddedUrlsFromContent', () => {
    it('should discover absolute, relative, css, srcset, and combined asset URLs', () => {
        const urls = collectEmbeddedUrlsFromContent({
            content: `
        const hero = "https://example.com/assets/hero.png";
        const scene = "//cdn.example.com/models/scene.glb";
        const icon = "../images/icon.webp";
        const folder = "assets/";
        const name = "poster.png";
        .banner { background-image: url("../images/bg.webp"); }
        <img srcset="/images/a.webp 1x, ./images/b.webp 2x">
      `,
            entryPath: '/brand/demo/',
            fileRelativeDir: 'pages/demo',
            origin: 'https://example.com',
        });

        expect(urls).toEqual(
            expect.arrayContaining([
                'https://example.com/assets/hero.png',
                'https://cdn.example.com/models/scene.glb',
                'https://example.com/pages/images/icon.webp',
                'https://example.com/pages/images/bg.webp',
                'https://example.com/images/a.webp',
                'https://example.com/pages/demo/images/b.webp',
                'https://example.com/brand/demo/assets/poster.png',
            ]),
        );
    });

    it('should prefer _next static paths for build manifests', () => {
        const content =
            'self.__BUILD_MANIFEST={"/":["../../../static/chunks/pages/index-abc.js","../../../static/css/app.css"]};';
        const urls = collectEmbeddedUrlsFromContent({
            content,
            entryPath: '/opportunity-district',
            fileRelativeDir: '_next/static/build',
            origin: 'https://virtualexpodubai.com',
        });

        expect(urls).toContain('https://virtualexpodubai.com/_next/static/chunks/pages/index-abc.js');
        expect(urls).toContain('https://virtualexpodubai.com/_next/static/css/app.css');
        expect(urls).not.toContain('https://virtualexpodubai.com/static/chunks/pages/index-abc.js');
    });

    it('should prefer _next static paths when the file directory is exactly _next/static', () => {
        const content = 'self.__BUILD_MANIFEST={"/":["../../static/chunks/pages/index-abc.js"]};';
        const urls = collectEmbeddedUrlsFromContent({
            content,
            entryPath: '/opportunity-district',
            fileRelativeDir: '_next/static',
            origin: 'https://virtualexpodubai.com',
        });

        expect(urls).toContain('https://virtualexpodubai.com/_next/static/chunks/pages/index-abc.js');
        expect(urls).not.toContain('https://virtualexpodubai.com/static/chunks/pages/index-abc.js');
    });

    it('should parse image-set entries with nested parentheses', () => {
        const urls = collectEmbeddedUrlsFromContent({
            content: `
                .hero {
                    background-image: image-set(
                        url("./images/hero(1).webp") 1x,
                        url("/images/hero(2).webp") 2x
                    );
                }
            `,
            entryPath: '/brand/demo/',
            fileRelativeDir: 'pages/demo',
            origin: 'https://example.com',
        });

        expect(urls).toContain('https://example.com/pages/demo/images/hero(1).webp');
        expect(urls).toContain('https://example.com/images/hero(2).webp');
    });

    it('should resolve bare css asset filenames relative to the current file', () => {
        const urls = collectEmbeddedUrlsFromContent({
            content: '.hero { background-image: url("bg.png"); src: url("font.woff2") format("woff2"); }',
            entryPath: '/brand/demo/',
            fileRelativeDir: 'pages/demo',
            origin: 'https://example.com',
        });

        expect(urls).toContain('https://example.com/pages/demo/bg.png');
        expect(urls).toContain('https://example.com/pages/demo/font.woff2');
    });

    it('should ignore templated placeholder asset urls', () => {
        const urls = collectEmbeddedUrlsFromContent({
            content: 'const locale = "/assets/locales/{{lng}}.json";',
            entryPath: '/',
            fileRelativeDir: 'assets',
            origin: 'https://paodao.fr',
        });

        expect(urls).toEqual([]);
    });

    it('should ignore javascript expressions that only look like relative asset paths', () => {
        const urls = collectEmbeddedUrlsFromContent({
            content: `
                const a = new URL(document.baseURI);
                const b = new URL(a.href, document.baseURI);
                const c = new URL(this.URL, o);
                const d = window.location.href;
                const e = window.location.pathname, t = 1;
            `,
            entryPath: '/',
            fileRelativeDir: 'assets',
            origin: 'https://vision.avatr.com',
        });

        expect(urls).toEqual([]);
    });
});

describe('collectEmbeddedUrls', () => {
    it('should avoid entry-dir _next duplicates when root _next exists', async () => {
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibuk-embedded-'));
        try {
            const buildManifest = `self.__BUILD_MANIFEST={"/": ["./../static/chunks/pages/index-abc.js"]};`;
            await ensureDir(path.join(outDir, '_next', 'static', 'build'));
            await ensureDir(path.join(outDir, 'opportunity-district', '_next', 'static', 'build'));
            await Bun.write(path.join(outDir, '_next', 'static', 'build', '_buildManifest.js'), buildManifest);
            await Bun.write(
                path.join(outDir, 'opportunity-district', '_next', 'static', 'build', '_buildManifest.js'),
                buildManifest,
            );

            const urls = await collectEmbeddedUrls(outDir, 'https://virtualexpodubai.com', '/opportunity-district');
            const bad = urls.filter(
                (url) =>
                    url.includes('/opportunity-district/_next/static/') ||
                    url.includes('/opportunity-district/static/'),
            );
            expect(bad).toEqual([]);
            expect(urls).toContain('https://virtualexpodubai.com/_next/static/chunks/pages/index-abc.js');
            expect(
                urls.filter((url) => url === 'https://virtualexpodubai.com/_next/static/chunks/pages/index-abc.js'),
            ).toHaveLength(1);
        } finally {
            rmSync(outDir, { force: true, recursive: true });
        }
    });

    it('should prefer a unique nested local asset root for relative model helper paths and include ktx size variants', async () => {
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibuk-embedded-'));
        try {
            await ensureDir(path.join(outDir, 'assets'));
            await ensureDir(path.join(outDir, 'assets', 'game', 'models'));
            await Bun.write(
                path.join(outDir, 'assets', 'index.js'),
                'Te.AddModel(z.GLB_BAG,this._getAssetPath("../models/bag-ktx.glb"));',
            );
            await Bun.write(path.join(outDir, 'assets', 'game', 'models', 'menu-ktx-512.glb'), 'asset');

            const urls = await collectEmbeddedUrls(outDir, 'https://paodao.fr', '/');
            expect(urls).toContain('https://paodao.fr/assets/game/models/bag-ktx.glb');
            expect(urls).toContain('https://paodao.fr/assets/game/models/bag-ktx-512.glb');
            expect(urls).not.toContain('https://paodao.fr/models/bag-ktx.glb');
            expect(urls).not.toContain('https://paodao.fr/models/bag-ktx-512.glb');
        } finally {
            rmSync(outDir, { force: true, recursive: true });
        }
    });

    it('should prefer a unique nested local asset root for bare helper asset paths', async () => {
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibuk-embedded-'));
        try {
            await ensureDir(path.join(outDir, 'assets'));
            await ensureDir(path.join(outDir, 'assets', 'game', 'sounds', 'loops'));
            await Bun.write(
                path.join(outDir, 'assets', 'index.js'),
                'const music = this._getAssetPath("sounds/loops/strange.mp3");',
            );
            await Bun.write(path.join(outDir, 'assets', 'game', 'sounds', 'loops', 'chill.mp3'), 'asset');

            const urls = await collectEmbeddedUrls(outDir, 'https://paodao.fr', '/');
            expect(urls).toContain('https://paodao.fr/assets/game/sounds/loops/strange.mp3');
            expect(urls).not.toContain('https://paodao.fr/sounds/loops/strange.mp3');
        } finally {
            rmSync(outDir, { force: true, recursive: true });
        }
    });
});
