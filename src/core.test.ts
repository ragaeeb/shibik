import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { main } from '@/core.js';

describe('main', () => {
    afterEach(() => {
        process.exitCode = 0;
    });

    it('should print help and set a non-zero exit code when argument parsing fails', async () => {
        const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
        const logSpy = spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            await main(['--timeout', '-1']);
            expect(errorSpy).toHaveBeenCalledWith('Error: Invalid value for --timeout: -1');
            expect(logSpy).toHaveBeenCalled();
            expect(process.exitCode).toBe(1);
        } finally {
            errorSpy.mockRestore();
            logSpy.mockRestore();
        }
    });
});
