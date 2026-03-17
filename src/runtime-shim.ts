import path from 'node:path';

import { buildApiMockLookupKeys, isResponseMockCandidate, resolveApiMockPath } from '@/api-mocks.js';
import { directoryExists, readTextFile, walkDir, writeTextFile } from '@/files.js';
import { getEntryDir } from '@/site-paths.js';

const RUNTIME_FILE_NAME = '__shibik_runtime.js';
const RUNTIME_SCRIPT_ATTR = 'data-shibik-runtime="true"';
const ROOT_NORMALIZATION_MARKERS = [
    '/_external/',
    '/v3/',
    '/assets/',
    '/static/',
    '/media/',
    '/images/',
    '/img/',
    '/models/',
    '/textures/',
    '/sounds/',
    '/audio/',
    '/b/',
    '/js/',
] as const;
const EXTERNAL_ALIAS_FOLDERS = new Set([
    'additional-services',
    'assets',
    'audio',
    'b',
    'images',
    'img',
    'js',
    'media',
    'models',
    'sounds',
    'static',
    'textures',
]);

type RuntimeAliasMaps = {
    absoluteAliases: Record<string, string>;
    pathAliases: Record<string, string>;
    queryAliases: Record<string, string>;
};

const normalizeEntryDir = (entryDir: string) => {
    if (!entryDir || entryDir === '/') {
        return '/';
    }

    const normalized = entryDir.startsWith('/') ? entryDir : `/${entryDir}`;
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
};

export const normalizeRuntimePath = (pathname: string, entryDir: string) => {
    const normalizedEntry = normalizeEntryDir(entryDir);

    for (const marker of ROOT_NORMALIZATION_MARKERS) {
        const index = pathname.indexOf(marker, 1);
        if (index <= 0) {
            continue;
        }

        const shouldNormalizeFromEntry =
            normalizedEntry !== '/' && pathname.startsWith(normalizedEntry) && index === normalizedEntry.length - 1;

        const shouldNormalizeDuplicate =
            pathname.startsWith(marker) && pathname.indexOf(marker, marker.length - 1) === marker.length - 1;

        if (shouldNormalizeFromEntry || shouldNormalizeDuplicate) {
            return pathname.slice(index);
        }
    }

    return pathname;
};

const toLocalUrlPath = (outDir: string, absPath: string) => {
    return `/${path.relative(outDir, absPath).replace(/\\/g, '/')}`;
};

const buildQueryAliases = async (outDir: string, originHost: string, candidateUrls: Iterable<string>) => {
    const aliases = new Map<string, string>();

    for (const urlStr of new Set(candidateUrls)) {
        if (!isResponseMockCandidate(urlStr, originHost)) {
            continue;
        }

        let url: URL;
        try {
            url = new URL(urlStr);
        } catch {
            continue;
        }

        if (!url.search) {
            continue;
        }

        const absPath = resolveApiMockPath(outDir, url.pathname, url.search);
        if (!absPath) {
            continue;
        }

        const file = Bun.file(absPath);
        if (!(await file.exists())) {
            continue;
        }

        const localUrlPath = toLocalUrlPath(outDir, absPath);
        for (const key of buildApiMockLookupKeys(url.pathname, url.search)) {
            aliases.set(key, localUrlPath);
        }
    }

    return Object.fromEntries(aliases);
};

const buildAliasKey = (relativePath: string) => {
    const parts = relativePath.replace(/\\/g, '/').split('/');
    const folderIndex = parts.findIndex((part, index) => index >= 2 && EXTERNAL_ALIAS_FOLDERS.has(part));
    if (folderIndex < 0) {
        return null;
    }

    return `/${parts.slice(folderIndex).join('/')}`;
};

export const buildExternalPathAliases = async (outDir: string) => {
    const aliases = new Map<string, string | null>();
    const externalDir = path.join(outDir, '_external');
    if (!(await directoryExists(externalDir))) {
        return {};
    }

    for (const filePath of walkDir(externalDir)) {
        const relativePath = path.relative(outDir, filePath).replace(/\\/g, '/');
        const aliasKey = buildAliasKey(relativePath);
        if (!aliasKey) {
            continue;
        }

        const localFile = Bun.file(path.join(outDir, aliasKey.replace(/^\/+/, '')));
        if (await localFile.exists()) {
            continue;
        }

        const nextValue = `/${relativePath}`;
        const previous = aliases.get(aliasKey);
        if (previous && previous !== nextValue) {
            aliases.set(aliasKey, null);
            continue;
        }

        aliases.set(aliasKey, nextValue);
    }

    return Object.fromEntries(
        Array.from(aliases.entries()).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
};

export const buildAbsoluteExternalAliases = async (outDir: string) => {
    const aliases = new Map<string, string>();
    const externalDir = path.join(outDir, '_external');
    if (!(await directoryExists(externalDir))) {
        return {};
    }

    for (const filePath of walkDir(externalDir)) {
        const relativePath = path.relative(externalDir, filePath).replace(/\\/g, '/');
        const parts = relativePath.split('/');
        const host = parts[0];
        const rest = parts.slice(1).join('/');
        if (!host || !rest) {
            continue;
        }

        const localUrlPath = `/_external/${relativePath}`;
        aliases.set(`https://${host}/${rest}`, localUrlPath);
        aliases.set(`http://${host}/${rest}`, localUrlPath);
        aliases.set(`//${host}/${rest}`, localUrlPath);
    }

    return Object.fromEntries(aliases);
};

const buildRuntimeCode = ({ absoluteAliases, pathAliases, queryAliases }: RuntimeAliasMaps, entryDir: string) => {
    const markers = JSON.stringify(ROOT_NORMALIZATION_MARKERS);
    const absoluteAliasJson = JSON.stringify(absoluteAliases);
    const pathAliasJson = JSON.stringify(pathAliases);
    const queryAliasJson = JSON.stringify(queryAliases);
    const entryDirJson = JSON.stringify(normalizeEntryDir(entryDir));

    return `(() => {
  const ROOT_NORMALIZATION_MARKERS = ${markers};
  const ABSOLUTE_ALIASES = ${absoluteAliasJson};
  const PATH_ALIASES = ${pathAliasJson};
  const QUERY_ALIASES = ${queryAliasJson};
  const ENTRY_DIR = ${entryDirJson};

  const ensureTrackingStubs = () => {
    window.google_tag_manager = window.google_tag_manager || {};
    if (!window.google_tag_manager.rm || typeof window.google_tag_manager.rm !== "object") {
      window.google_tag_manager.rm = new Proxy({}, {
        get(target, key) {
          if (!(key in target)) {
            target[key] = () => "";
          }

          return target[key];
        },
      });
    }

    if (typeof window.btnt !== "function") {
      window.btnt = () => {};
    }
  };

  const normalizePath = (pathname) => {
    for (const marker of ROOT_NORMALIZATION_MARKERS) {
      const index = pathname.indexOf(marker, 1);
      if (index <= 0) {
        continue;
      }

      const shouldNormalizeFromEntry =
        ENTRY_DIR !== "/" &&
        pathname.startsWith(ENTRY_DIR) &&
        index === ENTRY_DIR.length - 1;

      const shouldNormalizeDuplicate =
        pathname.startsWith(marker) &&
        pathname.indexOf(marker, marker.length - 1) === marker.length - 1;

      if (shouldNormalizeFromEntry || shouldNormalizeDuplicate) {
        return pathname.slice(index);
      }
    }

    return pathname;
  };

  const resolveRewrittenUrl = (input, base = window.location.href) => {
    if (typeof input !== "string" || !input || input.startsWith("data:") || input.startsWith("blob:")) {
      return null;
    }

    let url;
    try {
      url = new URL(input, base);
    } catch {
      return null;
    }

    if (url.origin !== window.location.origin) {
      const absoluteAlias = ABSOLUTE_ALIASES[\`\${url.origin}\${url.pathname}\`] ?? ABSOLUTE_ALIASES[\`//\${url.host}\${url.pathname}\`];
      if (!absoluteAlias) {
        return null;
      }

      return new URL(\`\${absoluteAlias}\${url.search}\${url.hash}\`, window.location.origin).toString();
    }

    const originalPath = url.pathname;
    const normalizedPath = normalizePath(originalPath);
    const queryKey = \`\${normalizedPath}\${url.search}\`;
    const queryAlias = QUERY_ALIASES[queryKey];
    if (queryAlias) {
      return new URL(\`\${queryAlias}\${url.hash}\`, window.location.origin).toString();
    }

    const pathAlias = PATH_ALIASES[normalizedPath] ?? PATH_ALIASES[originalPath];
    if (pathAlias) {
      return new URL(\`\${pathAlias}\${url.search}\${url.hash}\`, window.location.origin).toString();
    }

    if (normalizedPath !== originalPath) {
      return new URL(\`\${normalizedPath}\${url.search}\${url.hash}\`, window.location.origin).toString();
    }

    return null;
  };

  ensureTrackingStubs();

  const patchProperty = (Ctor, property) => {
    if (typeof Ctor !== "function") {
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(Ctor.prototype, property);
    if (!descriptor || typeof descriptor.get !== "function" || typeof descriptor.set !== "function") {
      return;
    }

    Object.defineProperty(Ctor.prototype, property, {
      configurable: descriptor.configurable !== false,
      enumerable: descriptor.enumerable ?? false,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        const rewritten = typeof value === "string" ? resolveRewrittenUrl(value) ?? value : value;
        return descriptor.set.call(this, rewritten);
      },
    });
  };

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if ((name === "src" || name === "href") && typeof value === "string") {
      const rewritten = resolveRewrittenUrl(value);
      if (rewritten) {
        return originalSetAttribute.call(this, name, rewritten);
      }
    }

    return originalSetAttribute.call(this, name, value);
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string") {
      return originalFetch(resolveRewrittenUrl(input) ?? input, init);
    }

    if (input instanceof Request) {
      const rewritten = resolveRewrittenUrl(input.url);
      if (!rewritten) {
        return originalFetch(input, init);
      }

      try {
        return originalFetch(new Request(rewritten, input), init);
      } catch {
        return originalFetch(rewritten, init);
      }
    }

    return originalFetch(input, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    const rewritten = typeof url === "string" ? resolveRewrittenUrl(url) ?? url : url;
    return originalOpen.call(this, method, rewritten, ...rest);
  };

  patchProperty(HTMLImageElement, "src");
  patchProperty(HTMLScriptElement, "src");
  patchProperty(HTMLLinkElement, "href");
  patchProperty(HTMLMediaElement, "src");
  patchProperty(HTMLSourceElement, "src");
  patchProperty(HTMLIFrameElement, "src");

  const rewriteExistingElements = () => {
    for (const element of document.querySelectorAll("[src], [href]")) {
      if (element.hasAttribute("src")) {
        const current = element.getAttribute("src");
        const rewritten = current ? resolveRewrittenUrl(current) : null;
        if (rewritten) {
          element.setAttribute("src", rewritten);
        }
      }

      if (element.hasAttribute("href")) {
        const current = element.getAttribute("href");
        const rewritten = current ? resolveRewrittenUrl(current) : null;
        if (rewritten) {
          element.setAttribute("href", rewritten);
        }
      }
    }
  };

  rewriteExistingElements();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", rewriteExistingElements, { once: true });
  }
})();\n`;
};

export const injectRuntimeScriptTag = (html: string) => {
    if (html.includes(RUNTIME_SCRIPT_ATTR)) {
        return html;
    }

    const scriptTag = `<script src="/${RUNTIME_FILE_NAME}" ${RUNTIME_SCRIPT_ATTR}></script>`;
    const headMatch = html.match(/<head\b[^>]*>/i);
    if (headMatch) {
        return html.replace(headMatch[0], `${headMatch[0]}${scriptTag}`);
    }

    if (html.includes('</head>')) {
        return html.replace('</head>', `${scriptTag}</head>`);
    }

    return `${scriptTag}${html}`;
};

const writeRuntimeScript = async (outDir: string, aliasMaps: RuntimeAliasMaps, entryDir: string) => {
    await writeTextFile(path.join(outDir, RUNTIME_FILE_NAME), buildRuntimeCode(aliasMaps, entryDir));
};

const injectRuntimeScriptIntoHtmlFiles = async (outDir: string) => {
    for (const filePath of walkDir(outDir)) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext !== '.html' && ext !== '.htm') {
            continue;
        }

        const content = await readTextFile(filePath);
        const nextContent = injectRuntimeScriptTag(content);
        if (nextContent !== content) {
            await writeTextFile(filePath, nextContent);
        }
    }
};

export const writeRuntimeShim = async (
    outDir: string,
    originHost: string,
    candidateUrls: Iterable<string>,
    entryPath: string,
) => {
    const [absoluteAliases, pathAliases, queryAliases] = await Promise.all([
        buildAbsoluteExternalAliases(outDir),
        buildExternalPathAliases(outDir),
        buildQueryAliases(outDir, originHost, candidateUrls),
    ]);

    const entryDir = getEntryDir(entryPath);
    await writeRuntimeScript(outDir, { absoluteAliases, pathAliases, queryAliases }, entryDir);
    await injectRuntimeScriptIntoHtmlFiles(outDir);
};
