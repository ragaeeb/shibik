import path from 'node:path';

const isPathWithinRoot = (rootDir: string, absPath: string) => {
    const relative = path.relative(rootDir, absPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export const resolvePathWithinRoot = (rootDir: string, candidatePath: string) => {
    const resolvedRoot = path.resolve(rootDir);
    const normalizedCandidate = candidatePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const absPath = path.resolve(resolvedRoot, normalizedCandidate);
    return isPathWithinRoot(resolvedRoot, absPath) ? absPath : null;
};
