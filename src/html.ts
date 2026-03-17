const HTML_CONTENT_TYPE_RE = /(text\/html|application\/xhtml\+xml)/i;
const HTML_SNIFF_RE = /<(!doctype\s+html|html\b|head\b|body\b)/i;

export const isLikelyHtml = (contentType: string, body: string) => {
    if (HTML_CONTENT_TYPE_RE.test(contentType)) {
        return true;
    }

    const sample = body.slice(0, 4096);
    const normalized = sample.trimStart().replace(/^\uFEFF/, '');
    return HTML_SNIFF_RE.test(normalized);
};
