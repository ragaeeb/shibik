export const TRACKING_SUBSTRINGS = [
  "google-analytics",
  "googletagmanager",
  "doubleclick",
  "facebook.net",
  "connect.facebook.net",
  "fbq",
  "sentry.io",
  "sentry-cdn",
  "hotjar",
  "segment",
  "intercom",
  "mixpanel",
  "amplitude",
  "datadog",
  "newrelic",
  "optimizely",
  "clarity.ms",
  "tiktok",
  "snapchat",
  "adsystem",
  "adservice",
  "googlesyndication",
  "stats.g.doubleclick.net",
] as const;

export const REWRITE_FOLDERS = [
  "assets",
  "b",
  "baluchon",
  "icons",
  "preloader",
  "static",
  "media",
  "img",
  "images",
  "fonts",
  "models",
  "textures",
  "draco",
  "ktx2",
  "wasm",
  "workers",
  "worker",
  "_next",
] as const;

export const EMBEDDED_ASSET_FOLDERS = [
  "assets",
  "res",
  "static",
  "media",
  "images",
  "img",
  "models",
  "textures",
  "fonts",
  "sounds",
  "audio",
  "b",
  "preloader",
  "baluchon",
  "_next",
  "icons",
  "draco",
  "ktx2",
  "wasm",
  "workers",
  "worker",
  "envmaps",
  "files",
  "hdri",
] as const;

export const LEAF_TO_ROOT_FOLDERS = [
  "static",
  "media",
  "images",
  "img",
  "models",
  "textures",
  "envmaps",
  "sounds",
  "audio",
  "assets",
] as const;

export const ROOT_TO_ENTRY_FOLDERS = [
  "_next",
  "assets",
  "Assets",
  "static",
  "media",
  "images",
  "img",
  "models",
  "textures",
  "envmaps",
  "sounds",
  "audio",
] as const;

export const DUPLICATE_SEGMENTS = new Set<string>([...REWRITE_FOLDERS, "res"]);

export const TEXT_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".json",
  ".webmanifest",
  ".txt",
  ".svg",
  ".xml",
  ".map",
]);

export const MARKUP_EXTENSIONS = new Set([".html", ".htm", ".xml", ".svg", ".webmanifest"]);

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==",
  "base64",
);

export const EMPTY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>\n';
