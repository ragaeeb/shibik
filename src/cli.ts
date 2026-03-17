#!/usr/bin/env bun
import { main } from '@/core.js';

if (import.meta.main) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        console.error(message);
        process.exit(1);
    });
}
