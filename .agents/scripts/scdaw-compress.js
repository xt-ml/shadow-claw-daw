/**
 * .agents/scripts/scdaw-compress.js
 *
 * Universal Web Standards compression & decompression module.
 * Works natively in modern browsers and Node.js (18+) with zero dependencies.
 * Uses Web Streams (CompressionStream / DecompressionStream) and Base64URL.
 */

/**
 * Encodes a Uint8Array into a URL-safe Base64URL string (RFC 4648 §5).
 * Omits padding (`=`) to keep query strings minimal.
 *
 * @param {Uint8Array} bytes
 * @returns {string} Base64URL string
 */
export function bytesToBase64Url(bytes) {
  if (typeof bytes.toBase64 === "function") {
    return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
  }

  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes a Base64URL (or standard Base64) string back into a Uint8Array.
 *
 * @param {string} b64url
 * @returns {Uint8Array}
 */
export function base64UrlToBytes(b64url) {
  const cleaned = b64url.trim();

  if (typeof Uint8Array.fromBase64 === "function") {
    return Uint8Array.fromBase64(cleaned, { alphabet: "base64url" });
  }

  let b64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) {
    b64 += "=";
  }

  if (typeof atob === "function") {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  return new Uint8Array(Buffer.from(b64, "base64"));
}

/**
 * Compresses a UTF-8 string to a URL-safe Base64URL string.
 *
 * Default format is 'deflate-raw' (RFC 1951) for the smallest URL footprint.
 *
 * @param {string} text
 * @param {'deflate-raw' | 'gzip' | 'deflate'} [format='deflate-raw']
 * @returns {Promise<string>}
 */
export async function compressToBase64Url(text, format = "deflate-raw") {
  if (typeof text !== "string") {
    throw new TypeError("Expected a string to compress");
  }

  const stream = new Blob([new TextEncoder().encode(text)])
    .stream()
    .pipeThrough(new CompressionStream(format));

  const buffer = await new Response(stream).arrayBuffer();
  return bytesToBase64Url(new Uint8Array(buffer));
}

/**
 * Decompresses a URL-safe Base64URL string back to a UTF-8 string.
 *
 * @param {string} b64url
 * @param {'deflate-raw' | 'gzip' | 'deflate'} [format='deflate-raw']
 * @returns {Promise<string>}
 */
export async function decompressFromBase64Url(b64url, format = "deflate-raw") {
  if (!b64url || typeof b64url !== "string") {
    return "";
  }

  const bytes = base64UrlToBytes(b64url);
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream(format));

  return await new Response(stream).text();
}
