import { describe, expect, it } from 'bun:test';

import { rewriteImports } from './rewrite-dist-imports.ts';

describe('rewriteImports', () => {
    it('should preserve double-quoted import specifiers', () => {
        expect(rewriteImports('import { main } from "@/core.js";')).toBe('import { main } from "./core.js";');
    });

    it('should preserve single-quoted side-effect imports', () => {
        expect(rewriteImports("import '@/runtime.js';")).toBe("import './runtime.js';");
    });

    it('should rewrite dynamic imports that use the alias prefix', () => {
        expect(rewriteImports("const module = await import('@/runtime.js');")).toBe(
            "const module = await import('./runtime.js');",
        );
    });
});
