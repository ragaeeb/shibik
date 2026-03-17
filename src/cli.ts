#!/usr/bin/env bun
import { pathToFileURL } from 'node:url';

import { main } from '@/core.js';

const isEntrypoint = typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
        console.error(message);
        process.exit(1);
    });
}
