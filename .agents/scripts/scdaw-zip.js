/**
 * .agents/scripts/scdaw-zip.js
 *
 * Zero-dependency pure JavaScript ZIP archive reader and writer.
 * Environment agnostic: runs identically in Node.js, Web Workers, and browser main thread.
 * Supports STORE (method 0) and DEFLATE (method 8) decompression via Web Streams API.
 */

// Precompute CRC-32 lookup table (polynomial 0xEDB88320)
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

export function computeCrc32(uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < uint8Array.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ uint8Array[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toUint8Array(input) {
  if (typeof input === "string") {
    return new TextEncoder().encode(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new TextEncoder().encode(String(input || ""));
}

/**
 * Encodes an array of file entries into a standard ZIP archive ArrayBuffer.
 * Uses STORE (method = 0) with UTF-8 filename flags.
 *
 * @param {Array<{ name: string, data: string | Uint8Array | ArrayBuffer }>} entries
 * @returns {ArrayBuffer}
 */
export function encodeZip(entries = []) {
  const encoder = new TextEncoder();
  const prepared = [];
  let localHeadersTotalSize = 0;
  let cdTotalSize = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name.replace(/\\/g, "/"));
    const dataBytes = toUint8Array(entry.data);
    const crc = computeCrc32(dataBytes);
    const localHeaderSize = 30 + nameBytes.length + dataBytes.length;
    const cdEntrySize = 46 + nameBytes.length;

    prepared.push({
      nameBytes,
      dataBytes,
      crc,
      localHeaderSize,
      cdEntrySize,
    });

    localHeadersTotalSize += localHeaderSize;
    cdTotalSize += cdEntrySize;
  }

  const eocdSize = 22;
  const totalBufferSize = localHeadersTotalSize + cdTotalSize + eocdSize;
  const buffer = new ArrayBuffer(totalBufferSize);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  let localOffset = 0;
  const cdRecords = [];

  // 1. Write Local File Headers + File Payloads
  for (const item of prepared) {
    const recordOffset = localOffset;

    // Local file header signature (0x04034b50)
    view.setUint32(localOffset, 0x04034b50, true);
    view.setUint16(localOffset + 4, 20, true); // Version needed to extract (2.0)
    view.setUint16(localOffset + 6, 0x0800, true); // General purpose flag (Bit 11: UTF-8)
    view.setUint16(localOffset + 8, 0, true); // Compression method (0 = STORE)
    view.setUint16(localOffset + 10, 0, true); // Last mod file time
    view.setUint16(localOffset + 12, 0, true); // Last mod file date
    view.setUint32(localOffset + 14, item.crc, true); // CRC-32
    view.setUint32(localOffset + 18, item.dataBytes.length, true); // Compressed size
    view.setUint32(localOffset + 22, item.dataBytes.length, true); // Uncompressed size
    view.setUint16(localOffset + 26, item.nameBytes.length, true); // Filename length
    view.setUint16(localOffset + 28, 0, true); // Extra field length

    // Copy filename
    uint8.set(item.nameBytes, localOffset + 30);
    // Copy data payload
    uint8.set(item.dataBytes, localOffset + 30 + item.nameBytes.length);

    cdRecords.push({
      nameBytes: item.nameBytes,
      dataLength: item.dataBytes.length,
      crc: item.crc,
      localOffset: recordOffset,
    });

    localOffset += item.localHeaderSize;
  }

  const cdOffset = localOffset;

  // 2. Write Central Directory Headers
  for (const item of cdRecords) {
    view.setUint32(localOffset, 0x02014b50, true); // Central directory signature
    view.setUint16(localOffset + 4, 20, true); // Version made by
    view.setUint16(localOffset + 6, 20, true); // Version needed to extract
    view.setUint16(localOffset + 8, 0x0800, true); // General purpose flag (UTF-8)
    view.setUint16(localOffset + 10, 0, true); // Compression method (0 = STORE)
    view.setUint16(localOffset + 12, 0, true); // Last mod time
    view.setUint16(localOffset + 14, 0, true); // Last mod date
    view.setUint32(localOffset + 16, item.crc, true); // CRC-32
    view.setUint32(localOffset + 20, item.dataLength, true); // Compressed size
    view.setUint32(localOffset + 24, item.dataLength, true); // Uncompressed size
    view.setUint16(localOffset + 28, item.nameBytes.length, true); // Filename length
    view.setUint16(localOffset + 30, 0, true); // Extra field length
    view.setUint16(localOffset + 32, 0, true); // File comment length
    view.setUint16(localOffset + 34, 0, true); // Disk number start
    view.setUint16(localOffset + 36, 0, true); // Internal attributes
    view.setUint32(localOffset + 38, 0, true); // External attributes
    view.setUint32(localOffset + 42, item.localOffset, true); // Local header offset

    uint8.set(item.nameBytes, localOffset + 46);
    localOffset += 46 + item.nameBytes.length;
  }

  // 3. Write End of Central Directory Record (EOCD)
  view.setUint32(localOffset, 0x06054b50, true); // EOCD signature
  view.setUint16(localOffset + 4, 0, true); // Disk number
  view.setUint16(localOffset + 6, 0, true); // Start disk
  view.setUint16(localOffset + 8, cdRecords.length, true); // Entries on disk
  view.setUint16(localOffset + 10, cdRecords.length, true); // Total entries
  view.setUint32(localOffset + 12, cdTotalSize, true); // Size of CD
  view.setUint32(localOffset + 16, cdOffset, true); // Offset of CD
  view.setUint16(localOffset + 20, 0, true); // Comment length

  return buffer;
}

/**
 * Decodes a standard ZIP archive into an array of file entries.
 *
 * @param {ArrayBuffer | Uint8Array} input
 * @returns {Promise<Array<{ name: string, data: Uint8Array }>>}
 */
export async function decodeZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Scan backwards for End of Central Directory signature (0x06054b50)
  let eocdOffset = -1;
  const maxSearch = Math.min(bytes.byteLength, 65557);
  for (let i = bytes.byteLength - 22; i >= bytes.byteLength - maxSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error(
      "Invalid ZIP archive: End of Central Directory record not found",
    );
  }

  const numEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const decoder = new TextDecoder("utf-8");
  const entries = [];
  let currCd = cdOffset;

  for (let idx = 0; idx < numEntries; idx++) {
    if (view.getUint32(currCd, true) !== 0x02014b50) {
      throw new Error(`Corrupt ZIP archive at central directory entry #${idx}`);
    }

    const compressionMethod = view.getUint16(currCd + 10, true);
    const compressedSize = view.getUint32(currCd + 20, true);
    const uncompressedSize = view.getUint32(currCd + 24, true);
    const fileNameLength = view.getUint16(currCd + 28, true);
    const extraLength = view.getUint16(currCd + 30, true);
    const commentLength = view.getUint16(currCd + 32, true);
    const localHeaderOffset = view.getUint32(currCd + 42, true);

    const nameBytes = bytes.subarray(currCd + 46, currCd + 46 + fileNameLength);
    const name = decoder.decode(nameBytes);

    // Read payload from local file header
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error(`Corrupt ZIP local header for entry "${name}"`);
    }

    const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset =
      localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const rawData = bytes.subarray(dataOffset, dataOffset + compressedSize);

    let finalData;
    if (compressionMethod === 0) {
      // STORE: uncompressed
      finalData = rawData.slice();
    } else if (compressionMethod === 8) {
      // DEFLATE: decompress via DecompressionStream
      if (typeof DecompressionStream !== "undefined") {
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        writer.write(rawData);
        writer.close();

        const chunks = [];
        const reader = ds.readable.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }

        const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0);
        finalData = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
          finalData.set(chunk, offset);
          offset += chunk.byteLength;
        }
      } else {
        throw new Error(
          `DecompressionStream is unsupported in this environment to decompress entry "${name}"`,
        );
      }
    } else {
      throw new Error(
        `Unsupported compression method: ${compressionMethod} in entry "${name}"`,
      );
    }

    // Skip directories ending in '/'
    if (!name.endsWith("/")) {
      entries.push({ name, data: finalData });
    }

    currCd += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Creates an openDAW-compatible ResourcePacker interface.
 */
export function createResourcePacker() {
  const files = [];
  return {
    write(path, data) {
      files.push({ name: path.replace(/\\/g, "/"), data });
      return { path, external: false };
    },
    toZip() {
      return encodeZip(files);
    },
  };
}

/**
 * Creates an openDAW-compatible ResourceProvider interface from decoded ZIP entries.
 */
export function createResourceProvider(entries) {
  const map = new Map();
  for (const entry of entries) {
    const cleanPath = entry.name.replace(/\\/g, "/");
    map.set(cleanPath, entry);
  }

  return {
    fromPath(path) {
      const clean = path.replace(/\\/g, "/");
      const found = map.get(clean);
      if (!found) {
        throw new Error(`Resource not found: ${path}`);
      }
      return {
        path: clean,
        name: clean.split("/").pop() || clean,
        buffer: found.data.buffer.slice(
          found.data.byteOffset,
          found.data.byteOffset + found.data.byteLength,
        ),
      };
    },
    has(path) {
      return map.has(path.replace(/\\/g, "/"));
    },
    list() {
      return Array.from(map.keys());
    },
  };
}
