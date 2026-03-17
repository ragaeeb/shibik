import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { storeApiMockValue } from '@/api-mocks.js';
import { startStaticServer } from '@/local-server.js';

describe('startStaticServer', () => {
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

    it('should serve query-specific api mocks with encoded path segments', async () => {
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibuk-local-server-'));
        tempDirs.push(outDir);

        const urlStr =
            'https://www.redbull.com/v3/api/graphql/v1/v3/feed/fr-FR%3Efr-INT?disableUsageRestrictions=true&rb3Schema=v1:pageConfig';

        expect(await storeApiMockValue(urlStr, { data: { ok: true } }, outDir)).toBe(true);

        const server = startStaticServer(outDir);
        servers.push(server);

        const response = await fetch(
            new URL(
                '/v3/api/graphql/v1/v3/feed/fr-FR%3Efr-INT?disableUsageRestrictions=true&rb3Schema=v1:pageConfig',
                server.url,
            ),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ data: { ok: true } });
    });

    it('should serve exr textures with the correct content type', async () => {
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibuk-local-server-'));
        tempDirs.push(outDir);

        const filePath = path.join(outDir, 'textures', 'hdr.exr');
        await Bun.write(filePath, new Uint8Array([1, 2, 3]));

        const server = startStaticServer(outDir);
        servers.push(server);

        const response = await fetch(new URL('/textures/hdr.exr', server.url));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/aces');
    });

    it('should serve hdr textures with the correct content type', async () => {
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibuk-local-server-'));
        tempDirs.push(outDir);

        const filePath = path.join(outDir, 'textures', 'sky.hdr');
        await Bun.write(filePath, new Uint8Array([4, 5, 6]));

        const server = startStaticServer(outDir);
        servers.push(server);

        const response = await fetch(new URL('/textures/sky.hdr', server.url));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/vnd.radiance');
    });
});
