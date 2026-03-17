import { describe, expect, it } from "bun:test";

import { collectEmbeddedUrlsFromContent, collectManifestAssetPaths } from "@/discovery.js";

describe("collectManifestAssetPaths", () => {
  it("should expand sequence manifests into concrete asset variants", () => {
    const assets = collectManifestAssetPaths({
      files: {
        intro: ["textures/frame", 2, ["webp", "png"]],
      },
      type: "sequence",
    });

    expect(assets).toEqual(
      expect.arrayContaining([
        "textures/frame.webp",
        "textures/frame.png",
        "textures/frame.n0.webp",
        "textures/frame.n0.png",
        "textures/frame.n1.webp",
        "textures/frame.n1.png",
      ]),
    );
  });

  it("should expand texture packer manifests into atlas and image variants", () => {
    const assets = collectManifestAssetPaths({
      files: {
        atlas: ["textures/gui", 0, null, ["png", "webp"]],
      },
      type: "texturePacker",
    });

    expect(assets).toEqual(
      expect.arrayContaining(["textures/gui.json", "textures/gui.png", "textures/gui.webp"]),
    );
  });
});

describe("collectEmbeddedUrlsFromContent", () => {
  it("should discover absolute, relative, css, srcset, and combined asset URLs", () => {
    const urls = collectEmbeddedUrlsFromContent({
      content: `
        const hero = "https://example.com/assets/hero.png";
        const scene = "//cdn.example.com/models/scene.glb";
        const icon = "../images/icon.webp";
        const folder = "assets/";
        const name = "poster.png";
        .banner { background-image: url("../images/bg.webp"); }
        <img srcset="/images/a.webp 1x, ./images/b.webp 2x">
      `,
      entryPath: "/brand/demo/",
      fileRelativeDir: "pages/demo",
      origin: "https://example.com",
    });

    expect(urls).toEqual(
      expect.arrayContaining([
        "https://example.com/assets/hero.png",
        "https://cdn.example.com/models/scene.glb",
        "https://example.com/pages/images/icon.webp",
        "https://example.com/pages/images/bg.webp",
        "https://example.com/images/a.webp",
        "https://example.com/pages/demo/images/b.webp",
        "https://example.com/brand/demo/assets/poster.png",
      ]),
    );
  });
});
