/**
 * .agents/scripts/scdaw-url-param.js
 *
 * URL parameter management for compressed project payloads.
 * Uses URL hash fragments (`#file=...`) by default so large songs never hit
 * HTTP 431 / 414 server header size limits, while also supporting `?file=`
 * query parameters for reading and clearing.
 */

import {
  compressToBase64Url,
  decompressFromBase64Url,
} from "./scdaw-compress.js";

/**
 * Resolves the current page's clean base URL (without query parameters or hash),
 * preferring `<base href>` if defined, otherwise falling back to `location.href`.
 *
 * @param {Document} [doc=globalThis.document]
 * @param {Location} [loc=globalThis.location]
 * @returns {string}
 */
export function getBaseHref(
  doc = typeof globalThis.document !== "undefined" ? globalThis.document : null,
  loc = typeof globalThis.location !== "undefined" ? globalThis.location : null,
) {
  const baseEl = doc?.querySelector?.("base[href]");
  if (baseEl?.getAttribute?.("href") || baseEl?.href) {
    const raw = baseEl.href || baseEl.getAttribute("href");
    const u = new URL(raw, loc?.href || "http://localhost/");
    u.search = "";
    u.hash = "";
    return u.toString();
  }

  if (loc?.href) {
    const u = new URL(loc.href);
    u.search = "";
    u.hash = "";
    return u.toString();
  }

  return "http://localhost/";
}

/**
 * Extracts a raw parameter value from a URL, Location, URLSearchParams, or string,
 * checking both query search parameters (`?file=`) and hash fragments (`#file=`).
 *
 * @param {string} paramName
 * @param {string|URL|URLSearchParams|Location} source
 * @returns {string|null}
 */
function readParamValue(paramName, source) {
  if (!source) return null;

  if (source instanceof URLSearchParams) {
    return source.get(paramName);
  }

  if (source instanceof URL) {
    const fromSearch = source.searchParams.get(paramName);
    if (fromSearch) return fromSearch;
    if (source.hash?.length > 1) {
      return new URLSearchParams(source.hash.slice(1)).get(paramName);
    }
    return null;
  }

  if (typeof source === "object" && ("search" in source || "hash" in source)) {
    if (source.search) {
      const fromSearch = new URLSearchParams(source.search).get(paramName);
      if (fromSearch) return fromSearch;
    }
    if (source.hash?.length > 1) {
      return new URLSearchParams(source.hash.slice(1)).get(paramName);
    }
    return null;
  }

  if (typeof source === "string") {
    try {
      if (/^https?:\/\//i.test(source)) {
        return readParamValue(paramName, new URL(source));
      }
    } catch (_) {}

    const hashIdx = source.indexOf("#");
    const queryPart = hashIdx >= 0 ? source.slice(0, hashIdx) : source;
    const hashPart = hashIdx >= 0 ? source.slice(hashIdx + 1) : "";

    if (queryPart.includes("?") || queryPart.includes("=")) {
      const q = queryPart.includes("?")
        ? queryPart.slice(queryPart.indexOf("?"))
        : queryPart;
      const fromSearch = new URLSearchParams(q).get(paramName);
      if (fromSearch) return fromSearch;
    }

    if (hashPart) {
      return new URLSearchParams(hashPart).get(paramName);
    }
  }

  return null;
}

/**
 * Extracts and decompresses a parameter from a URL, query string, or hash fragment.
 *
 * @param {string} [paramName='file']
 * @param {string|URL|URLSearchParams|Location} [source]
 * @param {'deflate-raw' | 'gzip' | 'deflate'} [format='deflate-raw']
 * @returns {Promise<string|null>}
 */
export async function getCompressedParam(
  paramName = "file",
  source = typeof globalThis.location !== "undefined"
    ? globalThis.location
    : "",
  format = "deflate-raw",
) {
  const encoded = readParamValue(paramName, source);
  if (!encoded) {
    return null;
  }

  try {
    return await decompressFromBase64Url(encoded, format);
  } catch (error) {
    console.error(`[scdaw] Failed to decompress param "${paramName}":`, error);
    return null;
  }
}

/**
 * Constructs a full URL with a compressed parameter.
 * Uses the URL hash fragment (`#file=...`) by default to avoid HTTP 431 / 414 limits.
 *
 * @param {string} baseUrl
 * @param {string} value
 * @param {object} [options]
 * @param {string} [options.paramName='file']
 * @param {boolean} [options.useHash=true]
 * @param {Record<string, string>} [options.extraParams]
 * @param {'deflate-raw' | 'gzip' | 'deflate'} [options.format='deflate-raw']
 * @returns {Promise<string>}
 */
export async function createCompressedUrl(
  baseUrl,
  value,
  {
    paramName = "file",
    useHash = true,
    extraParams = {},
    format = "deflate-raw",
  } = {},
) {
  const compressed = await compressToBase64Url(value, format);
  const targetUrl = new URL(baseUrl);

  if (useHash) {
    const hashParams = new URLSearchParams(
      targetUrl.hash ? targetUrl.hash.slice(1) : "",
    );
    hashParams.set(paramName, compressed);
    for (const [key, val] of Object.entries(extraParams)) {
      hashParams.set(key, val);
    }
    targetUrl.hash = hashParams.toString();
  } else {
    targetUrl.searchParams.set(paramName, compressed);
    for (const [key, val] of Object.entries(extraParams)) {
      targetUrl.searchParams.set(key, val);
    }
  }

  return targetUrl.toString();
}

/**
 * Removes a parameter from both the URL query string and hash fragment
 * using history.replaceState.
 *
 * @param {string} [paramName='file']
 * @param {string} [url]
 * @returns {string} The updated URL string
 */
export function clearUrlParam(
  paramName = "file",
  url = typeof globalThis.location !== "undefined"
    ? globalThis.location.href
    : "",
) {
  if (!url) return "";

  const targetUrl = new URL(url, "http://localhost/");
  targetUrl.searchParams.delete(paramName);

  if (targetUrl.hash?.length > 1) {
    const hashParams = new URLSearchParams(targetUrl.hash.slice(1));
    hashParams.delete(paramName);
    const remainingHash = hashParams.toString();
    targetUrl.hash = remainingHash ? `#${remainingHash}` : "";
  }

  if (typeof globalThis.history?.replaceState === "function") {
    const relative = targetUrl.pathname + targetUrl.search + targetUrl.hash;
    globalThis.history.replaceState(null, "", relative);
  }

  return targetUrl.toString();
}
