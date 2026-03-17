# 🔬 Shibik Code Review & Architecture Audit

## 📊 Executive Summary
Overall, Shibik features a powerful premise for automating complex localized site clones, making excellent usage of Puppeteer and custom DOM-exercise routines to reveal lazy-loaded heuristics. However, an in-depth code audit reveals significant issues revolving around synchronous I/O blocking during concurrency, critical memory leaks due to unhandled promise rejections, brittle manual argument parsing, and massive maintainability hurdles. 

The codebase currently deviates from the documented `AGENTS.md` specifications in its regex usage and suffers from a lack of automated testing for the core engine. Below is a comprehensive breakdown of bugs, performance bottlenecks, architectural anti-patterns, and DX/testing gaps.

---

## 🐛 1. Critical Bugs & Resource Leaks

### Uncleared `setTimeout` in Network Fetch
In `downloadUrl` (`src/core.ts:320`), the `clearTimeout` is invoked inside the `try` block immediately after `await fetch(urlStr, ...)`. If `fetch` throws an error (e.g., due to a network failure or abort timeout), the execution jumps to the `catch` block and **`clearTimeout(timeout)` is never called**. This leaks timeout handles, keeping the Node process artifically alive and causing severe memory leaks.
* **Fix**: Move `clearTimeout(timeout)` inside a `finally` block to guarantee execution.

### Orphaned HTTP Server & Browser Instances
In `findMissingAssets` (`src/core.ts:1248`), a local HTTP server and a Puppeteer browser instance are spawned. If `page.goto` or `browser.newPage` throws an exception, the function rejects and exits early. However, there are no `finally` blocks ensuring `server.close()` and `browser.close()` are called on failure. This leads to leaked zombie Chromium processes and unclosed local ports.
* **Fix**: Wrap server/browser logic in a `try...finally` block.

### Buggy Custom CLI Parser
In `src/args.ts`, the manual flag parser increments the index (`i++`) when `inlineValue === undefined` without verifying if the `next` value is actually another flag.
For instance, running `shibik --out --url https://example.com` assigns the string `"--url"` to `args.out`, skips the *actual* parsed URL, and breaks the CLI execution.
* **Fix**: Use Node's native `node:util` `parseArgs()`, or rewrite the parser to greedily assert positional tracking by checking `next.startsWith("-")`.

---

## 🐢 2. Performance & Scale Bottlenecks

### Event Loop Blocking (`fs.*Sync` methods)
Despite using an async `runWithConcurrency` worker pool with a tunable concurrency limit, the inner worker methods (`downloadUrl`, `saveCapturedEntryHtml`, `ensureDir`) rely completely on synchronous Node.js I/O operations (`fs.writeFileSync`, `fs.mkdirSync`, `fs.existsSync`). Synchronous operations block the Node event loop, forcing the "parallel" workers to essentially execute linearly across the thread, negating the throughput benefits of concurrency limiters.
* **Fix**: Migrate `fs.*Sync` to `node:fs/promises` across all concurrent paths.

### OOM Risk: Full Buffer Reads/Writes
When downloading assets in `downloadUrl`, the app buffers the entire payload into RAM (`Buffer.from(await res.arrayBuffer())`) before writing to disk synchronously. Downloading large assets (e.g., a 500MB `.webm` hero video or WebGL asset) will easily trigger an Out-Of-Memory (OOM) runtime crash.
* **Fix**: Instead of buffering arrays into memory, use streams to write chunks straight to disk (e.g., `import { pipeline } from "node:stream/promises"`, piping `res.body` to `fs.createWriteStream`).

### Wasteful Worker Allocation
In `runWithConcurrency` (`src/core.ts:247`), the system blindly creates workers up to `limit`: `Array.from({ length: Math.max(1, limit) })`. If you pass an array of `2` items but the concurrency limit is `8`, it spawns 6 idle asynchronous workers that do absolutely nothing. 
* **Fix**: Use `Math.min(limit, items.length)`.

---

## 🛡️ 3. Brittle Code & Spec Deviations

### Catastrophic Regex Backtracking (AGENTS.md Violation)
The `AGENTS.md` spec explicitly demands: *"If you add heuristics for new sites, favor narrow, defensible rules over broad regexes that can explode download volume."*
However, `bareAssetRegex`, `assetFilenameRegex` and relative regexes in `core.ts:980` directly contradict this. They employ extremely broad, greedy wildcard patterns `([^'"`\s]+?)` combined with massive lookaheads. Running these regexes over large multimegabyte minified JS bundles carries high CPU backtracking risk and captures overly aggressive false positives.

### Hardcoded Heuristics Deep in Core
Extensive arrays of hardcoded folder mappings (e.g., `["_next", "assets", "Assets", "static", "media", "images", ...]`) are embedded statically throughout traversal functions (`mirrorRootToEntry`). This is brittle and doesn't adapt dynamically to uniquely structured frameworks. 
* **Fix**: Move heuristics out of the engine and into configurable constants, or read them from a user-supplied configuration override if requested.

---

## 🏗️ 4. Architecture & Anti-Patterns

### The Monolith: `core.ts`
`core.ts` is over 1,600+ lines long, severely violating the Single Responsibility Principle. It mixes HTTP abstractions, file traversal mapping, Puppeteer automation, and CLI bridging together.
* **Fix**: Abstract logic out into domain-specific modules: `browser.ts`, `network.ts`, `parser.ts`, `io.ts`.

### Logic Duplication (DRY Violations)
Functions like `mirrorEntryDirFolders`, `mirrorLeafToParent`, `mirrorLeafToRoot`, and `mirrorRootToEntry` duplicate the exact identical block of complex Stack-based BFS iteration tree-walking to perform safe file copies.
* **Fix**: Extract the BFS mapping loop into a reusable `copyDirStructure(source, target)` util.

### Subverting TypeScript with `any`
Methods like `extractManifestAssets(node: any)` and generic catch blocks `catch (err: any)` actively bypass the TypeScript compiler. This masks systemic runtime data-handling errors.
* **Fix**: Use stricter typing. Catch blocks should type errors as `unknown` followed by `if (err instanceof Error)` checks.

### Broken stdout/stderr Conventions
In `src/logger.ts`, `log("WARN", ...)` and `log("ERROR", ...)` invoke `console.log`. Diagnostic and error logs should always output to `stderr` (`console.error` and `console.warn`). Printing warnings and errors to standard-out breaks piping semantics for terminal users who pipe final program output.

---

## 🧪 5. Testing & Developer Experience (DX) Gaps

### Abysmal Test Coverage
The `test/cli.test.ts` file isolates logic checking to string arguments parsing. Currently, **0%** of the complex heuristics in `url.ts` (like `looksLikeAssetUrl` and `collapseDuplicateSegments`) are explicitly tested. Furthermore, there are zero integration tests verifying the behavior of `core.ts`. Regressions on complex string URL matchers are highly likely.
* **Gap Fix**: Write comprehensive unit tests for `url` utility mapping, and implement lightweight integration tests with a Mock Server rather than hitting external endpoints.

### Missing Error Diagnostics & Debug Modes
If a clone fails during `page.goto` or the Puppeteer browser crashes, the error logs are heavily muted. If a DOM interaction target stalls, there's no visual proof of what the browser saw.
* **DX Fix**: Implement a `--debug` flag that routes `page.on("console")` outputs from the headless Chromium instance natively to the Node terminal, and performs `.screenshot()` dumps when network timeouts are reached to visually diagnose what blocked execution.
