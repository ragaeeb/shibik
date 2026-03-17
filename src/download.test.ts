import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { downloadAllWithVerification, downloadUrl, getWorkerCount } from '@/download.js';
import type { Config } from '@/types.js';

const makeConfig = (origin: string, outDir: string): Config => {
    const originUrl = new URL(origin);

    return {
        concurrency: 4,
        cookieHeader: '',
        entryPath: '/',
        extraUrlFiles: [],
        extraUrls: [],
        headless: true,
        idleWaitMs: 10,
        localTest: false,
        localTestRounds: 1,
        maxRetries: 1,
        maxScrolls: 1,
        origin,
        originHost: originUrl.host,
        outDir,
        requestHeaders: new Map(),
        rewrite: true,
        scroll: false,
        scrollDelayMs: 10,
        scrollStep: 10,
        timeoutMs: 1000,
        url: origin,
        userAgent: 'test-agent',
        verbose: false,
    };
};

describe('getWorkerCount', () => {
    it('should cap worker count to the number of items', () => {
        expect(getWorkerCount(2, 8)).toBe(2);
    });

    it('should return zero for empty queues', () => {
        expect(getWorkerCount(0, 8)).toBe(0);
    });
});

describe('downloadUrl', () => {
    const tempDirs: string[] = [];
    const servers: Bun.Server<undefined>[] = [];

    afterEach(async () => {
        for (const server of servers.splice(0)) {
            await server.stop(true);
        }

        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('should stream successful downloads to disk', async () => {
        const server = Bun.serve({
            fetch(req) {
                if (new URL(req.url).pathname === '/assets/demo.png') {
                    return new Response('image-data', {
                        headers: { 'Content-Type': 'image/png' },
                    });
                }

                return new Response('missing', { status: 404 });
            },
            port: 0,
        });
        servers.push(server);

        const origin = server.url.origin.replace('localhost', '127.0.0.1');
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibik-download-'));
        tempDirs.push(outDir);

        const result = await downloadUrl(
            `${origin}/assets/demo.png`,
            makeConfig(origin, outDir),
            outDir,
            new URL(origin).host,
        );

        expect(result).toBe('downloaded');
        expect(await Bun.file(path.join(outDir, 'assets', 'demo.png')).text()).toBe('image-data');
    });

    it('should reject html challenge bodies for non-html assets', async () => {
        const server = Bun.serve({
            fetch(req) {
                if (new URL(req.url).pathname === '/assets/demo.png') {
                    return new Response('<html>challenge</html>', {
                        headers: { 'Content-Type': 'text/html' },
                    });
                }

                return new Response('missing', { status: 404 });
            },
            port: 0,
        });
        servers.push(server);

        const origin = server.url.origin.replace('localhost', '127.0.0.1');
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibik-download-'));
        tempDirs.push(outDir);

        const result = await downloadUrl(
            `${origin}/assets/demo.png`,
            makeConfig(origin, outDir),
            outDir,
            new URL(origin).host,
        );

        expect(result).toBe('failed');
    });

    it('should abort stalled response bodies after the request timeout', async () => {
        const server = Bun.serve({
            fetch(req) {
                if (new URL(req.url).pathname === '/assets/demo.bin') {
                    return new Response(
                        new ReadableStream({
                            start(controller) {
                                controller.enqueue(new TextEncoder().encode('partial'));
                            },
                        }),
                        {
                            headers: { 'Content-Type': 'application/octet-stream' },
                        },
                    );
                }

                return new Response('missing', { status: 404 });
            },
            port: 0,
        });
        servers.push(server);

        const origin = server.url.origin.replace('localhost', '127.0.0.1');
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibik-download-'));
        tempDirs.push(outDir);

        const startedAt = Date.now();
        const result = await downloadUrl(
            `${origin}/assets/demo.bin`,
            { ...makeConfig(origin, outDir), timeoutMs: 100 },
            outDir,
            new URL(origin).host,
        );

        expect(result).toBe('failed');
        expect(Date.now() - startedAt).toBeLessThan(2_000);
    });

    it('should reject partial content responses for full asset downloads', async () => {
        const server = Bun.serve({
            fetch(req) {
                if (new URL(req.url).pathname === '/assets/demo.mp4') {
                    return new Response('partial-video', {
                        headers: {
                            'Content-Range': 'bytes 0-11/100',
                            'Content-Type': 'video/mp4',
                        },
                        status: 206,
                    });
                }

                return new Response('missing', { status: 404 });
            },
            port: 0,
        });
        servers.push(server);

        const origin = server.url.origin.replace('localhost', '127.0.0.1');
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibik-download-'));
        tempDirs.push(outDir);

        const result = await downloadUrl(
            `${origin}/assets/demo.mp4`,
            makeConfig(origin, outDir),
            outDir,
            new URL(origin).host,
        );

        expect(result).toBe('failed');
    });

    it('should normalize localhost urls during missing-download verification', async () => {
        const origin = 'https://example.com';
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibik-download-'));
        tempDirs.push(outDir);

        await Bun.write(path.join(outDir, 'assets', 'demo.png'), 'image-data');

        const summary = await downloadAllWithVerification(
            ['http://localhost:3000/assets/demo.png'],
            makeConfig(origin, outDir),
            outDir,
            new URL(origin).host,
        );

        expect(summary.failed).toBe(0);
        expect(summary.failedUrls).toEqual([]);
    });
});
