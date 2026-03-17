import { describe, expect, it } from 'bun:test';

import { isLikelyHtml } from '@/html.js';

describe('isLikelyHtml', () => {
    it('should treat text/html as html regardless of body', () => {
        expect(isLikelyHtml('text/html; charset=utf-8', 'plain text')).toBe(true);
    });

    it('should treat XHTML as html regardless of body', () => {
        expect(isLikelyHtml('application/xhtml+xml', '<svg></svg>')).toBe(true);
    });

    it('should detect html even when content-type is missing or wrong', () => {
        const body = '<!doctype html><html><head></head><body>Hi</body></html>';
        expect(isLikelyHtml('binary', body)).toBe(true);
    });

    it('should ignore non-html payloads when content-type is wrong', () => {
        expect(isLikelyHtml('binary', '{"ok":true}')).toBe(false);
    });
});
