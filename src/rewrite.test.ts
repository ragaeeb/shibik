import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import { rewriteTextContent } from '@/rewrite.js';

describe('rewriteTextContent', () => {
    it('should keep external sub-app relative asset folders relative', () => {
        const outDir = '/tmp/shibuk-test';
        const filePath = path.join(
            outDir,
            '_external',
            'p-p.redbull.com',
            'rb-red-bulle-of-wheels-11-prod',
            'baluchon.manifest.json',
        );

        const result = rewriteTextContent({
            aliasPairs: [],
            content: '{"logo":"b/1mJlWYf_YHJZ.avif"}',
            filePath,
            knownHosts: new Set<string>(['p-p.redbull.com']),
            originHost: 'www.redbull.com',
            outDir,
        });

        expect(result.content).toContain('"b/1mJlWYf_YHJZ.avif"');
    });

    it('should rewrite external host-root asset folders to the external host root', () => {
        const outDir = '/tmp/shibuk-test';
        const filePath = path.join(
            outDir,
            '_external',
            'p-p.redbull.com',
            'rb-red-bulle-of-wheels-11-prod',
            'loader.js',
        );

        const result = rewriteTextContent({
            aliasPairs: [],
            content: 'const logo = "/b/1mJlWYf_YHJZ.avif";',
            filePath,
            knownHosts: new Set<string>(['p-p.redbull.com']),
            originHost: 'www.redbull.com',
            outDir,
        });

        expect(result.content).toContain('"../b/1mJlWYf_YHJZ.avif"');
    });

    it('should preserve CommonJS exports for bundled UMD modules when define exists', () => {
        const outDir = '/tmp/shibuk-test';
        const filePath = path.join(outDir, 'assets', 'bundle.js');

        const result = rewriteTextContent({
            aliasPairs: [],
            content: 'const x="function"==typeof define?define(function(){return s}):e.exports=s;',
            filePath,
            knownHosts: new Set<string>(),
            originHost: 'example.com',
            outDir,
        });

        expect(result.content).toContain(
            'const x=("function"==typeof define&&define(function(){return s}),e.exports=s);',
        );
    });

    it('should preserve CommonJS exports for bundled charcode define checks', () => {
        const outDir = '/tmp/shibuk-test';
        const filePath = path.join(outDir, 'assets', 'bundle.js');

        const result = rewriteTextContent({
            aliasPairs: [],
            content: 'const x="f"==(typeof define)[0]?define(function(){return a}):e.exports=a;',
            filePath,
            knownHosts: new Set<string>(),
            originHost: 'example.com',
            outDir,
        });

        expect(result.content).toContain(
            'const x=(("function"==typeof define||"f"==(typeof define)[0])&&define(function(){return a}),e.exports=a);',
        );
    });

    it('should keep Next build manifest static paths from being rebased', () => {
        const outDir = '/tmp/shibuk-test';
        const filePath = path.join(outDir, '_next', 'static', 'build', '_buildManifest.js');

        const result = rewriteTextContent({
            aliasPairs: [],
            content: 'self.__BUILD_MANIFEST={"/":["static/chunks/pages/index.js","static/css/app.css"]};',
            filePath,
            knownHosts: new Set<string>(),
            originHost: 'virtualexpodubai.com',
            outDir,
        });

        expect(result.content).toContain('"static/chunks/pages/index.js"');
        expect(result.content).toContain('"static/css/app.css"');
        expect(result.content).not.toContain('"../../../static/chunks/pages/index.js"');
    });

    it('should relax fetch JSON content-type checks to allow charset suffixes', () => {
        const outDir = '/tmp/shibuk-test';
        const filePath = path.join(outDir, 'assets', 'bundle.js');

        const result = rewriteTextContent({
            aliasPairs: [],
            content: 'return response.headers.get("Content-Type")=="application/json"?response.json():response.blob();',
            filePath,
            knownHosts: new Set<string>(),
            originHost: 'parallel-studio.com',
            outDir,
        });

        expect(result.content).toContain(
            'String(response.headers.get("Content-Type")||"").includes("application/json")',
        );
    });

    it('should keep Next runtime chunk loaders rooted under _next static', () => {
        const outDir = '/tmp/shibuk-test';
        const filePath = path.join(outDir, '_next', 'static', 'chunks', 'turbopack-abc.js');

        const result = rewriteTextContent({
            aliasPairs: [],
            content: 'otherChunks:["static/chunks/f0100e65ba620ab0.js","static/chunks/6c24ec714001b031.js"],let t="/_next/"',
            filePath,
            knownHosts: new Set<string>(),
            originHost: 'www.lainzone.com',
            outDir,
        });

        expect(result.content).toContain('otherChunks:["static/chunks/f0100e65ba620ab0.js","static/chunks/6c24ec714001b031.js"]');
        expect(result.content).toContain('let t="/_next/"');
        expect(result.content).not.toContain('otherChunks:["../../../static/chunks/f0100e65ba620ab0.js"');
        expect(result.content).not.toContain('let t="../../../_next/"');
    });

    it('should preserve root asset urls inside non-runtime Next client chunks', () => {
        const outDir = '/tmp/shibuk-test';
        const filePath = path.join(outDir, '_next', 'static', 'chunks', 'app-client.js');

        const result = rewriteTextContent({
            aliasPairs: [],
            content: 'const a="/images/programImages/NotepadIcon.png"; const b="/_next/static/chunks/f0100e65ba620ab0.js";',
            filePath,
            knownHosts: new Set<string>(),
            originHost: 'www.lainzone.com',
            outDir,
        });

        expect(result.content).toContain('const a="/images/programImages/NotepadIcon.png"');
        expect(result.content).toContain('const b="/_next/static/chunks/f0100e65ba620ab0.js"');
        expect(result.content).not.toContain('../../../images/programImages/NotepadIcon.png');
        expect(result.content).not.toContain('../../../_next/static/chunks/f0100e65ba620ab0.js');
    });

    it('should rewrite aliased asset paths relative to the current file', () => {
        const outDir = '/tmp/shibuk-test';
        const filePath = path.join(outDir, 'pages', 'nested', 'entry.js');

        const result = rewriteTextContent({
            aliasPairs: [['logo.svg', 'assets/images/logo.svg']],
            content: 'const logo = "/logo.svg";',
            filePath,
            knownHosts: new Set<string>(['cdn.example.com']),
            originHost: 'example.com',
            outDir,
        });

        expect(result.content).toContain('"../../assets/images/logo.svg"');
        expect(result.content).not.toContain('"/logo.svg"');
    });

    it('should rewrite aliased asset paths to root-relative paths in markup files', () => {
        const outDir = '/tmp/shibuk-test';
        const filePath = path.join(outDir, 'index.html');

        const result = rewriteTextContent({
            aliasPairs: [['runtime.js', '_next/static/runtime.js']],
            content: '<script src="/runtime.js"></script>',
            filePath,
            knownHosts: new Set<string>(),
            originHost: 'example.com',
            outDir,
        });

        expect(result.content).toContain('src="/_next/static/runtime.js"');
        expect(result.content).not.toContain('src="/runtime.js"');
    });

    it('should inject a base href for nested markup files', () => {
        const outDir = '/tmp/shibuk-test';
        const filePath = path.join(outDir, 'apartment', 'index.html');

        const result = rewriteTextContent({
            aliasPairs: [],
            content:
                '<html><head><script src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css"></head><body></body></html>',
            filePath,
            knownHosts: new Set<string>(),
            originHost: 'xrplace.io',
            outDir,
        });

        expect(result.content).toContain('<base href="/apartment/">');
        expect(result.content).toContain('<script src="/apartment/assets/app.js"></script>');
        expect(result.content).toContain('<link rel="stylesheet" href="/apartment/assets/app.css">');
    });
});
