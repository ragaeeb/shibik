import { describe, expect, it } from "bun:test";

import { stripUnsafeRequestHeaders } from "@/request-headers.js";

describe("stripUnsafeRequestHeaders", () => {
  it("should remove range headers from captured requests", () => {
    expect(
      stripUnsafeRequestHeaders({
        Accept: "video/*",
        Cookie: "session=1",
        Host: "example.com",
        "If-Range": "etag-value",
        Range: "bytes=0-249383",
        Referer: "https://example.com/",
      }),
    ).toEqual({
      Accept: "video/*",
      Referer: "https://example.com/",
    });
  });
});
