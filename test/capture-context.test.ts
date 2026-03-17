import { describe, expect, it } from "bun:test";

import { resolveCaptureContext } from "@/capture-context.js";

describe("resolveCaptureContext", () => {
  it("should adopt the landing origin and entry path when no explicit origin is set", () => {
    expect(
      resolveCaptureContext({
        landingUrl: "https://spaceship-blush.vercel.app/play?mode=demo",
        targetUrl: "https://space-drive.artcreativecode.com/",
      }),
    ).toEqual({
      entryPath: "/play?mode=demo",
      origin: "https://spaceship-blush.vercel.app",
      originHost: "spaceship-blush.vercel.app",
    });
  });

  it("should keep the requested origin and entry path when an explicit origin is set", () => {
    expect(
      resolveCaptureContext({
        configuredOrigin: "https://space-drive.artcreativecode.com/",
        landingUrl: "https://spaceship-blush.vercel.app/play?mode=demo",
        targetUrl: "https://space-drive.artcreativecode.com/",
      }),
    ).toEqual({
      entryPath: "/",
      origin: "https://space-drive.artcreativecode.com",
      originHost: "space-drive.artcreativecode.com",
    });
  });
});
