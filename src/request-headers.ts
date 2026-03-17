type HeaderSource = Headers | Record<string, string>;

const BLOCKED_REQUEST_HEADERS = new Set([
    'accept-encoding',
    'connection',
    'content-length',
    'cookie',
    'host',
    'if-range',
    'range',
]);

export const getHeaderValue = (headers: HeaderSource, name: string) => {
    if (headers instanceof Headers) {
        return headers.get(name) ?? headers.get(name.toLowerCase()) ?? '';
    }

    const needle = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === needle && value) {
            return value;
        }
    }

    return '';
};

export const hasRangeRequestHeaders = (headers: HeaderSource) => {
    return Boolean(getHeaderValue(headers, 'range') || getHeaderValue(headers, 'if-range'));
};

export const stripUnsafeRequestHeaders = (headers: Record<string, string>) => {
    const entries = Object.entries(headers).filter(
        ([key, value]) => Boolean(value) && !key.startsWith(':') && !BLOCKED_REQUEST_HEADERS.has(key.toLowerCase()),
    );

    return Object.fromEntries(entries);
};
