import { describe, expect, it } from "bun:test";

import { shouldPersistCapturedResponseMeta } from "@/captured-responses.js";

describe("shouldPersistCapturedResponseMeta", () => {
  it("should skip partial content responses", () => {
    expect(
      shouldPersistCapturedResponseMeta({
        method: "GET",
        originHost: "example.com",
        requestHeaders: {},
        resourceType: "media",
        responseHeaders: {
          "content-range": "bytes 0-249383/314920",
          "content-type": "video/mp4",
        },
        status: 206,
        urlStr: "https://example.com/tv_video.mp4",
      }),
    ).toBe(false);
  });

  it("should skip ranged requests even when the server reports 200", () => {
    expect(
      shouldPersistCapturedResponseMeta({
        method: "GET",
        originHost: "example.com",
        requestHeaders: {
          Range: "bytes=0-249383",
        },
        resourceType: "media",
        responseHeaders: {
          "content-type": "video/mp4",
        },
        status: 200,
        urlStr: "https://example.com/tv_video.mp4",
      }),
    ).toBe(false);
  });
});
