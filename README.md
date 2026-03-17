# shibik

[![Bun](https://img.shields.io/badge/runtime-Bun-000000?logo=bun&logoColor=f9f1e1)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Puppeteer](https://img.shields.io/badge/browser-Puppeteer-40B5A4?logo=puppeteer&logoColor=white)](https://pptr.dev)
[![Biome](https://img.shields.io/badge/lint-Biome-60A5FA?logo=biome&logoColor=white)](https://biomejs.dev)
[![semantic-release](https://img.shields.io/badge/release-semantic--release-e10079?logo=semantic-release&logoColor=white)](https://semantic-release.gitbook.io)

`shibik` captures a live website, downloads its fetched assets, rewrites paths for local hosting, and runs a local 404 recovery pass. It is designed for modern WebGL, Three.js, Framer, and other asset-heavy marketing sites where a plain `wget` mirror usually fails.

`shibik` is a Bun-first CLI. The runtime and implementation prefer Bun-native APIs such as `Bun.file`, `Bun.write`, `Bun.Glob`, and `Bun.serve`; Node.js compatibility is not a project goal.

Requires Bun `1.3.10` or newer.

## Install

Run without installing:

```bash
bunx shibik https://example.com
```

Or install globally with Bun:

```bash
bun add -g shibik
```

## Usage

Basic:

```bash
bunx shibik https://example.com
```

Named output folder:

```bash
bunx shibik https://example.com --name example-site
```

Explicit output path:

```bash
bunx shibik https://example.com/brand/ --out ./brand
```

Positional output path:

```bash
bunx shibik https://example.com/brand/ ./brand
```

Useful options:

```text
--url <url>           Target URL. Optional if the first positional arg is a URL.
--name <name>         Output folder name. Auto-generated from the URL when omitted.
--out <dir>           Output folder path. Overrides --name.
--origin <origin>     Override the origin used for rebasing and missing fetches.
--headful             Run the browser visibly instead of headless.
--no-scroll           Skip auto-scroll during capture and local testing.
--scroll-step <px>    Scroll step in pixels. Default: 800.
--scroll-delay <ms>   Delay between scroll steps. Default: 120.
--max-scrolls <n>     Maximum scroll steps per pass. Default: 80.
--idle-wait <ms>      Wait after page interaction settles. Default: 4000.
--no-rewrite          Skip path rebasing.
--no-local-test       Skip the local missing-asset recovery pass.
--rounds <n>          Number of local 404 recovery rounds. Default: 2.
--extra <url>         Add an extra asset URL to download. Repeatable.
--extra-file <path>   Read extra URLs from a file, one per line.
--retries <n>         Retry count for each download. Default: 2.
--user-agent <value>  Override the browser and fetch user agent.
--verbose             Print per-request diagnostics.
```

## Output

Each run creates a target directory with the cloned files and a `.clone/` folder containing capture artifacts such as:

- `urls.txt`
- `embedded-urls.txt`
- `manifest-urls.txt`
- `sequence-urls.txt`
- `missing-round-*.txt`
- `captured-entry.html`

These files are the first place to inspect when a clone still has runtime 404s.

## Local Smoke Test

Serve the cloned folder directly:

```bash
cd example-site
bunx serve
```

Direct-folder hosting is the expected smoke test. Some sites hardcode root-relative fetches and behave differently if served from a parent directory.

## Development

This repository treats Bun as the primary runtime, package manager, test runner, and local server toolchain. When touching filesystem code, prefer Bun-native APIs and keep any `node:fs/promises` usage limited to directory primitives Bun does not currently expose directly.

Install dependencies:

```bash
bun install
```

Run checks:

```bash
bun run check
bun run typecheck
bun test
```

Build the published CLI:

```bash
bun run build
```

The build includes a post-step that rewrites `@/` path aliases in `dist/` to relative imports so `bunx shibik` works from a published package without needing `tsconfig.json`.

## Release

Releases are driven by semantic-release from GitHub Actions. Commits should follow conventional commit format such as:

- `fix: handle root-level _next assets`
- `feat: support positional URL input`
- `docs: clarify smoke test workflow`
