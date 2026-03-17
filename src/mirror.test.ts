import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TRANSPARENT_PNG } from '@/constants.js';
import { ensureDir } from '@/files.js';
import { copyMissingTree } from '@/mirror.js';

describe('copyMissingTree', () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            rmSync(dir, { force: true, recursive: true });
        }
    });

    it('should fill missing files and replace placeholders without overwriting real files', async () => {
        const rootDir = mkdtempSync(path.join(tmpdir(), 'shibik-mirror-'));
        tempDirs.push(rootDir);

        const sourceDir = path.join(rootDir, 'source');
        const targetDir = path.join(rootDir, 'target');
        await ensureDir(path.join(sourceDir, 'nested'));
        await ensureDir(path.join(targetDir, 'nested'));

        await Bun.write(path.join(sourceDir, 'nested', 'hero.png'), 'real-asset');
        await Bun.write(path.join(sourceDir, 'keep.txt'), 'source');
        await Bun.write(path.join(targetDir, 'nested', 'hero.png'), TRANSPARENT_PNG);
        await Bun.write(path.join(targetDir, 'keep.txt'), 'already-there');

        await copyMissingTree(sourceDir, targetDir);

        expect(await Bun.file(path.join(targetDir, 'nested', 'hero.png')).text()).toBe('real-asset');
        expect(await Bun.file(path.join(targetDir, 'keep.txt')).text()).toBe('already-there');
    });
});
