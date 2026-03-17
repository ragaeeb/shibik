import { describe, expect, it } from 'bun:test';

import { defaultNameFromUrl, parseArgs } from '@/args.js';

describe('parseArgs', () => {
    it('should accept a positional URL', () => {
        const args = parseArgs(['https://example.com/demo']);
        expect(args.url).toBe('https://example.com/demo');
    });

    it('should prefer explicit --url over positional values', () => {
        const args = parseArgs(['https://ignored.example', '--url', 'https://used.example']);
        expect(args.url).toBe('https://used.example');
    });

    it('should accept a positional output directory', () => {
        const args = parseArgs(['https://example.com/demo', '../threejs']);
        expect(args.url).toBe('https://example.com/demo');
        expect(args.out).toBe('../threejs');
    });

    it('should accept a positional output directory after --url', () => {
        const args = parseArgs(['--url', 'https://example.com/demo', '../threejs']);
        expect(args.url).toBe('https://example.com/demo');
        expect(args.out).toBe('../threejs');
    });

    it('should accept a positional output directory before the positional url', () => {
        const args = parseArgs(['../threejs', 'https://example.com/demo']);
        expect(args.url).toBe('https://example.com/demo');
        expect(args.out).toBe('../threejs');
    });

    it('should prefer explicit --out over positional output', () => {
        const args = parseArgs(['https://example.com/demo', '../ignored', '--out', './used']);
        expect(args.out).toBe('./used');
    });

    it('should keep repeatable extra URL flags', () => {
        const args = parseArgs([
            'https://example.com',
            '--extra',
            'https://example.com/a.png',
            '--extra=https://example.com/b.png',
        ]);
        expect(args.extraUrls).toEqual(['https://example.com/a.png', 'https://example.com/b.png']);
    });

    it('should fail fast when an option value is missing', () => {
        expect(() => parseArgs(['--out', '--url', 'https://example.com/demo'])).toThrow('Missing value for --out');
    });

    it('should reject invalid numeric flag values', () => {
        expect(() => parseArgs(['https://example.com', '--timeout', 'oops'])).toThrow(
            'Invalid value for --timeout: oops',
        );
        expect(() => parseArgs(['https://example.com', '--concurrency', '0'])).toThrow(
            'Invalid value for --concurrency: 0',
        );
    });

    it('should reject unknown flags', () => {
        expect(() => parseArgs(['https://example.com', '--wat'])).toThrow('Unknown option: --wat');
    });

    it('should reject non-http positional urls', () => {
        expect(() => parseArgs(['./relative-path', 'not-a-url'])).toThrow(
            'Target URL must use http:// or https://: not-a-url',
        );
    });
});

describe('defaultNameFromUrl', () => {
    it('should create a stable folder slug from the URL', () => {
        expect(defaultNameFromUrl('https://www.example.com/brand/demo/')).toBe('example-com-brand-demo');
    });

    it('should fall back to the hostname for root URLs', () => {
        expect(defaultNameFromUrl('https://clock3d.vercel.app')).toBe('clock3d-vercel-app');
    });
});
