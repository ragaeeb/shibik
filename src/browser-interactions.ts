export type InteractionCandidate = {
    display: string;
    height: number;
    href: string;
    isAnchor: boolean;
    pointerEvents: string;
    visibility: string;
    width: number;
    withinViewport: boolean;
    x: number;
    y: number;
};

const normalizePathname = (pathname: string) => {
    if (pathname.length > 1 && pathname.endsWith('/')) {
        return pathname.slice(0, -1);
    }

    return pathname || '/';
};

export const isAllowedAnchorCandidate = (candidate: InteractionCandidate, pageUrl: string) => {
    if (!candidate.isAnchor || !candidate.href) {
        return true;
    }

    if (
        candidate.href.startsWith('javascript:') ||
        candidate.href.startsWith('mailto:') ||
        candidate.href.startsWith('tel:')
    ) {
        return false;
    }

    try {
        const current = new URL(pageUrl);
        const resolved = new URL(candidate.href, pageUrl);
        return (
            resolved.origin === current.origin &&
            normalizePathname(resolved.pathname) === normalizePathname(current.pathname) &&
            resolved.search === current.search
        );
    } catch {
        return false;
    }
};

export const isVisibleCandidate = (candidate: InteractionCandidate) => {
    return (
        candidate.width >= 8 &&
        candidate.height >= 8 &&
        candidate.visibility !== 'hidden' &&
        candidate.display !== 'none' &&
        candidate.pointerEvents !== 'none' &&
        candidate.withinViewport
    );
};

export const selectInteractionTargets = (candidates: InteractionCandidate[], pageUrl: string, limit: number) => {
    const unique = new Set<string>();
    const points: Array<{ x: number; y: number }> = [];

    for (const candidate of candidates) {
        if (!isVisibleCandidate(candidate) || !isAllowedAnchorCandidate(candidate, pageUrl)) {
            continue;
        }

        const key = `${candidate.x}:${candidate.y}`;
        if (unique.has(key)) {
            continue;
        }

        unique.add(key);
        points.push({ x: candidate.x, y: candidate.y });
        if (points.length >= limit) {
            break;
        }
    }

    return points;
};
