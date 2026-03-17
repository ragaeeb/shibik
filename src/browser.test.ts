import { describe, expect, it } from 'bun:test';

import { drainPendingTasks } from '@/browser.js';

describe('drainPendingTasks', () => {
    it('should wait for tasks added while draining', async () => {
        const pending = new Set<Promise<void>>();
        const completed: string[] = [];

        let secondTask: Promise<void> | null = null;
        const firstTask = Promise.resolve().then(async () => {
            completed.push('first');
            pending.delete(firstTask);
            secondTask = Promise.resolve().then(() => {
                completed.push('second');
                if (secondTask) {
                    pending.delete(secondTask);
                }
            });
            pending.add(secondTask);
        });

        pending.add(firstTask);

        await drainPendingTasks(pending);

        expect(completed).toEqual(['first', 'second']);
        expect(pending.size).toBe(0);
    });
});
