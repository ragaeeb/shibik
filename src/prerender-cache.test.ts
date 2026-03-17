import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getApiMockLookupPaths } from '@/api-mocks.js';
import {
    extractPrerenderRequestUrls,
    persistPrerenderCacheMocks,
    persistStoredPageConfigFallbackMocks,
} from '@/prerender-cache.js';

describe('persistPrerenderCacheMocks', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('should write query-based response mocks from the prerender cache', async () => {
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibuk-prerender-'));
        tempDirs.push(outDir);

        const html = `<!doctype html>
<html>
  <body>
    <script type="application/json" id="rb3-prerender-data-cache">{
      "/v3/config/pages?url=/fr-fr/demo": {"data": {"ok": true}},
      "/assets/app.js?v=1": {"ignored": true}
    }</script>
  </body>
</html>`;

        await persistPrerenderCacheMocks(html, 'https://www.redbull.com', outDir, 'www.redbull.com');

        const [queryPath] = getApiMockLookupPaths(outDir, '/v3/config/pages', '?url=/fr-fr/demo');
        expect(queryPath).toBeTruthy();
        expect(await Bun.file(queryPath!).json()).toEqual({ data: { ok: true } });

        const assetLookup = getApiMockLookupPaths(outDir, '/assets/app.js', '?v=1');
        expect(assetLookup.length).toBeGreaterThan(0);
        expect(await Bun.file(assetLookup[0]!).exists()).toBe(false);
    });

    it('should create empty inline-content fallbacks from page config panels', async () => {
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibuk-prerender-'));
        tempDirs.push(outDir);

        const html = `<!doctype html>
<html lang="fr-fr">
  <body>
    <script type="application/json" id="rb3-prerender-data-cache">{
      "/v3/config/pages?url=/fr-fr/demo": {
        "data": {
          "data": {
            "panels": [
              {
                "panelModule": "rbgemc-rb3/inline-content-panel/inline-content-panel-controller",
                "config": {
                  "endpoint": "/v3/query/fr-FR>fr-INT?filter[id]=8d5244b7-7733-4d8c-99da-778534861799"
                }
              }
            ]
          }
        }
      }
    }</script>
  </body>
</html>`;

        await persistPrerenderCacheMocks(html, 'https://www.redbull.com', outDir, 'www.redbull.com');

        const requestUrls = extractPrerenderRequestUrls(html, 'https://www.redbull.com');
        expect(requestUrls).toContain(
            'https://www.redbull.com/v3/api/graphql/v1/v3/query/fr-FR%3Efr-INT?filter%5Bid%5D=8d5244b7-7733-4d8c-99da-778534861799&rb3Schema=v1%3AinlineContent&rb3Locale=fr-fr',
        );

        const [mockPath] = getApiMockLookupPaths(
            outDir,
            '/v3/api/graphql/v1/v3/query/fr-FR%3Efr-INT',
            '?filter%5Bid%5D=8d5244b7-7733-4d8c-99da-778534861799&rb3Schema=v1%3AinlineContent&rb3Locale=fr-fr',
        );

        expect(mockPath).toBeTruthy();
        expect(await Bun.file(mockPath!).json()).toEqual({
            data: {
                data: {
                    eligibleForPromotion: 'not-applicable',
                    items: [],
                },
            },
        });
    });

    it('should create inline-content fallbacks from stored page config responses', async () => {
        const outDir = mkdtempSync(path.join(tmpdir(), 'shibuk-prerender-'));
        tempDirs.push(outDir);

        const pageConfigDir = path.join(outDir, 'v3', 'config', 'pages');
        mkdirSync(pageConfigDir, { recursive: true });
        writeFileSync(
            path.join(pageConfigDir, '__query_page.json'),
            JSON.stringify({
                data: {
                    data: {
                        domainConfig: {
                            supportedLocales: ['fr-FR', 'fr-INT'],
                        },
                        panels: [
                            {
                                config: {
                                    endpoint: '/v3/query/fr-FR>fr-INT?filter[id]=8d5244b7-7733-4d8c-99da-778534861799',
                                },
                                panelModule: 'rbgemc-rb3/inline-content-panel/inline-content-panel-controller',
                            },
                        ],
                    },
                },
            }),
        );

        const urls = await persistStoredPageConfigFallbackMocks(outDir, 'https://www.redbull.com');
        expect(urls).toContain(
            'https://www.redbull.com/v3/api/graphql/v1/v3/query/fr-FR%3Efr-INT?filter%5Bid%5D=8d5244b7-7733-4d8c-99da-778534861799&rb3Schema=v1%3AinlineContent&rb3Locale=fr-fr',
        );

        const [mockPath] = getApiMockLookupPaths(
            outDir,
            '/v3/api/graphql/v1/v3/query/fr-FR%3Efr-INT',
            '?filter%5Bid%5D=8d5244b7-7733-4d8c-99da-778534861799&rb3Schema=v1%3AinlineContent&rb3Locale=fr-fr',
        );

        expect(mockPath).toBeTruthy();
        expect(await Bun.file(mockPath!).json()).toEqual({
            data: {
                data: {
                    eligibleForPromotion: 'not-applicable',
                    items: [],
                },
            },
        });
    });
});
