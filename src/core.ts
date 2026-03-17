import path from "node:path";

import { promptForApiMocks } from "@/api-mocks.js";
import { defaultNameFromUrl, parseArgs, printHelp } from "@/args.js";
import { captureUrls } from "@/browser.js";
import { resolveCaptureContext } from "@/capture-context.js";
import {
  collectEmbeddedUrls,
  collectManifestAssets,
  collectNumericSequenceUrls,
} from "@/discovery.js";
import { downloadAllWithVerification } from "@/download.js";
import {
  applyCapturedEntryHtml,
  ensureDir,
  ensureServeBootstrap,
  readTextFile,
  saveCapturedEntryHtml,
  writeLinesFile,
} from "@/files.js";
import { isLikelyHtml } from "@/html.js";
import { log } from "@/logger.js";
import {
  mirrorEntryDirFolders,
  mirrorLeafToParent,
  mirrorLeafToRoot,
  mirrorRootToEntry,
} from "@/mirror.js";
import {
  extractPrerenderRequestUrls,
  persistPrerenderCacheMocks,
  persistStoredPageConfigFallbackMocks,
} from "@/prerender-cache.js";
import { runLocalRecovery } from "@/recovery.js";
import { rewritePaths } from "@/rewrite.js";
import { writeRuntimeShim } from "@/runtime-shim.js";
import type { Config } from "@/types.js";

const writeCloneArtifact = (outDir: string, name: string, lines: string[]) => {
  return writeLinesFile(path.join(outDir, ".clone", name), lines);
};

const fetchEntryHtml = async (urlStr: string, config: Config, withCookies: boolean) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(urlStr, {
      headers: {
        Accept: "text/html,*/*",
        "User-Agent": config.userAgent,
        ...(withCookies && config.cookieHeader ? { Cookie: config.cookieHeader } : {}),
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      return "";
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    return isLikelyHtml(contentType, body) ? body : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
};

const addKnownHost = (knownHosts: Set<string>, urlStr: string) => {
  try {
    knownHosts.add(new URL(urlStr).host);
  } catch {
    // Ignore malformed URLs surfaced during best-effort capture.
  }
};

const addKnownHosts = (knownHosts: Set<string>, urls: string[]) => {
  for (const urlStr of urls) {
    addKnownHost(knownHosts, urlStr);
  }
};

const collectExtraUrls = async (filePaths: string[]) => {
  const extraUrls: string[] = [];

  for (const filePath of filePaths) {
    try {
      const lines = (await readTextFile(filePath))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      extraUrls.push(...lines);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      log("WARN", `Failed to read extra URL file ${filePath}: ${message}`);
    }
  }

  return extraUrls;
};

const applyCapturedEntryHtmlForCandidates = async (
  originHost: string,
  outDir: string,
  html: string,
  referenceUrl: string,
  candidates: Iterable<string>,
) => {
  const normalizeUrlKey = (urlStr: string) => {
    const url = new URL(urlStr);
    const pathname =
      url.pathname.length > 1 && url.pathname.endsWith("/")
        ? url.pathname.slice(0, -1)
        : url.pathname || "/";
    return `${url.host}${pathname}${url.search}`;
  };

  let referenceKey = "";
  try {
    referenceKey = normalizeUrlKey(referenceUrl);
  } catch {
    return;
  }

  for (const entryUrl of candidates) {
    try {
      if (new URL(entryUrl).host === originHost && normalizeUrlKey(entryUrl) === referenceKey) {
        await applyCapturedEntryHtml(entryUrl, html, outDir, originHost);
      }
    } catch {
      // Ignore invalid entry URLs produced during navigation.
    }
  }
};

const downloadDiscoveredUrls = async (
  label: string,
  artifactName: string,
  urls: string[],
  config: Config,
  outDir: string,
  originHost: string,
  knownHosts: Set<string>,
) => {
  if (urls.length === 0) {
    return;
  }

  log("INFO", `${label}: ${urls.length}`);
  await writeCloneArtifact(outDir, artifactName, urls);
  addKnownHosts(knownHosts, urls);
  await downloadAllWithVerification(urls, config, outDir, originHost);
};

export const main = async (argv = process.argv.slice(2)) => {
  const rawArgs = parseArgs(argv);
  if (rawArgs.help) {
    printHelp();
    return;
  }

  if (!rawArgs.url) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const targetUrl = rawArgs.url;
  const initialCaptureContext = resolveCaptureContext({
    configuredOrigin: rawArgs.origin,
    targetUrl,
  });
  let { entryPath, origin, originHost } = initialCaptureContext;
  const name = rawArgs.name ?? defaultNameFromUrl(targetUrl);
  const outDir = rawArgs.out ? path.resolve(rawArgs.out) : path.resolve(process.cwd(), name);
  await ensureDir(outDir);
  await ensureDir(path.join(outDir, ".clone"));

  await ensureServeBootstrap(outDir, entryPath);

  const config: Config = {
    concurrency: rawArgs.concurrency,
    cookieHeader: "",
    entryPath,
    extraUrlFiles: rawArgs.extraUrlFiles.filter(Boolean),
    extraUrls: rawArgs.extraUrls.filter(Boolean),
    headless: rawArgs.headless,
    idleWaitMs: rawArgs.idleWaitMs,
    localTest: rawArgs.localTest,
    localTestRounds: rawArgs.localTestRounds,
    maxRetries: rawArgs.maxRetries,
    maxScrolls: rawArgs.maxScrolls,
    origin,
    originHost,
    outDir,
    requestHeaders: new Map(),
    rewrite: rawArgs.rewrite,
    scroll: rawArgs.scroll,
    scrollDelayMs: rawArgs.scrollDelayMs,
    scrollStep: rawArgs.scrollStep,
    timeoutMs: rawArgs.timeoutMs,
    url: targetUrl,
    userAgent: rawArgs.userAgent,
    verbose: rawArgs.verbose,
  };

  const apiPrompted = new Set<string>();

  log("INFO", `Output directory: ${outDir}`);
  log("INFO", `Origin: ${origin}`);

  const capture = await captureUrls(config);
  const resolvedCaptureContext = resolveCaptureContext({
    configuredOrigin: rawArgs.origin,
    landingUrl: capture.landingUrl,
    targetUrl,
  });
  if (resolvedCaptureContext.origin !== origin) {
    origin = resolvedCaptureContext.origin;
    originHost = resolvedCaptureContext.originHost;
    config.origin = origin;
    config.originHost = originHost;
    log("INFO", `Landing origin: ${origin}`);
  }
  if (resolvedCaptureContext.entryPath !== entryPath) {
    entryPath = resolvedCaptureContext.entryPath;
    config.entryPath = entryPath;
    await ensureServeBootstrap(outDir, entryPath);
    log("INFO", `Landing entry path: ${entryPath}`);
  }
  config.cookieHeader = capture.cookieHeader;
  config.requestHeaders = capture.requestHeaders;

  const knownHosts = new Set<string>(capture.hosts);
  knownHosts.add(originHost);
  const entryFetchUrl = capture.finalUrl || capture.landingUrl;
  let entryHtml = capture.documentHtml || capture.finalHtml;
  if (entryHtml.includes("<canvas")) {
    const fetchedWithCookies = await fetchEntryHtml(entryFetchUrl, config, true);
    if (fetchedWithCookies && !fetchedWithCookies.includes("<canvas")) {
      entryHtml = fetchedWithCookies;
    } else {
      const fetchedWithoutCookies = await fetchEntryHtml(entryFetchUrl, config, false);
      if (fetchedWithoutCookies && !fetchedWithoutCookies.includes("<canvas")) {
        entryHtml = fetchedWithoutCookies;
      }
    }
  }
  await saveCapturedEntryHtml(entryHtml, outDir);
  await persistPrerenderCacheMocks(entryHtml, origin, outDir, originHost);
  const storedPageConfigFallbackUrls = await persistStoredPageConfigFallbackMocks(outDir, origin);
  await applyCapturedEntryHtmlForCandidates(
    originHost,
    outDir,
    entryHtml,
    capture.landingUrl,
    [
    config.url,
    capture.landingUrl,
    capture.finalUrl,
    ],
  );

  const extraUrls = await collectExtraUrls(config.extraUrlFiles);
  const allUrls = [...capture.urls, ...config.extraUrls, ...extraUrls].filter(
    (value): value is string => Boolean(value),
  );
  const runtimeCandidateUrls = new Set<string>([
    ...allUrls,
    ...extractPrerenderRequestUrls(capture.finalHtml, origin),
    ...storedPageConfigFallbackUrls,
  ]);
  await writeCloneArtifact(outDir, "urls.txt", allUrls);
  addKnownHosts(knownHosts, allUrls);
  const initialSummary = await downloadAllWithVerification(allUrls, config, outDir, originHost);
  await promptForApiMocks(initialSummary.failedUrls, outDir, originHost, apiPrompted);

  await downloadDiscoveredUrls(
    "Embedded URLs discovered",
    "embedded-urls.txt",
    await collectEmbeddedUrls(outDir, origin, entryPath),
    config,
    outDir,
    originHost,
    knownHosts,
  );

  await downloadDiscoveredUrls(
    "Manifest assets discovered",
    "manifest-urls.txt",
    await collectManifestAssets(outDir, origin),
    config,
    outDir,
    originHost,
    knownHosts,
  );

  await downloadDiscoveredUrls(
    "Sequence assets discovered",
    "sequence-urls.txt",
    await collectNumericSequenceUrls(outDir, origin),
    config,
    outDir,
    originHost,
    knownHosts,
  );

  if (config.rewrite) {
    await rewritePaths(outDir, originHost, knownHosts);
  }

  await mirrorEntryDirFolders(outDir, entryPath);
  await mirrorLeafToParent(outDir, entryPath);
  await mirrorLeafToRoot(outDir, entryPath);
  await mirrorRootToEntry(outDir, entryPath);
  for (const url of await persistStoredPageConfigFallbackMocks(outDir, origin)) {
    runtimeCandidateUrls.add(url);
  }
  await writeRuntimeShim(outDir, originHost, runtimeCandidateUrls);

  await runLocalRecovery(outDir, config, capture.urls, origin, originHost, knownHosts, apiPrompted);
  for (const url of await persistStoredPageConfigFallbackMocks(outDir, origin)) {
    runtimeCandidateUrls.add(url);
  }
  await writeRuntimeShim(outDir, originHost, runtimeCandidateUrls);

  log("INFO", "Clone complete.");
};
