import path from "node:path";

import { describe, expect, it } from "bun:test";

import { rewriteTextContent } from "@/rewrite.js";

describe("rewriteTextContent", () => {
  it("should keep external sub-app relative asset folders relative", () => {
    const outDir = "/tmp/shibik-test";
    const filePath = path.join(
      outDir,
      "_external",
      "p-p.redbull.com",
      "rb-red-bulle-of-wheels-11-prod",
      "baluchon.manifest.json",
    );

    const result = rewriteTextContent({
      aliasPairs: [],
      content: '{"logo":"b/1mJlWYf_YHJZ.avif"}',
      filePath,
      knownHosts: new Set<string>(["p-p.redbull.com"]),
      originHost: "www.redbull.com",
      outDir,
    });

    expect(result.content).toContain('"b/1mJlWYf_YHJZ.avif"');
  });

  it("should rewrite external host-root asset folders to the external host root", () => {
    const outDir = "/tmp/shibik-test";
    const filePath = path.join(
      outDir,
      "_external",
      "p-p.redbull.com",
      "rb-red-bulle-of-wheels-11-prod",
      "loader.js",
    );

    const result = rewriteTextContent({
      aliasPairs: [],
      content: 'const logo = "/b/1mJlWYf_YHJZ.avif";',
      filePath,
      knownHosts: new Set<string>(["p-p.redbull.com"]),
      originHost: "www.redbull.com",
      outDir,
    });

    expect(result.content).toContain('"../b/1mJlWYf_YHJZ.avif"');
  });

  it("should preserve CommonJS exports for bundled UMD modules when define exists", () => {
    const outDir = "/tmp/shibik-test";
    const filePath = path.join(outDir, "assets", "bundle.js");

    const result = rewriteTextContent({
      aliasPairs: [],
      content:
        'const x="function"==typeof define?define(function(){return s}):e.exports=s;',
      filePath,
      knownHosts: new Set<string>(),
      originHost: "example.com",
      outDir,
    });

    expect(result.content).toContain(
      'const x=("function"==typeof define&&define(function(){return s}),e.exports=s);',
    );
  });

  it("should preserve CommonJS exports for bundled charcode define checks", () => {
    const outDir = "/tmp/shibik-test";
    const filePath = path.join(outDir, "assets", "bundle.js");

    const result = rewriteTextContent({
      aliasPairs: [],
      content:
        'const x="f"==(typeof define)[0]?define(function(){return a}):e.exports=a;',
      filePath,
      knownHosts: new Set<string>(),
      originHost: "example.com",
      outDir,
    });

    expect(result.content).toContain(
      'const x=(("function"==typeof define||"f"==(typeof define)[0])&&define(function(){return a}),e.exports=a);',
    );
  });
});
