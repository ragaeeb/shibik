import { describe, expect, it } from "bun:test";

import { extractDataUrlPayload, isValidFetchedContent } from "@/browser-fallback.js";

describe("extractDataUrlPayload", () => {
  it("should return the base64 payload from a data url", () => {
    expect(extractDataUrlPayload("data:model/gltf-binary;base64,QUJDRA==")).toBe("QUJDRA==");
  });

  it("should return null for invalid data urls", () => {
    expect(extractDataUrlPayload("not-a-data-url")).toBeNull();
  });
});

describe("isValidFetchedContent", () => {
  it("should reject html responses for asset urls", () => {
    expect(isValidFetchedContent("https://example.com/models/station.glb", "text/html")).toBe(false);
  });

  it("should allow binary responses for asset urls", () => {
    expect(isValidFetchedContent("https://example.com/models/station.glb", "model/gltf-binary")).toBe(true);
  });
});
