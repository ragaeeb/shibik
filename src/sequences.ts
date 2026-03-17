import path from 'node:path';

import { TEXT_EXTENSIONS } from '@/constants.js';
import { readTextFile, walkDir } from '@/files.js';

type SequenceEntry = {
    digits: number;
    ext: string;
    max: number;
    min: number;
    prefix: string;
    relDir: string;
};

const sequenceDefaults: Record<number, number> = { 2: 9, 3: 30 };
const sequenceDirHints = [
    'textures',
    'frames',
    'sequence',
    'sequences',
    'sprites',
    'images',
    'img',
    'assets',
    'b',
    'res',
];
const maxSequenceSpan = 300;

const detectTextHint = async (outDir: string, predicate: (content: string) => boolean) => {
    for (const file of walkDir(outDir)) {
        const ext = path.extname(file).toLowerCase();
        if (!TEXT_EXTENSIONS.has(ext)) {
            continue;
        }

        try {
            if (predicate(await readTextFile(file))) {
                return true;
            }
        } catch {}
    }

    return false;
};

const detectMobileTextureHint = (outDir: string) => {
    return detectTextHint(outDir, (content) => content.includes('textures/') && content.includes('-Mobile'));
};

const detectDynamicSequenceHint = (outDir: string) => {
    return detectTextHint(
        outDir,
        (content) =>
            /[-_]0\$\{/.test(content) ||
            /\.n\$\{/.test(content) ||
            (/sequence|frame/i.test(content) && /\$\{/.test(content)),
    );
};

const updateSequenceMap = (sequences: Map<string, SequenceEntry>, rel: string) => {
    const base = path.basename(rel);
    const match = base.match(/^(.*?)([-_])(0\d{1,3})(\.[a-z0-9]{2,8})$/i);
    if (!match) {
        return;
    }

    const relDir = path.posix.dirname(rel);
    const prefix = relDir === '.' ? `${match[1]}${match[2]}` : `${relDir}/${match[1]}${match[2]}`;
    const digits = match[3].length;
    if (digits > 3) {
        return;
    }

    const num = Number.parseInt(match[3], 10);
    const ext = match[4];
    const key = `${prefix}|${digits}|${ext}`;
    const existing = sequences.get(key);
    if (existing) {
        existing.min = Math.min(existing.min, num);
        existing.max = Math.max(existing.max, num);
        return;
    }

    sequences.set(key, { digits, ext, max: num, min: num, prefix, relDir });
};

const buildSequenceMap = (outDir: string) => {
    const sequences = new Map<string, SequenceEntry>();

    for (const file of walkDir(outDir)) {
        const rel = path.relative(outDir, file).replace(/\\/g, '/');
        if (rel.startsWith('_external/')) {
            continue;
        }

        updateSequenceMap(sequences, rel);
    }

    return sequences;
};

const getSequenceBounds = (sequence: SequenceEntry, dynamicHint: boolean) => {
    const hintedByDir = sequenceDirHints.some((hint) => sequence.relDir.toLowerCase().includes(hint));
    const allowExpansion = dynamicHint || hintedByDir;
    const lower = allowExpansion ? (sequence.min === 0 ? 0 : 1) : sequence.min;
    let upper = allowExpansion
        ? Math.max(sequence.max, sequenceDefaults[sequence.digits] ?? sequence.max)
        : sequence.max;

    if (upper - lower > maxSequenceSpan) {
        upper = lower + maxSequenceSpan;
    }

    return { lower, upper };
};

const addSequenceUrls = (
    urls: Set<string>,
    origin: string,
    sequence: SequenceEntry,
    dynamicHint: boolean,
    hasMobileVariant: boolean,
) => {
    const { lower, upper } = getSequenceBounds(sequence, dynamicHint);

    for (let index = lower; index <= upper; index++) {
        const num = String(index).padStart(sequence.digits, '0');
        const relPath = `${sequence.prefix}${num}${sequence.ext}`;
        const cleanRel = relPath.replace(/^\/+/, '');
        urls.add(`${origin}/${cleanRel}`);

        if (hasMobileVariant && cleanRel.includes('/textures/') && !cleanRel.includes('-Mobile')) {
            urls.add(`${origin}/${cleanRel.replace(sequence.ext, `-Mobile${sequence.ext}`)}`);
        }
    }
};

export const collectNumericSequenceUrls = async (outDir: string, origin: string) => {
    const sequences = buildSequenceMap(outDir);
    if (sequences.size === 0) {
        return [];
    }

    const [hasMobileVariant, dynamicHint] = await Promise.all([
        detectMobileTextureHint(outDir),
        detectDynamicSequenceHint(outDir),
    ]);
    const urls = new Set<string>();

    for (const sequence of sequences.values()) {
        addSequenceUrls(urls, origin, sequence, dynamicHint, hasMobileVariant);
    }

    return Array.from(urls);
};
