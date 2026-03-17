export type CaptureMeta = {
  contentType?: string;
  status: number;
};

export type CaptureResult = {
  cookieHeader: string;
  documentHtml: string;
  finalHtml: string;
  finalUrl: string;
  hosts: Set<string>;
  landingUrl: string;
  meta: Map<string, CaptureMeta>;
  requestHeaders: Map<string, Record<string, string>>;
  urls: string[];
};

export type Config = {
  concurrency: number;
  cookieHeader: string;
  entryPath: string;
  extraUrlFiles: string[];
  extraUrls: string[];
  headless: boolean;
  idleWaitMs: number;
  localTest: boolean;
  localTestRounds: number;
  maxRetries: number;
  maxScrolls: number;
  origin: string;
  originHost: string;
  outDir: string;
  requestHeaders: Map<string, Record<string, string>>;
  rewrite: boolean;
  scroll: boolean;
  scrollDelayMs: number;
  scrollStep: number;
  timeoutMs: number;
  url: string;
  userAgent: string;
  verbose: boolean;
};

export type CliArgs = {
  concurrency: number;
  extraUrlFiles: string[];
  extraUrls: string[];
  headless: boolean;
  help?: boolean;
  idleWaitMs: number;
  localTest: boolean;
  localTestRounds: number;
  maxRetries: number;
  maxScrolls: number;
  name?: string;
  origin?: string;
  out?: string;
  positionalOut?: string;
  positionalUrl?: string;
  rewrite: boolean;
  scroll: boolean;
  scrollDelayMs: number;
  scrollStep: number;
  timeoutMs: number;
  url?: string;
  userAgent: string;
  verbose: boolean;
};

export type DownloadResult = "downloaded" | "failed" | "skipped";

export type DownloadSummary = {
  downloaded: number;
  failed: number;
  failedUrls: string[];
  skipped: number;
};

export type LogLevel = "ERROR" | "INFO" | "WARN";
