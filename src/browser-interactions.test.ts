import { describe, expect, it } from 'bun:test';

import { selectInteractionTargets } from '@/browser-interactions.js';

const visibleButtonCandidate = {
    display: 'block',
    height: 32,
    href: '',
    isAnchor: false,
    pointerEvents: 'auto',
    visibility: 'visible',
    width: 120,
    withinViewport: true,
    x: 40,
    y: 50,
};

describe('selectInteractionTargets', () => {
    it('should exclude external anchors while keeping same-origin interactions', () => {
        const targets = selectInteractionTargets(
            [
                {
                    ...visibleButtonCandidate,
                    href: 'https://spaceship-blush.vercel.app/',
                    isAnchor: true,
                    x: 10,
                    y: 20,
                },
                {
                    ...visibleButtonCandidate,
                    href: 'https://space-drive.artcreativecode.com/en#intro',
                    isAnchor: true,
                    x: 20,
                    y: 30,
                },
                visibleButtonCandidate,
            ],
            'https://space-drive.artcreativecode.com/en',
            24,
        );

        expect(targets).toEqual([
            { x: 20, y: 30 },
            { x: 40, y: 50 },
        ]);
    });

    it('should skip invisible and duplicate targets', () => {
        const targets = selectInteractionTargets(
            [
                {
                    ...visibleButtonCandidate,
                    display: 'none',
                },
                visibleButtonCandidate,
                {
                    ...visibleButtonCandidate,
                    href: '/fr',
                    isAnchor: true,
                },
            ],
            'https://space-drive.artcreativecode.com/en',
            24,
        );

        expect(targets).toEqual([{ x: 40, y: 50 }]);
    });
});
