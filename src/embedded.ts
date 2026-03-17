import path from "node:path";

import { EMBEDDED_ASSET_FOLDERS, TEXT_EXTENSIONS } from "@/constants.js";
import { readTextFile, walkDirWithSkips } from "@/files.js";
import { getEntryDir } from "@/site-paths.js";
import {
  collapseDuplicateSegments,
  looksLikeAssetUrl,
  normalizeEmbeddedUrl,
  remapLocalhostUrl,
} from "@/url.js";

type EmbeddedContentInput = {
  content: string;
  entryPath: string;
  fileRelativeDir: string;
  origin: string;
};

type EmbeddedContext = {
  appBase: URL;
  base: URL;
  origin: string;
  originHost: string;
  protocol: string;
  urls: Set<string>;
};

const assetFolderPattern = EMBEDDED_ASSET_FOLDERS.join("|");
const urlRegex = /(https?:\/\/[^\s"'`)\]]+|\/\/[^\s"'`)\]]+)/g;
const relRegex = /(['"`])((?:\.{0,2}\/|\/)[^'"`\s]+?\.[a-z0-9]{2,8}(?:\?[^'"`]*)?)(?=\1)/gi;
const bareAssetRegex = new RegExp(
  `(['"\\x60])((?:${assetFolderPattern})\\/[^'"\\x60\\s]+?\\.[a-z0-9]{2,8}(?:\\?[^'"\\x60]*)?)(?=\\1)`,
  "gi",
);
const assetPrefixRegex = new RegExp(`(['"\\x60])((?:${assetFolderPattern})\\/)(?=\\1)`, "gi");
const assetFilenameRegex =
  /(['"`])([a-z0-9][a-z0-9._-]{2,}\.(?:avif|webp|png|jpe?g|gif|svg|mp3|m4a|ogg|wav|mp4|webm|glb|gltf|bin|ktx2|drc|hdr|exr|json|riv|wasm|js|mjs|css))(?:[?#][^'"`]*)?(?=\1)/gi;
const cssUrlRegex = /url\(([^)]+)\)/gi;
const srcsetRegex = /\bsrcset\s*=\s*(['"])([^'"]+)\1/gi;
const imageSetRegex = /\bimage-set\s*\(([^)]+)\)/gi;

const createEmbeddedContext = ({ entryPath, fileRelativeDir, origin }: EmbeddedContentInput): EmbeddedContext => {
  const originUrl = new URL(origin);
  return {
    appBase: new URL(`${origin}${getEntryDir(entryPath)}`),
    base: new URL(`${origin}/${fileRelativeDir ? `${fileRelativeDir}/` : ""}`),
    origin,
    originHost: originUrl.host,
    protocol: originUrl.protocol,
    urls: new Set<string>(),
  };
};

const addResolvedUrl = (candidateUrl: string | null, context: EmbeddedContext) => {
  if (!candidateUrl) {
    return;
  }

  const full = remapLocalhostUrl(candidateUrl, context.origin);
  if (full.startsWith("./_external/") || full.startsWith("/_external/")) {
    return;
  }

  if (full.startsWith(context.origin) && full.includes("/_external/")) {
    return;
  }

  if (!looksLikeAssetUrl(full, context.originHost, true)) {
    return;
  }

  try {
    const host = new URL(full).host;
    if (host === "localhost" || host.startsWith("127.0.0.1")) {
      return;
    }
  } catch {
    return;
  }

  context.urls.add(full);
  const deduped = collapseDuplicateSegments(full);
  if (deduped) {
    context.urls.add(deduped);
  }
};

const resolveCandidateUrl = (candidate: string, context: EmbeddedContext): string | null => {
  if (!candidate || candidate.startsWith("./_external/") || candidate.startsWith("/_external/")) {
    return null;
  }

  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }

  if (candidate.startsWith("//")) {
    return `${context.protocol}${candidate}`;
  }

  if (candidate.startsWith("/")) {
    return `${context.origin}${candidate}`;
  }

  return new URL(candidate, context.base).toString();
};

const collectAbsoluteUrls = (content: string, context: EmbeddedContext) => {
  for (const match of content.matchAll(urlRegex)) {
    let candidate = normalizeEmbeddedUrl(match[1] ?? "");
    if (!candidate) {
      continue;
    }

    if (candidate.includes("http://") || candidate.includes("https://")) {
      const first = candidate.startsWith("http://") || candidate.startsWith("https://");
      if (!first && /https?:\/\//i.test(candidate)) {
        continue;
      }
    }

    if (candidate.startsWith("//")) {
      candidate = `${context.protocol}${candidate}`;
    }

    addResolvedUrl(candidate, context);
  }
};

const collectRelativeUrls = (content: string, context: EmbeddedContext) => {
  for (const match of content.matchAll(relRegex)) {
    const candidate = normalizeEmbeddedUrl(match[2] ?? "");
    addResolvedUrl(resolveCandidateUrl(candidate, context), context);
  }
};

const collectBareAssetUrls = (content: string, context: EmbeddedContext) => {
  for (const match of content.matchAll(bareAssetRegex)) {
    const candidate = normalizeEmbeddedUrl(match[2] ?? "");
    if (!candidate || candidate.startsWith("./") || candidate.startsWith("../") || candidate.startsWith("/")) {
      continue;
    }

    addResolvedUrl(new URL(candidate, context.appBase).toString(), context);
  }
};

const collectAssetPrefixes = (content: string) => {
  const prefixes = new Set<string>();
  for (const match of content.matchAll(assetPrefixRegex)) {
    const candidate = normalizeEmbeddedUrl(match[2] ?? "");
    if (candidate) {
      prefixes.add(candidate);
    }
  }
  return prefixes;
};

const collectAssetFilenames = (content: string) => {
  const filenames = new Set<string>();
  for (const match of content.matchAll(assetFilenameRegex)) {
    const candidate = normalizeEmbeddedUrl(match[2] ?? "");
    if (candidate && !candidate.includes("/")) {
      filenames.add(candidate);
    }
  }
  return filenames;
};

const addCombinedAssetUrls = (
  context: EmbeddedContext,
  prefixes: Set<string>,
  filenames: Set<string>,
) => {
  let comboCount = 0;
  const comboLimit = 500;
  for (const prefix of prefixes) {
    for (const filename of filenames) {
      addResolvedUrl(new URL(`${prefix}${filename}`, context.appBase).toString(), context);
      comboCount++;
      if (comboCount >= comboLimit) {
        return;
      }
    }
  }
};

const collectCombinedAssetUrls = (content: string, context: EmbeddedContext) => {
  const prefixes = collectAssetPrefixes(content);
  const filenames = collectAssetFilenames(content);
  if (prefixes.size === 0 || filenames.size === 0) {
    return;
  }

  addCombinedAssetUrls(context, prefixes, filenames);
};

const collectCssUrls = (content: string, context: EmbeddedContext) => {
  for (const match of content.matchAll(cssUrlRegex)) {
    const candidate = normalizeEmbeddedUrl(match[1] ?? "");
    if (!candidate || candidate.startsWith("data:") || candidate.startsWith("#") || candidate.startsWith("var(")) {
      continue;
    }

    const resolved =
      candidate.startsWith("./") || candidate.startsWith("../") || candidate.includes("/")
        ? resolveCandidateUrl(candidate, context)
        : null;
    addResolvedUrl(resolved, context);
  }
};

const collectListUrls = (entries: string[], context: EmbeddedContext) => {
  for (const entry of entries) {
    const candidate = normalizeEmbeddedUrl(entry);
    addResolvedUrl(resolveCandidateUrl(candidate, context), context);
  }
};

const collectSrcsetUrls = (content: string, context: EmbeddedContext) => {
  for (const match of content.matchAll(srcsetRegex)) {
    const entries = (match[2] ?? "")
      .split(",")
      .map((part) => part.trim())
      .map((entry) => entry.split(/\s+/)[0] ?? "");
    collectListUrls(entries, context);
  }
};

const collectImageSetUrls = (content: string, context: EmbeddedContext) => {
  for (const match of content.matchAll(imageSetRegex)) {
    const entries = (match[1] ?? "").split(",").map((part) => part.trim());
    const urls = entries.map((entry) => {
      const entryMatch = entry.match(/url\(([^)]+)\)/i);
      return entryMatch ? entryMatch[1] : (entry.split(/\s+/)[0] ?? "");
    });
    collectListUrls(urls, context);
  }
};

export const collectEmbeddedUrlsFromContent = (input: EmbeddedContentInput) => {
  const context = createEmbeddedContext(input);
  collectAbsoluteUrls(input.content, context);
  collectRelativeUrls(input.content, context);
  collectBareAssetUrls(input.content, context);
  collectCombinedAssetUrls(input.content, context);
  collectCssUrls(input.content, context);
  collectSrcsetUrls(input.content, context);
  collectImageSetUrls(input.content, context);
  return Array.from(context.urls);
};

export const collectEmbeddedUrls = async (outDir: string, origin: string, entryPath: string) => {
  const urls = new Set<string>();

  for (const file of walkDirWithSkips(outDir, new Set(["_external"]))) {
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
      continue;
    }

    let content: string;
    try {
      content = await readTextFile(file);
    } catch {
      continue;
    }

    const relDir = path.relative(outDir, path.dirname(file)).replace(/\\/g, "/");
    for (const url of collectEmbeddedUrlsFromContent({
      content,
      entryPath,
      fileRelativeDir: relDir === "." ? "" : relDir,
      origin,
    })) {
      urls.add(url);
    }
  }

  return Array.from(urls);
};
