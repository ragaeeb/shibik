import { DEFAULT_USER_AGENT } from '@/constants.js';
import type { CliArgs } from '@/types.js';

const simpleSlug = (value: string) =>
    value
        .toLowerCase()
        .replace(/^www\./, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');

const isHttpUrl = (value: string | undefined): value is string => {
    if (!value) {
        return false;
    }

    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

const createDefaultArgs = (): CliArgs => {
    return {
        concurrency: 8,
        extraUrlFiles: [],
        extraUrls: [],
        headless: true,
        idleWaitMs: 4000,
        localTest: true,
        localTestRounds: 2,
        maxRetries: 2,
        maxScrolls: 80,
        rewrite: true,
        scroll: true,
        scrollDelayMs: 120,
        scrollStep: 800,
        timeoutMs: 60000,
        userAgent: DEFAULT_USER_AGENT,
        verbose: false,
    };
};

export const defaultNameFromUrl = (urlStr: string) => {
    const url = new URL(urlStr);
    const parts = [
        simpleSlug(url.hostname),
        ...url.pathname
            .split('/')
            .map((part) => simpleSlug(part))
            .filter(Boolean),
    ].filter(Boolean);

    return parts.join('-') || 'cloned-site';
};

export const printHelp = () => {
    const msg = `\
shibik

Usage:
  shibik https://example.com
  shibik --url https://example.com --name my-project
  bunx shibik https://example.com --out ./example

Common options:
  --name <name>           Output folder name (optional; auto-slugged from URL if omitted)
  --out <dir>             Output folder path (overrides --name)
  --origin <origin>       Override origin used for rebasing and missing fetches
  --headful               Run browser in headful mode (default: headless)
  --no-scroll             Disable auto-scroll during capture/testing
  --scroll-step <px>      Scroll step in pixels (default: 800)
  --scroll-delay <ms>     Delay between scrolls in milliseconds (default: 120)
  --max-scrolls <n>       Maximum scroll iterations per pass (default: 80)
  --idle-wait <ms>        Wait after capture interactions (default: 4000)
  --no-rewrite            Skip path rebasing
  --no-local-test         Skip local 404 detection pass
  --rounds <n>            Local 404 fix rounds (default: 2)
  --concurrency <n>       Download concurrency (default: 8)
  --timeout <ms>          Network timeout per request (default: 60000)
  --retries <n>           Download retries per URL (default: 2)
  --user-agent <value>    Override the browser and fetch user agent
  --extra <url>           Extra URL to download (repeatable)
  --extra-file <path>     File with extra URLs (one per line, repeatable)
  --verbose               Verbose logging

Examples:
  shibik https://example.com
  shibik https://example.com ./my-output
  shibik https://example.com/brand/ --out ./brand
  bunx shibik https://example.com --name example-site
`;

    console.log(msg);
};

type FlagValue = {
    consumed: number;
    value: string | undefined;
};

type FlagHandler = {
    apply: (args: CliArgs, value: string | undefined) => void;
    consumesValue: boolean;
};

const takeFlagValue = (argv: string[], index: number, inlineValue?: string): FlagValue => {
    if (inlineValue !== undefined) {
        return { consumed: 0, value: inlineValue };
    }

    const next = argv[index + 1];
    if (next === undefined || next.startsWith('-')) {
        return { consumed: 0, value: undefined };
    }

    return { consumed: 1, value: next };
};

const parseNumberFlag = (flag: string, value: string | undefined) => {
    if (value === undefined) {
        throw new Error(`Missing value for ${flag}`);
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid value for ${flag}: ${value}`);
    }

    return parsed;
};

const setStringFlag = <K extends 'name' | 'origin' | 'out' | 'url' | 'userAgent'>(key: K): FlagHandler => ({
    apply: (args, value) => {
        if (value !== undefined) {
            args[key] = value;
        }
    },
    consumesValue: true,
});

const setNumberFlag = <
    K extends
        | 'concurrency'
        | 'idleWaitMs'
        | 'localTestRounds'
        | 'maxRetries'
        | 'maxScrolls'
        | 'scrollDelayMs'
        | 'scrollStep'
        | 'timeoutMs',
>(
    key: K,
    flag: string,
): FlagHandler => ({
    apply: (args, value) => {
        args[key] = parseNumberFlag(flag, value);
    },
    consumesValue: true,
});

const pushValueFlag = <K extends 'extraUrlFiles' | 'extraUrls'>(key: K): FlagHandler => ({
    apply: (args, value) => {
        if (value !== undefined) {
            args[key].push(value);
        }
    },
    consumesValue: true,
});

const setBooleanFlag = (apply: (args: CliArgs) => void): FlagHandler => ({
    apply: (args) => apply(args),
    consumesValue: false,
});

const flagHandlers: Record<string, FlagHandler> = {
    '--concurrency': setNumberFlag('concurrency', '--concurrency'),
    '--extra': pushValueFlag('extraUrls'),
    '--extra-file': pushValueFlag('extraUrlFiles'),
    '--headful': setBooleanFlag((args) => {
        args.headless = false;
    }),
    '--idle-wait': setNumberFlag('idleWaitMs', '--idle-wait'),
    '--max-scrolls': setNumberFlag('maxScrolls', '--max-scrolls'),
    '--name': setStringFlag('name'),
    '--no-local-test': setBooleanFlag((args) => {
        args.localTest = false;
    }),
    '--no-rewrite': setBooleanFlag((args) => {
        args.rewrite = false;
    }),
    '--no-scroll': setBooleanFlag((args) => {
        args.scroll = false;
    }),
    '--origin': setStringFlag('origin'),
    '--out': setStringFlag('out'),
    '--retries': setNumberFlag('maxRetries', '--retries'),
    '--rounds': setNumberFlag('localTestRounds', '--rounds'),
    '--scroll-delay': setNumberFlag('scrollDelayMs', '--scroll-delay'),
    '--scroll-step': setNumberFlag('scrollStep', '--scroll-step'),
    '--timeout': setNumberFlag('timeoutMs', '--timeout'),
    '--url': setStringFlag('url'),
    '--user-agent': setStringFlag('userAgent'),
    '--verbose': setBooleanFlag((args) => {
        args.verbose = true;
    }),
};

const helpFlags = new Set(['--help', '-h']);

const applyPositionalValue = (args: CliArgs, raw: string) => {
    if (isHttpUrl(raw) && !args.positionalUrl && !args.url) {
        args.positionalUrl = raw;
        return;
    }

    if (!args.positionalOut && !args.out) {
        args.positionalOut = raw;
        return;
    }

    if (!args.positionalUrl && !args.url) {
        args.positionalUrl = raw;
        return;
    }

    throw new Error(`Unexpected positional argument: ${raw}`);
};

const applyFlagValue = (args: CliArgs, argv: string[], index: number, raw: string) => {
    const [flag, inlineValue] = raw.includes('=') ? raw.split(/=(.*)/s) : [raw, undefined];
    if (helpFlags.has(flag)) {
        args.help = true;
        return index;
    }

    const handler = flagHandlers[flag];
    if (!handler) {
        throw new Error(`Unknown option: ${flag}`);
    }

    const { consumed, value } = takeFlagValue(argv, index, inlineValue);
    if (handler.consumesValue && value === undefined) {
        throw new Error(`Missing value for ${flag}`);
    }

    handler.apply(args, value);
    return index + (handler.consumesValue ? consumed : 0);
};

const validateNumberArg = (
    args: CliArgs,
    key:
        | 'concurrency'
        | 'idleWaitMs'
        | 'localTestRounds'
        | 'maxRetries'
        | 'maxScrolls'
        | 'scrollDelayMs'
        | 'scrollStep'
        | 'timeoutMs',
    flag: string,
    minimum: number,
) => {
    const value = args[key];
    if (!Number.isInteger(value) || value < minimum) {
        throw new Error(`Invalid value for ${flag}: ${String(value)}`);
    }
};

const validateArgs = (args: CliArgs) => {
    validateNumberArg(args, 'concurrency', '--concurrency', 1);
    validateNumberArg(args, 'idleWaitMs', '--idle-wait', 0);
    validateNumberArg(args, 'localTestRounds', '--rounds', 0);
    validateNumberArg(args, 'maxRetries', '--retries', 1);
    validateNumberArg(args, 'maxScrolls', '--max-scrolls', 0);
    validateNumberArg(args, 'scrollDelayMs', '--scroll-delay', 0);
    validateNumberArg(args, 'scrollStep', '--scroll-step', 1);
    validateNumberArg(args, 'timeoutMs', '--timeout', 1);

    if (args.url && !isHttpUrl(args.url)) {
        throw new Error(`Target URL must use http:// or https://: ${args.url}`);
    }

    if (args.origin && !isHttpUrl(args.origin)) {
        throw new Error(`Origin must use http:// or https://: ${args.origin}`);
    }
};

export const parseArgs = (argv: string[]): CliArgs => {
    const args = createDefaultArgs();

    for (let index = 0; index < argv.length; index++) {
        const raw = argv[index];
        if (!raw) {
            continue;
        }

        if (!raw.startsWith('-')) {
            applyPositionalValue(args, raw);
            continue;
        }

        index = applyFlagValue(args, argv, index, raw);
        if (args.help) {
            break;
        }
    }

    if (!args.url && args.positionalUrl) {
        args.url = args.positionalUrl;
    }
    if (!args.out && args.positionalOut) {
        args.out = args.positionalOut;
    }

    validateArgs(args);
    return args;
};
