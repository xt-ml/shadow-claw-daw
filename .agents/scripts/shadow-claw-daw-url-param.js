/**
 * .agents/scripts/shadow-claw-daw-url-param.js
 *
 * Re-exports the shared `#file=` / `?file=` URL parameter utilities
 * lifted up into `shadow-claw/utils/url-file-param`.
 */
export {
  MAX_HASH_URL_LENGTH,
  MAX_QUERY_URL_LENGTH,
  MAX_URL_PAYLOAD_CHARS,
  base64UrlToBytes,
  bytesToBase64Url,
  clearUrlParam,
  compressToBase64Url,
  consumePendingFileParam,
  createCompressedUrl,
  decompressFromBase64Url,
  getBaseHref,
  getCompressedParam,
  getPendingFileParam,
  getSiteConfigDefaultViewerComponents,
  getUrlParam,
  inferSharedFileName,
  readFileParamFromUrl,
  resolveDefaultViewerComponent,
  setPendingFileParam,
  validateBase64UrlLength,
  validateCompressedUrl,
} from "shadow-claw/utils/url-file-param";
