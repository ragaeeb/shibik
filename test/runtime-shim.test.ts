import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import { buildExternalPathAliases, injectRuntimeScriptTag } from "@/runtime-shim.js";

describe("injectRuntimeScriptTag", () => {
  it("should inject the runtime script at the start of the head", () => {
    const html = "<!doctype html><html><head><title>Test</title></head><body></body></html>";
    const nextHtml = injectRuntimeScriptTag(html);

    expect(nextHtml).toContain(
      '<head><script src="/__shibik_runtime.js" data-shibik-runtime="true"></script><title>Test</title>',
    );
  });

  it("should not inject the runtime script twice", () => {
    const html =
      '<!doctype html><html><head><script src="/__shibik_runtime.js" data-shibik-runtime="true"></script></head><body></body></html>';

    expect(injectRuntimeScriptTag(html)).toBe(html);
  });
});

describe("buildExternalPathAliases", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("should expose unique root aliases for external b assets", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "shibik-runtime-"));
    tempDirs.push(outDir);

    const externalDir = path.join(
      outDir,
      "_external",
      "p-p.redbull.com",
      "rb-red-bulle-of-wheels-11-prod",
      "b",
    );
    mkdirSync(externalDir, { recursive: true });
    writeFileSync(path.join(externalDir, "1mJlWYf_YHJZ.avif"), "asset");

    const aliases = await buildExternalPathAliases(outDir);
    expect(aliases["/b/1mJlWYf_YHJZ.avif"]).toBe(
      "/_external/p-p.redbull.com/rb-red-bulle-of-wheels-11-prod/b/1mJlWYf_YHJZ.avif",
    );
  });

  it("should expose unique root aliases for external asset folders", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "shibik-runtime-"));
    tempDirs.push(outDir);

    const externalDir = path.join(
      outDir,
      "_external",
      "cdn.cookielaw.org",
      "scripttemplates",
      "202602.1.0",
      "assets",
    );
    mkdirSync(externalDir, { recursive: true });
    writeFileSync(path.join(externalDir, "otCommonStyles.css"), "asset");

    const aliases = await buildExternalPathAliases(outDir);
    expect(aliases["/assets/otCommonStyles.css"]).toBe(
      "/_external/cdn.cookielaw.org/scripttemplates/202602.1.0/assets/otCommonStyles.css",
    );
  });
});
