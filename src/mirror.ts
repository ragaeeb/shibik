import path from 'node:path';

import { LEAF_TO_ROOT_FOLDERS, ROOT_TO_ENTRY_FOLDERS, TEXT_EXTENSIONS } from '@/constants.js';
import { directoryExists, ensureDir, isPlaceholderFile, readTextFile, walkDir } from '@/files.js';
import { getEntryDir } from '@/site-paths.js';

type CopyMissingTreeOptions = {
    skipFile?: (entryName: string, srcPath: string) => boolean;
};

const nestedFilesGlob = new Bun.Glob('**/*');
const rootFilesGlob = new Bun.Glob('*');

export const copyMissingTree = async (source: string, target: string, options: CopyMissingTreeOptions = {}) => {
    if (!(await directoryExists(source))) {
        return;
    }

    await ensureDir(target);

    for (const relativePath of nestedFilesGlob.scanSync({
        absolute: false,
        cwd: source,
        dot: true,
    })) {
        const srcPath = path.join(source, relativePath);
        if (options.skipFile?.(path.basename(relativePath), srcPath)) {
            continue;
        }

        const dstPath = path.join(target, relativePath);
        const dstFile = Bun.file(dstPath);
        if ((await dstFile.exists()) && !(await isPlaceholderFile(dstPath))) {
            continue;
        }

        await ensureDir(path.dirname(dstPath));
        await Bun.write(dstPath, Bun.file(srcPath));
    }
};

export const collectUpwardRelativeFolders = async (outDir: string) => {
    const folders = new Set<string>();
    const pattern = /\.\.\/\.\.\/([a-z0-9_-]+)\//gi;

    for (const file of walkDir(outDir)) {
        const ext = path.extname(file).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) {
            continue;
        }

        let content: string;
        try {
            content = await readTextFile(file);
        } catch {
            continue;
        }

        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content))) {
            if (match[1]) {
                folders.add(match[1]);
            }
        }
    }

    return folders;
};

export const mirrorEntryDirFolders = async (outDir: string, entryPath: string) => {
    const entryUrl = new URL(entryPath, 'https://local.test');
    const entryDir = entryUrl.pathname.replace(/\/[^/]*$/, '/');
    if (entryDir === '/') {
        return;
    }

    const entryFs = path.join(outDir, entryDir.replace(/^\/+/, ''));
    if (!(await directoryExists(entryFs))) {
        return;
    }

    const folders = await collectUpwardRelativeFolders(outDir);
    if (folders.size === 0) {
        return;
    }

    for (const folder of folders) {
        await copyMissingTree(path.join(entryFs, folder), path.join(outDir, folder));
    }

    for (const relativePath of rootFilesGlob.scanSync({ absolute: false, cwd: outDir, dot: true })) {
        if (relativePath.includes(path.sep) || relativePath === 'index.html' || relativePath === '.clone') {
            continue;
        }

        const srcPath = path.join(outDir, relativePath);
        const dstPath = path.join(entryFs, relativePath);
        const dstFile = Bun.file(dstPath);
        if ((await dstFile.exists()) && !(await isPlaceholderFile(dstPath))) {
            continue;
        }

        await ensureDir(path.dirname(dstPath));
        await Bun.write(dstPath, Bun.file(srcPath));
    }
};

export const mirrorLeafToParent = async (outDir: string, entryPath: string) => {
    const entryUrl = new URL(entryPath, 'https://local.test');
    const pathname = entryUrl.pathname.replace(/\/+$/, '');

    if (!pathname || pathname === '/' || path.extname(pathname)) {
        return;
    }

    const leafRel = pathname.replace(/^\/+/, '');
    const parentRel = path.dirname(leafRel);
    if (!parentRel || parentRel === '.') {
        return;
    }

    await copyMissingTree(path.join(outDir, leafRel), path.join(outDir, parentRel), {
        skipFile: (entryName) => entryName === 'index.html',
    });
};

export const mirrorLeafToRoot = async (outDir: string, entryPath: string) => {
    const entryUrl = new URL(entryPath, 'https://local.test');
    const pathname = entryUrl.pathname.replace(/\/+$/, '');

    if (!pathname || pathname === '/' || path.extname(pathname)) {
        return;
    }

    const leafFs = path.join(outDir, pathname.replace(/^\/+/, ''));
    if (!(await directoryExists(leafFs))) {
        return;
    }

    for (const folder of LEAF_TO_ROOT_FOLDERS) {
        await copyMissingTree(path.join(leafFs, folder), path.join(outDir, folder));
    }
};

export const mirrorRootToEntry = async (outDir: string, entryPath: string) => {
    const entryDir = getEntryDir(entryPath);
    if (entryDir === '/') {
        return;
    }

    const entryFs = path.join(outDir, entryDir.replace(/^\/+/, ''));
    if (!(await directoryExists(entryFs))) {
        return;
    }

    for (const folder of ROOT_TO_ENTRY_FOLDERS) {
        await copyMissingTree(path.join(outDir, folder), path.join(entryFs, folder));
    }
};
