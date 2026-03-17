import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

import { rewriteImports } from './rewrite-dist-imports.ts';

const SRC_DIR = 'src';
const DIST_DIR = 'dist';
const SHEBANG_PATTERN = /^#![^\n]+\n?/;

export const isBuildSourceFile = (sourcePath: string) => {
    return sourcePath.endsWith('.ts') && !sourcePath.endsWith('.test.ts');
};

export const distPathFromSource = (sourcePath: string) => {
    return path.join(DIST_DIR, path.relative(SRC_DIR, sourcePath)).replace(/\.ts$/, '.js');
};

export const restoreShebang = (source: string, output: string) => {
    const sourceShebang = source.match(SHEBANG_PATTERN)?.[0];
    const normalizedOutput = output.replace(SHEBANG_PATTERN, '');
    return sourceShebang ? `${sourceShebang}${normalizedOutput}` : normalizedOutput;
};

const runCommand = (cmd: string[], label: string) => {
    const result = Bun.spawnSync({
        cmd,
        cwd: process.cwd(),
        stderr: 'pipe',
        stdout: 'pipe',
    });

    if (result.stdout.length > 0) {
        process.stdout.write(result.stdout);
    }

    if (result.stderr.length > 0) {
        process.stderr.write(result.stderr);
    }

    if (result.exitCode !== 0) {
        throw new Error(`${label} failed with exit code ${result.exitCode}`);
    }
};

const buildSourceFile = async (sourcePath: string) => {
    const outFile = distPathFromSource(sourcePath);
    await mkdir(path.dirname(outFile), { recursive: true });

    // Bun's CLI reliably supports `--no-bundle --minify` for file-per-module dist output.
    // The Bun.build() API currently bundles this CLI graph in our usage, which breaks the
    // published npm/bunx package layout we need to preserve.
    runCommand(
        [
            process.execPath,
            'build',
            '--no-bundle',
            '--target=bun',
            '--format=esm',
            '--minify',
            '--outfile',
            outFile,
            sourcePath,
        ],
        `bun build for ${sourcePath}`,
    );

    const source = await Bun.file(sourcePath).text();
    const built = await Bun.file(outFile).text();
    const finalOutput = rewriteImports(restoreShebang(source, built));

    if (finalOutput !== built) {
        await Bun.write(outFile, finalOutput);
    }
};

const getSourceFiles = async () => {
    const files: string[] = [];

    for await (const filePath of new Bun.Glob(`${SRC_DIR}/**/*.ts`).scan('.')) {
        if (isBuildSourceFile(filePath)) {
            files.push(filePath);
        }
    }

    files.sort();
    return files;
};

if (import.meta.main) {
    await rm(DIST_DIR, { force: true, recursive: true });

    for (const sourcePath of await getSourceFiles()) {
        await buildSourceFile(sourcePath);
    }
}
