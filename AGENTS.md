# Agent Workflow

This repository ships `shibuk`, a CLI for capturing and localizing complex websites into static clones that can be served locally.

## Project Shape

- Source code lives in `src/`.
- Keep the CLI entrypoint thin in `src/cli.ts`.
- Put reusable parsing and utility logic in focused modules such as `src/args.ts`, `src/url.ts`, `src/logger.ts`, and `src/types.ts`.
- Keep the high-level orchestration in `src/core.ts`.
- Published output is generated into `dist/`.
- CI and release automation live in `.github/workflows/`.

## Core Commands

Install dependencies:

```bash
bun install
```

Run lint and formatting checks:

```bash
bun run check
```

Run type checks:

```bash
bun run typecheck
```

Run tests:

```bash
bun test
```

Build the distributable CLI:

```bash
bun run build
```

Run the CLI locally:

```bash
bun run src/cli.ts https://example.com
```

## Engineering Notes

- This project is Bun-first. Node.js backwards compatibility is not a goal.
- Target Bun `1.3.10+` unless the repository explicitly bumps the runtime.
- Prefer Bun-native runtime APIs for filesystem and local serving work: `Bun.file`, `Bun.write`, `Bun.Glob`, and `Bun.serve`.
- If Bun does not expose a needed directory primitive yet, use the smallest possible `node:fs/promises` fallback and keep it isolated to focused utility modules.
- Build output in `dist/` must avoid `@/` path aliases; the build pipeline rewrites them to relative imports so `bunx shibuk` can run without a bundled `tsconfig.json`.
- The first positional argument should be treated as the target URL when `--url` is omitted.
- Avoid regressing the local recovery flow. The core value of the tool is not just capture, but also rebasing, asset discovery, and iterative missing-asset repair.
- Keep `.clone/` artifacts documented and stable. They are part of the debugging workflow.
- If you add heuristics for new sites, favor narrow, defensible rules over broad regexes that can explode download volume.
- Use `type` aliases instead of `interface`.
- Prefer `const name = (...) => {}` over classic `function name(...) {}` declarations.
- Add unit tests for pure helpers whenever practical, and use the `it("should ...")` naming convention in `bun:test`.
- Unit-tests must live in the same directory as their implementations files, not in a `test` or `__tests__` directory.
- When refactoring, move testable logic out of `src/core.ts` before changing behavior.

## Release Expectations

- Use conventional commits so semantic-release can cut the correct version.
- `main` is the release branch.
- Changes that affect publishability should be validated with `bun run check`, `bun run typecheck`, `bun test`, and `bun run build`.
