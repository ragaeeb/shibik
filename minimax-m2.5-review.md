# shibik Code Review Report

**Review Date:** March 17, 2026  
**Reviewer:** Matrix Agent  
**Project:** shibik - CLI for capturing and localizing complex websites  
**Scope:** Full codebase review including src/, test/, and configuration files

---

## Executive Summary

This report presents a comprehensive code review of the shibik project. The codebase demonstrates solid architectural decisions and follows many best practices outlined in AGENTS.md. However, several significant issues were identified that affect maintainability, testability, type safety, and user experience. The most critical concerns are the lack of tests for core orchestration logic, extensive use of `any` types compromising type safety, and incomplete CLI documentation.

---

## 1. Specification Compliance Issues

### 1.1 High-Level Orchestration Violation

**File:** `src/core.ts`  
**Severity:** High

The AGENTS.md specification states: "Keep the high-level orchestration in `src/core.ts`." However, core.ts has grown to 1669 lines containing extensive implementation details rather than orchestration. The file mixes low-level file operations, URL processing, Puppeteer automation, path rewriting, and manifest parsing into a single monolithic module.

**Recommendation:** Extract focused modules such as:
- `src/downloader.ts` - URL downloading logic
- `src/rewriter.ts` - Path rewriting utilities
- `src/scraper.ts` - Puppeteer capture logic
- `src/manifest.ts` - Manifest asset collection

### 1.2 Missing CLI Flag Documentation

**File:** `src/args.ts`  
**Severity:** Medium

The `printHelp()` function is missing documentation for several supported CLI flags that are implemented in `parseArgs()`:

| Missing Flag | Description | Default |
|--------------|-------------|---------|
| `--scroll-step` | Scroll step in pixels | 800 |
| `--scroll-delay` | Delay between scrolls (ms) | 120 |
| `--max-scrolls` | Maximum scroll operations | 80 |
| `--idle-wait` | Wait time after idle (ms) | 4000 |
| `--retries` | Maximum download retries | 2 |
| `--user-agent` | Custom User-Agent string | Chrome UA |

**Recommendation:** Add these flags to the help text in `printHelp()`.

### 1.3 Misleading Flag Description

**File:** `src/args.ts`, line 41  
**Severity:** Low

```typescript
--headful               Run browser in headful mode
```

The description is accurate but could be clearer. When `--headful` is specified, it sets `headless: false`. Consider adding "(default: headless)" for clarity.

---

## 2. Type Safety Issues

### 2.1 Extensive Use of `any` Type

**Files:** `src/core.ts`  
**Severity:** High

The codebase extensively uses the `any` type, which defeats TypeScript's type safety benefits:

```typescript
// Line ~985
let json: any;

// Line ~1047
const extractManifestAssets = (node: any, assets: Set<string>) => {

// Line ~1069
const extractAssetsFromJson = (node: any, assets: Set<string>) => {
```

**Recommendation:** Define proper types for manifest structures. For example:

```typescript
interface ManifestFile {
  files?: Record<string, string | string[]>;
  type?: string;
}

interface ManifestNode {
  type?: string;
  files?: Record<string, ManifestNode | string[]>;
}
```

### 2.2 Untyped Error Handling

**File:** `src/core.ts`  
**Severity:** Medium

```typescript
// Line ~285
catch (err: any) {
  log("WARN", `Navigation warning: ${err?.message ?? err}`);
}

// Line ~357
catch (err: any) {
  log("WARN", `Invalid URL skipped: ${urlStr} (${err?.message ?? err})`);
}
```

**Recommendation:** Use `unknown` type with proper type narrowing:

```typescript
catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  log("WARN", `Navigation warning: ${message}`);
}
```

---

## 3. Error Handling Concerns

### 3.1 Silent Failures with Empty Catch Blocks

**File:** `src/core.ts`  
**Severity:** Medium

Multiple locations have catch blocks that silently ignore errors:

```typescript
// Line ~250
catch {
  // ignore
}

// Line ~733
catch {
  continue;
}

// Line ~1315
catch {
  // ignore invalid entry url
}
```

**Impact:** Real errors can be silently swallowed, making debugging difficult.

**Recommendation:** At minimum, log warnings for unexpected errors. Consider failing fast for truly unexpected conditions.

### 3.2 Incomplete Error Handling in URL Processing

**File:** `src/url.ts`  
**Severity:** Low

```typescript
export const shouldSkipUrl = (urlStr: string) => {
  // ...
  if (/^https?:\/\/fonts\.(gstatic|googleapis)\.com\/?$/i.test(urlStr)) return true;
  // Missing: What if urlStr is not a valid URL?
```

**Recommendation:** Add early validation for malformed URLs before regex operations.

---

## 4. Testing Gaps

### 4.1 No Tests for Core Orchestration

**Severity:** Critical

The `src/core.ts` file (1669 lines) has **zero tests**. This is the main orchestration module containing:
- Puppeteer browser automation
- File downloading and writing
- Path rewriting logic
- Local server functionality
- Asset discovery and repair

**Current Test Coverage:**
- `test/url.ts` - 4 tests for URL utilities
- `test/cli.ts` - 5 tests for argument parsing

**Recommendation:** Add tests for critical functions in core.ts:
- `captureUrls()` - Mock Puppeteer
- `downloadUrl()` - Test various HTTP responses
- `rewritePaths()` - Test path transformations
- `findMissingAssets()` - Test 404 detection

### 4.2 Missing Test Cases

**Files:** `test/url.test.ts`, `test/cli.test.ts`  
**Severity:** Medium

Current tests only cover happy paths. Missing test cases include:

**url.ts:**
- `shouldSkipUrl()` - No tests at all
- `hasAssetExtension()` - No tests
- `looksLikeAssetUrl()` - No tests
- `normalizeEmbeddedUrl()` - Only 2 tests, missing edge cases

**args.ts:**
- Invalid URL handling
- Numeric argument validation (NaN prevention)
- Unknown flag handling

---

## 5. Performance Concerns

### 5.1 Synchronous File Operations

**File:** `src/core.ts`  
**Severity:** Medium

The codebase uses synchronous file operations throughout:

```typescript
fs.writeFileSync(absPath, buffer);
fs.readFileSync(file, "utf8");
fs.readdirSync(dir, { withFileTypes: true });
```

**Impact:** These block the Node.js event loop, potentially causing UI freeze or timeout issues during large site captures.

**Recommendation:** Consider async alternatives for large-scale operations:
- `fs.promises.writeFile()` for single files
- Stream-based processing for large files
- Worker threads for CPU-intensive path rewriting

### 5.2 Inefficient Concurrency Model

**File:** `src/core.ts`, lines 309-320  
**Severity:** Low

```typescript
const runWithConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<void>
) => {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length) {
      const current = index++;
      await worker(items[current], current);
    }
  });
  await Promise.all(workers);
};
```

This creates a fixed pool of workers that process items sequentially within each worker. For I/O-bound operations, this is acceptable but could be improved with a proper queue-based approach for better error handling and progress tracking.

---

## 6. Code Organization Issues

### 6.1 Implementation Details in Constants

**File:** `src/constants.ts`  
**Severity:** Low

```typescript
export const TRANSPARENT_PNG = Buffer.from(/* base64 */);
export const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" ...';
```

These are implementation details specific to placeholder generation and could be moved to `core.ts` since they're only used there.

### 6.2 Mixed Concerns in logger.ts

**File:** `src/logger.ts`  
**Severity:** Low

```typescript
export const log = (level: LogLevel, message: string) => { /* ... */ };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
```

The `sleep` function is not a logging utility. It should be in a separate `utils.ts` or moved to `core.ts`.

### 6.3 Overly Exported Module

**File:** `src/core.ts`  
**Severity:** Low

Many internal functions are exported that may not be part of the public API:
- `ensureDir`
- `mapUrlToLocalPath`
- `autoScroll`
- `exercisePage`
- `captureUrls`
- `runWithConcurrency`

**Recommendation:** Review exports and consider making internal functions private to the module.

---

## 7. Code Smells and Anti-Patterns

### 7.1 Magic Numbers

**File:** `src/core.ts`  
**Severity:** Low

```typescript
await sleep(500);           // Line ~145
await sleep(400);           // Line ~184
await sleep(300);           // Line ~191
await sleep(150);           // Line ~197
await sleep(500);           // Line ~271
await new Promise((r) => setTimeout(r, 300 * attempt));  // Line ~395
```

**Recommendation:** Define these as named constants:

```typescript
const CLICK_DELAY_MS = 500;
const RETRY_BACKOFF_BASE_MS = 300;
```

### 7.2 Regex Compilation in Loops

**File:** `src/core.ts`, lines ~750-820  
**Severity:** Medium

Regex patterns are compiled inside loops in the `rewritePaths()` function:

```typescript
for (const file of files) {
  // ...
  const originPattern = new RegExp(`https?:\\/\\/${escapeRegex(originHost)}\\/`, "g");
  // ...
}
```

**Recommendation:** Move regex compilation outside the loop:

```typescript
const originPattern = new RegExp(`https?:\\/\\/${escapeRegex(originHost)}\\/`, "g");
for (constfile of files) {
  // Use pre-compiled regex
}
```

### 7.3 Repeated Similar Logic

**File:** `src/core.ts`  
**Severity:** Low

The `mirror*` functions (mirrorEntryDirFolders, mirrorLeafToParent, mirrorLeafToRoot, mirrorRootToEntry) share significant duplicate code for directory traversal and file copying.

**Recommendation:** Extract common directory walking and copying logic into reusable helper functions.

---

## 8. Maintainability Issues

### 8.1 Large Function Complexity

**File:** `src/core.ts`  
**Severity:** Medium

Several functions exceed reasonable complexity thresholds:

| Function | Approximate Lines | Concern |
|----------|-------------------|----------|
| `main()` | ~200 | Too many responsibilities |
| `rewritePaths()` | ~150 | Multiple regex replacements |
| `collectEmbeddedUrls()` | ~200 | Complex URL extraction logic |

**Recommendation:** Break down large functions into smaller, focused units.

### 8.2 Inconsistent Error Messages

**File:** `src/core.ts`  
**Severity:** Low

Error messages vary in format and detail level:
- `"Download failed (${attempt}/${config.maxRetries})"`
- `"Directory create failed: ${dir}"`
- `"Invalid URL skipped: ${urlStr}"`

**Recommendation:** Standardize error message format.

---

## 9. Documentation Gaps

### 9.1 No API Documentation

**Severity:** Medium

The codebase lacks JSDoc comments for exported functions. While the CLI is documented in help text, programmatic API usage is undocumented.

### 9.2 .clone/ Artifacts Not Documented

**Severity:** Low

AGENTS.md mentions: "Keep `.clone/` artifacts documented and stable." However, no documentation exists for what files are created in `.clone/` directory.

**Created files:**
- `captured-entry.html`
- `urls.txt`
- `embedded-urls.txt`
- `manifest-urls.txt`
- `sequence-urls.txt`
- `missing-round-N.txt`

---

## 10. Security Considerations

### 10.1 Path Traversal Protection

**File:** `src/core.ts`, line ~600  
**Severity:** Good

The static server includes path traversal protection:

```typescript
if (!filePath.startsWith(rootDir)) {
  res.writeHead(403);
  res.end("Forbidden");
  return;
}
```

This is properly implemented.

### 10.2 URL Validation

**File:** `src/core.ts`  
**Severity:** Medium

Some URL processing could benefit from stricter validation to prevent injection or unexpected behavior.

---

## 11. DX (Developer Experience) Issues

### 11.1 No Hot Reload During Development

**Severity:** Low

The development workflow requires manual rebuilds. Consider adding watch mode.

### 11.2 Limited Debugging Support

**Severity:** Low

No verbose debugging options beyond `--verbose` flag. Consider adding:
- Debug logging for Puppeteer operations
- Performance timing information
- Resource usage statistics

---

## 12. Summary of Recommendations

### Critical (Fix Immediately)
1. Add tests for core.ts orchestration logic
2. Add missing CLI flags to help text
3. Replace `any` types with proper type definitions

### High (Address Soon)
4. Extract large functions into focused modules
5. Move regex compilation outside loops
6. Add comprehensive test cases for edge conditions

### Medium (Plan for Next Iteration)
7. Convert synchronous file operations to async
8. Add JSDoc documentation for public API
9. Document .clone/ artifacts
10. Add integration tests

### Low (Nice to Have)
11. Extract magic numbers to constants
12. Standardize error message format
13. Consider adding watch mode for development

---

## Conclusion

The shibik codebase demonstrates a solid understanding of web scraping and site cloning challenges. The architecture follows most guidelines from AGENTS.md, with particular strength in URL processing utilities and Puppeteer integration. However, the lack of tests for the core orchestration layer and extensive use of `any` types represent significant technical debt that should be addressed to ensure long-term maintainability.

The most impactful improvements would be:
1. **Adding comprehensive tests** - especially for core.ts
2. **Improving type safety** - replacing `any` with proper types
3. **Completing documentation** - especially CLI help and .clone/ artifacts

These changes will significantly improve code quality, reduce bugs, and make the project more maintainable for future development.
