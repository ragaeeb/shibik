import { describe, expect, it } from 'bun:test';

import { distPathFromSource, isBuildSourceFile, restoreShebang } from './build-dist.ts';

describe('isBuildSourceFile', () => {
    it('should include runtime source files and exclude colocated tests', () => {
        expect(isBuildSourceFile('src/cli.ts')).toBe(true);
        expect(isBuildSourceFile('src/cli.test.ts')).toBe(false);
    });
});

describe('distPathFromSource', () => {
    it('should map source modules into dist javascript paths', () => {
        expect(distPathFromSource('src/cli.ts')).toBe('dist/cli.js');
        expect(distPathFromSource('src/nested/demo.test.ts')).toBe('dist/nested/demo.test.js');
    });
});

describe('restoreShebang', () => {
    it('should preserve a source shebang on minified output', () => {
        const source = '#!/usr/bin/env bun\nconsole.log("hi");\n';
        const output = 'console.log("hi");';

        expect(restoreShebang(source, output)).toBe('#!/usr/bin/env bun\nconsole.log("hi");');
    });

    it('should not add a shebang when the source file is not executable', () => {
        expect(restoreShebang('console.log("hi");\n', 'console.log("hi");')).toBe('console.log("hi");');
    });
});
