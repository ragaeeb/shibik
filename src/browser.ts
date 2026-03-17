import type { HTTPResponse, KeyInput, Page } from "puppeteer";
import puppeteer from "puppeteer";

import { isResponseMockCandidate, storeCapturedApiResponse } from "@/api-mocks.js";
import {
  selectInteractionTargets,
  type InteractionCandidate,
} from "@/browser-interactions.js";
import { persistCapturedResponse } from "@/captured-responses.js";
import { isLikelyHtml } from "@/html.js";
import { log } from "@/logger.js";
import { stripUnsafeRequestHeaders } from "@/request-headers.js";
import { startStaticServer } from "@/local-server.js";
import { sleep } from "@/timing.js";
import type { CaptureMeta, CaptureResult, Config } from "@/types.js";
import { shouldSkipUrl } from "@/url.js";

const CENTER_CLICK_DELAY_MS = 500;
const TARGET_CLICK_DELAY_MS = 400;
const DRAG_DELAY_MS = 300;
const KEY_DELAY_MS = 150;
const RESET_SCROLL_DELAY_MS = 500;
const MAX_API_BODY_BYTES = 2_000_000;
const CTA_LIMIT = 3;
const CTA_TEXTS = [
  "start",
  "play",
  "begin",
  "go",
  "demarrer",
  "démarrer",
  "cest parti",
  "c'est parti",
  "replay",
  "rejouer",
  "continue",
  "next",
] as const;
const INTERACTION_SELECTORS = [
  "canvas",
  "button",
  "a[href]",
  "[role=\"button\"]",
  "input[type=radio]",
  "input[type=checkbox]",
  "label",
  "[data-action]",
  "[data-click]",
  "[data-demo]",
  "[data-route]",
  "[data-hash]",
  "[data-tab]",
  "[data-variant]",
  "[data-option]",
  "[data-color]",
  "[data-swatch]",
  "[data-model]",
] as const;
const INTERACTION_LIMIT = 24;
const NAVIGATION_WAIT_UNTIL = "networkidle0";

type CtaTarget = {
  x: number;
  y: number;
};

const getErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error);
};

const trackPendingTask = (pending: Set<Promise<void>>, task: Promise<void>) => {
  pending.add(task);
  void task.finally(() => {
    pending.delete(task);
  });
};

const shouldSkipApiResponse = (
  urlStr: string,
  responseHeaders: Record<string, string>,
  status: number,
  method: string,
  originHost: string,
) => {
  if (!isResponseMockCandidate(urlStr, originHost)) {
    return true;
  }

  if (status < 200 || status >= 300) {
    return true;
  }

  if (method === "OPTIONS" || method === "HEAD") {
    return true;
  }

  const contentLength = responseHeaders["content-length"];
  if (contentLength) {
    const size = Number.parseInt(contentLength, 10);
    if (Number.isFinite(size) && size > MAX_API_BODY_BYTES) {
      return true;
    }
  }

  return false;
};

const captureApiResponse = async (
  response: HTTPResponse,
  config: Config,
  captured: Set<string>,
) => {
  const urlStr = response.url();
  const headers = response.headers();
  const status = response.status();
  const method = response.request().method();

  if (shouldSkipApiResponse(urlStr, headers, status, method, config.originHost)) {
    return;
  }

  try {
    const body = await response.text();
    await storeCapturedApiResponse(urlStr, body, headers["content-type"] ?? "", config.outDir, captured);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log("WARN", `API response capture failed for ${urlStr}: ${message}`);
  }
};

const captureResponseArtifacts = async (
  response: HTTPResponse,
  config: Config,
  capturedApi: Set<string>,
) => {
  await captureApiResponse(response, config, capturedApi);
  await persistCapturedResponse(response, config.outDir, config.originHost);
};

const collectCtaCandidates = (texts: readonly string[], limit: number) => {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const hasMatch = (text: string, needles: Set<string>) => {
    if (!text) {
      return false;
    }

    for (const needle of needles) {
      if (needle && text.includes(needle)) {
        return true;
      }
    }

    return false;
  };
  const toCandidate = (node: HTMLElement): InteractionCandidate | null => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    if (
      rect.width < 6 ||
      rect.height < 6 ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.pointerEvents === "none" ||
      x < 0 ||
      y < 0 ||
      x > window.innerWidth ||
      y > window.innerHeight
    ) {
      return null;
    }

    return {
      display: style.display,
      height: rect.height,
      href: node instanceof HTMLAnchorElement ? node.getAttribute("href") || "" : "",
      isAnchor: node instanceof HTMLAnchorElement,
      pointerEvents: style.pointerEvents,
      visibility: style.visibility,
      width: rect.width,
      withinViewport: x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight,
      x,
      y,
    };
  };
  const needles = new Set(texts.map((text) => normalize(text)));
  const results: InteractionCandidate[] = [];

  for (const node of Array.from(
    document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]'),
  )) {
    const text = normalize(node.textContent ?? "");
    if (!hasMatch(text, needles)) {
      continue;
    }

    const candidate = toCandidate(node);
    if (!candidate) {
      continue;
    }

    results.push(candidate);
    if (results.length >= limit) {
      break;
    }
  }

  return results;
};

const autoScroll = async (page: Page, step: number, delayMs: number, maxScrolls: number) => {
  await page.evaluate(
    async ({ delayMs, maxScrolls, step }) => {
      await new Promise<void>((resolve) => {
        let count = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, step);
          count++;
          const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;

          if (atBottom || count >= maxScrolls) {
            clearInterval(timer);
            resolve();
          }
        }, delayMs);
      });
    },
    { delayMs, maxScrolls, step },
  );
};

const collectInteractionCandidates = (selectors: readonly string[]) => {
  return Array.from(document.querySelectorAll<HTMLElement>(selectors.join(","))).map((node) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);

    return {
      display: style.display,
      height: rect.height,
      href: node instanceof HTMLAnchorElement ? node.getAttribute("href") || "" : "",
      isAnchor: node instanceof HTMLAnchorElement,
      pointerEvents: style.pointerEvents,
      visibility: style.visibility,
      width: rect.width,
      withinViewport: x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight,
      x,
      y,
    };
  });
};

const hasLeftLandingPage = (currentUrl: string, landingUrl: string) => {
  const current = new URL(currentUrl);
  const landing = new URL(landingUrl);
  const normalizePathname = (pathname: string) =>
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname || "/";

  return (
    current.origin !== landing.origin ||
    normalizePathname(current.pathname) !== normalizePathname(landing.pathname) ||
    current.search !== landing.search
  );
};

const ensureLandingPage = async (page: Page, landingUrl: string, timeoutMs: number) => {
  try {
    if (!hasLeftLandingPage(page.url(), landingUrl)) {
      return true;
    }
  } catch {
    return false;
  }

  log("WARN", `Left landing page during automated interaction: ${page.url()}`);

  try {
    await page.goto(landingUrl, { timeout: timeoutMs, waitUntil: NAVIGATION_WAIT_UNTIL });
    return true;
  } catch (error: unknown) {
    log("WARN", `Unable to restore landing page ${landingUrl}: ${getErrorMessage(error)}`);
    return false;
  }
};

const clickInteractionTargets = async (
  page: Page,
  targets: CtaTarget[],
  landingUrl: string,
  timeoutMs: number,
) => {
  for (const point of targets) {
    try {
      await page.mouse.click(point.x, point.y);
      await sleep(TARGET_CLICK_DELAY_MS);
    } catch {
      // Ignore click issues during automated capture.
    }

    if (!(await ensureLandingPage(page, landingUrl, timeoutMs))) {
      return;
    }
  }
};

const exercisePage = async (page: Page, landingUrl: string, config: Config) => {
  const viewport = page.viewport() ?? { height: 720, width: 1280 };
  const centerX = Math.floor(viewport.width / 2);
  const centerY = Math.floor(viewport.height / 2);
  try {
    await page.mouse.click(centerX, centerY);
    await sleep(CENTER_CLICK_DELAY_MS);
  } catch {
    // Ignore click issues during automated capture.
  }

  if (!(await ensureLandingPage(page, landingUrl, config.timeoutMs))) {
    return;
  }

  const ctaTargets = selectInteractionTargets(
    await page.evaluate(collectCtaCandidates, CTA_TEXTS, CTA_LIMIT),
    landingUrl,
    CTA_LIMIT,
  );
  await clickInteractionTargets(page, ctaTargets, landingUrl, config.timeoutMs);
  if (!(await ensureLandingPage(page, landingUrl, config.timeoutMs))) {
    return;
  }

  const targets = selectInteractionTargets(
    await page.evaluate(collectInteractionCandidates, INTERACTION_SELECTORS),
    landingUrl,
    INTERACTION_LIMIT,
  );
  await clickInteractionTargets(page, targets, landingUrl, config.timeoutMs);
  if (!(await ensureLandingPage(page, landingUrl, config.timeoutMs))) {
    return;
  }

  try {
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 120, centerY + 40, { steps: 10 });
    await page.mouse.up();
    await sleep(DRAG_DELAY_MS);
  } catch {
    // Ignore drag issues during automated capture.
  }

  if (!(await ensureLandingPage(page, landingUrl, config.timeoutMs))) {
    return;
  }

  const keys: KeyInput[] = [
    "Space",
    "Enter",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
  ];
  for (const key of keys) {
    try {
      await page.keyboard.press(key);
      await sleep(KEY_DELAY_MS);
    } catch {
      // Ignore key issues during automated capture.
    }

    if (!(await ensureLandingPage(page, landingUrl, config.timeoutMs))) {
      return;
    }
  }
};

const configurePage = async (page: Page, config: Config) => {
  await page.setUserAgent({ userAgent: config.userAgent });
};

const buildCookieHeader = (cookies: Array<{ name: string; value: string }>) => {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
};

const collectCaptureMetadata = async (
  page: Page,
  landingUrl: string,
  documentHtml: string,
) => {
  const cookies = await page.cookies(landingUrl).catch(() => page.cookies().catch(() => []));
  return {
    cookieHeader: buildCookieHeader(cookies),
    documentHtml,
    finalHtml: await page.content().catch(() => ""),
    finalUrl: page.url(),
    landingUrl,
  };
};

const fetchDocumentHtml = async (
  urlStr: string,
  config: Config,
  cookieHeader: string,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(urlStr, {
      headers: {
        Accept: "text/html,*/*",
        "User-Agent": config.userAgent,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
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

const runCaptureNavigation = async (page: Page, config: Config) => {
  let documentHtml = "";
  try {
    const response = await page.goto(config.url, {
      timeout: config.timeoutMs,
      waitUntil: NAVIGATION_WAIT_UNTIL,
    });
    if (response) {
      const contentType = response.headers()["content-type"] ?? "";
      const body = await response.text().catch(() => "");
      if (isLikelyHtml(contentType, body)) {
        documentHtml = body;
      }
    }
  } catch (error: unknown) {
    log("WARN", `Navigation warning: ${getErrorMessage(error)}`);
  }

  if (config.scroll) {
    await autoScroll(page, config.scrollStep, config.scrollDelayMs, config.maxScrolls);
    await sleep(config.idleWaitMs);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(RESET_SCROLL_DELAY_MS);
  }

  const landingUrl = page.url();
  if (!documentHtml) {
    const cookies = await page.cookies(landingUrl).catch(() => []);
    documentHtml = await fetchDocumentHtml(landingUrl, config, buildCookieHeader(cookies));
  }
  await exercisePage(page, landingUrl, config);
  await sleep(config.idleWaitMs);
  return { landingUrl, documentHtml };
};

const attachCaptureListeners = (
  page: Page,
  config: Config,
  urls: Map<string, CaptureMeta>,
  hosts: Set<string>,
  requestHeaders: Map<string, Record<string, string>>,
  capturedApi: Set<string>,
  pendingTasks: Set<Promise<void>>,
) => {
  page.on("request", (request) => {
    const urlStr = request.url();
    if (shouldSkipUrl(urlStr)) {
      return;
    }

    requestHeaders.set(urlStr, stripUnsafeRequestHeaders(request.headers()));
  });

  page.on("response", (response) => {
    const urlStr = response.url();
    if (shouldSkipUrl(urlStr)) {
      return;
    }

    const status = response.status();
    if (status < 200 || status >= 400) {
      return;
    }

    trackPendingTask(
      pendingTasks,
      captureResponseArtifacts(response, config, capturedApi).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log("WARN", `Response capture failed for ${urlStr}: ${message}`);
      }),
    );

    urls.set(urlStr, {
      contentType: response.headers()["content-type"],
      status,
    });

    try {
      hosts.add(new URL(urlStr).host);
    } catch {
      // Ignore malformed URLs surfaced during best-effort capture.
    }
  });

  page.on("requestfailed", (request) => {
    if (!config.verbose) {
      return;
    }

    const urlStr = request.url();
    if (shouldSkipUrl(urlStr)) {
      return;
    }

    log("WARN", `Request failed: ${urlStr} (${request.failure()?.errorText ?? "unknown"})`);
  });
};

export const captureUrls = async (config: Config): Promise<CaptureResult> => {
  log("INFO", `Capture start: ${config.url}`);
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: config.headless,
  });
  const page = await browser.newPage();
  const urls = new Map<string, CaptureMeta>();
  const hosts = new Set<string>();
  const requestHeaders = new Map<string, Record<string, string>>();
  const capturedApi = new Set<string>();
  const pendingTasks = new Set<Promise<void>>();

  attachCaptureListeners(page, config, urls, hosts, requestHeaders, capturedApi, pendingTasks);

  try {
    await configurePage(page, config);
    const { landingUrl, documentHtml } = await runCaptureNavigation(page, config);
    await Promise.allSettled(Array.from(pendingTasks));
    const metadata = await collectCaptureMetadata(page, landingUrl, documentHtml);
    const urlList = Array.from(urls.keys());

    log("INFO", `Captured ${urlList.length} URLs.`);
    return { hosts, meta: urls, requestHeaders, urls: urlList, ...metadata };
  } finally {
    await browser.close();
  }
};

const navigateForMissingAssets = async (page: Page, targetUrl: string, config: Config) => {
  try {
    await page.goto(targetUrl, {
      timeout: config.timeoutMs,
      waitUntil: NAVIGATION_WAIT_UNTIL,
    });
  } catch (error: unknown) {
    log("WARN", `Local test navigation warning: ${getErrorMessage(error)}`);
  }

  if (config.scroll) {
    await autoScroll(page, config.scrollStep, config.scrollDelayMs, config.maxScrolls);
    await sleep(config.idleWaitMs);
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  await exercisePage(page, targetUrl, config);
  await sleep(config.idleWaitMs);
};

export const findMissingAssets = async (outDir: string, config: Config): Promise<Set<string>> => {
  const server = startStaticServer(outDir);
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: config.headless,
  });
  const missing = new Set<string>();
  const baseUrl = server.url.origin;

  try {
    const page = await browser.newPage();
    await configurePage(page, config);

    page.on("response", (response) => {
      const urlStr = response.url();
      if (urlStr.startsWith(baseUrl) && response.status() >= 400) {
        missing.add(urlStr);
      }
    });

    page.on("requestfailed", (request) => {
      const urlStr = request.url();
      if (urlStr.startsWith(baseUrl)) {
        missing.add(urlStr);
      }
    });

    await navigateForMissingAssets(page, new URL(config.entryPath, server.url).toString(), config);
  } finally {
    await browser.close();
    await server.stop(true);
  }

  return missing;
};
