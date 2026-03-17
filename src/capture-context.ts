export type CaptureContext = {
  entryPath: string;
  origin: string;
  originHost: string;
};

type ResolveCaptureContextInput = {
  configuredOrigin?: string;
  landingUrl?: string;
  targetUrl: string;
};

const stripTrailingSlash = (value: string) => value.replace(/\/$/, "");

const getEntryPath = (urlStr: string) => {
  const parsed = new URL(urlStr);
  return `${parsed.pathname || "/"}${parsed.search || ""}${parsed.hash || ""}`;
};

const isHttpUrl = (value: string | undefined): value is string => {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const resolveCaptureContext = ({
  configuredOrigin,
  landingUrl,
  targetUrl,
}: ResolveCaptureContextInput): CaptureContext => {
  if (configuredOrigin) {
    const origin = stripTrailingSlash(configuredOrigin);
    return {
      entryPath: getEntryPath(targetUrl),
      origin,
      originHost: new URL(origin).host,
    };
  }

  const resolvedUrl = isHttpUrl(landingUrl) ? landingUrl : targetUrl;
  const origin = stripTrailingSlash(new URL(resolvedUrl).origin);

  return {
    entryPath: getEntryPath(resolvedUrl),
    origin,
    originHost: new URL(origin).host,
  };
};
