import path from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildApiMockLookupKeys,
  canonicalizeApiPathname,
  getApiMockLookupPaths,
  isApiCandidate,
  isResponseMockCandidate,
  parseJsonBody,
  resolveApiMockPath,
} from "@/api-mocks.js";

describe("isApiCandidate", () => {
  it("should accept same-origin api paths", () => {
    expect(isApiCandidate("https://example.com/api/session/start", "example.com")).toBe(true);
  });

  it("should reject non-api paths", () => {
    expect(isApiCandidate("https://example.com/assets/app.js", "example.com")).toBe(false);
  });

  it("should reject different hosts", () => {
    expect(isApiCandidate("https://cdn.example.com/api/ping", "example.com")).toBe(false);
  });
});

describe("isResponseMockCandidate", () => {
  it("should accept same-origin api paths", () => {
    expect(isResponseMockCandidate("https://example.com/api/session/start", "example.com")).toBe(
      true,
    );
  });

  it("should accept same-origin query endpoints without asset extensions", () => {
    expect(isResponseMockCandidate("https://example.com/v3/config/pages?url=/fr-fr/demo", "example.com")).toBe(true);
  });

  it("should reject asset urls with query strings", () => {
    expect(isResponseMockCandidate("https://example.com/assets/app.js?v=1", "example.com")).toBe(
      false,
    );
  });
});

describe("parseJsonBody", () => {
  it("should parse json when content type is json", () => {
    const parsed = parseJsonBody("{\"ok\":true}", "application/json");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual({ ok: true });
    }
  });

  it("should parse json when body looks like json", () => {
    const parsed = parseJsonBody("[1,2,3]", "text/plain");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual([1, 2, 3]);
    }
  });

  it("should reject non-json bodies", () => {
    const parsed = parseJsonBody("not json", "text/plain");
    expect(parsed.ok).toBe(false);
  });
});

describe("resolveApiMockPath", () => {
  it("should resolve api paths under output directory", () => {
    const outDir = "/tmp/shibik-test";
    const resolved = resolveApiMockPath(outDir, "/api/session/start");
    expect(resolved).toBe(path.join(outDir, "api", "session", "start", "__default__.json"));
  });

  it("should include a query-specific file when a search string is present", () => {
    const outDir = "/tmp/shibik-test";
    const resolved = resolveApiMockPath(outDir, "/api/session/start", "?mode=demo");
    expect(resolved).toMatch(/\/api\/session\/start\/__query_[a-f0-9]{12}\.json$/);
  });

  it("should canonicalize decoded graph paths to encoded filesystem paths", () => {
    const outDir = "/tmp/shibik-test";
    const resolved = resolveApiMockPath(outDir, "/v3/api/graphql/v1/v3/feed/fr-FR>fr-INT");
    expect(resolved).toBe(
      path.join(outDir, "v3", "api", "graphql", "v1", "v3", "feed", "fr-FR>fr-INT", "__default__.json"),
    );
  });

  it("should return null for path traversal", () => {
    const outDir = "/tmp/shibik-test";
    const resolved = resolveApiMockPath(outDir, "/../secrets.txt");
    expect(resolved).toBe(null);
  });
});

describe("getApiMockLookupPaths", () => {
  it("should prefer the query-specific mock before the default mock", () => {
    const outDir = "/tmp/shibik-test";
    const resolved = getApiMockLookupPaths(outDir, "/api/session/start", "?mode=demo");
    expect(resolved[0]).toMatch(/__query_[a-f0-9]{12}\.json$/);
    expect(resolved[1]).toBe(path.join(outDir, "api", "session", "start", "__default__.json"));
  });
});

describe("canonicalizeApiPathname", () => {
  it("should preserve safe separators and encode graph locale delimiters", () => {
    expect(canonicalizeApiPathname("/v3/api/graphql/v1/v3/feed/fr-FR>fr-INT")).toBe(
      "/v3/api/graphql/v1/v3/feed/fr-FR%3Efr-INT",
    );
  });
});

describe("buildApiMockLookupKeys", () => {
  it("should include encoded and decoded query lookup keys", () => {
    expect(buildApiMockLookupKeys("/v3/api/graphql/v1/v3/feed/fr-FR%3Efr-INT", "?a=1")).toEqual([
      "/v3/api/graphql/v1/v3/feed/fr-FR%3Efr-INT?a=1",
      "/v3/api/graphql/v1/v3/feed/fr-FR>fr-INT?a=1",
    ]);
  });
});
