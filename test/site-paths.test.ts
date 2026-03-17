import { describe, expect, it } from "bun:test";

import { getEntryDir, mapUrlToLocalPath } from "@/site-paths.js";

describe("mapUrlToLocalPath", () => {
  it("should map same-host routes without extensions to nested index files", () => {
    expect(
      mapUrlToLocalPath("https://example.com/brand/demo", "/tmp/out", "example.com").absPath,
    ).toBe("/tmp/out/brand/demo/index.html");
  });

  it("should map external hosts under the _external directory", () => {
    expect(
      mapUrlToLocalPath("https://cdn.example.com/models/scene.glb", "/tmp/out", "example.com")
        .absPath,
    ).toBe("/tmp/out/_external/cdn.example.com/models/scene.glb");
  });
});

describe("getEntryDir", () => {
  it("should normalize file entries to their containing directory", () => {
    expect(getEntryDir("/brand/demo/index.html?mode=preview")).toBe("/brand/demo/");
  });
});
