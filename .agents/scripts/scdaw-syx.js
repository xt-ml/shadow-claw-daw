// Ported concepts from openDAW Tubular / Dx7Sysex & fm1_open dx7core (AGPL-3.0-or-later / Apache-2.0)
/**
 * .agents/scripts/scdaw-syx.js
 *
 * Pure-JS DX7 6-operator / 32-algorithm topology decoder, SVG renderer,
 * and Standard MIDI SysEx (.syx) voice & 32-voice cartridge codec.
 * Zero DOM and zero Web Audio dependencies.
 */

export const OUT_BUS_ADD = 1 << 2;
export const FB_IN = 1 << 6;
export const FB_OUT = 1 << 7;

export const DX7_PATCH_SIZE = 155;
export const DX7_PACKED_SIZE = 128;
export const DX7_VOICE_SIZE = 163;
export const DX7_BANK_SIZE = 4104;
export const DX7_BANK_BODY = 4096;

/**
 * 32 classic Yamaha DX7 operator routing algorithms.
 * Index 0..5 corresponds to processing order OP6..OP1.
 */
export const DX7_ALGORITHMS = Object.freeze([
  [0xc1, 0x11, 0x11, 0x14, 0x01, 0x14], // 1
  [0x01, 0x11, 0x11, 0x14, 0xc1, 0x14], // 2
  [0xc1, 0x11, 0x14, 0x01, 0x11, 0x14], // 3
  [0x41, 0x11, 0x94, 0x01, 0x11, 0x14], // 4
  [0xc1, 0x14, 0x01, 0x14, 0x01, 0x14], // 5
  [0x41, 0x94, 0x01, 0x14, 0x01, 0x14], // 6
  [0xc1, 0x11, 0x05, 0x14, 0x01, 0x14], // 7
  [0x01, 0x11, 0xc5, 0x14, 0x01, 0x14], // 8
  [0x01, 0x11, 0x05, 0x14, 0xc1, 0x14], // 9
  [0x01, 0x05, 0x14, 0xc1, 0x11, 0x14], // 10
  [0xc1, 0x05, 0x14, 0x01, 0x11, 0x14], // 11
  [0x01, 0x05, 0x05, 0x14, 0xc1, 0x14], // 12
  [0xc1, 0x05, 0x05, 0x14, 0x01, 0x14], // 13
  [0xc1, 0x05, 0x11, 0x14, 0x01, 0x14], // 14
  [0x01, 0x05, 0x11, 0x14, 0xc1, 0x14], // 15
  [0xc1, 0x11, 0x02, 0x25, 0x05, 0x14], // 16
  [0x01, 0x11, 0x02, 0x25, 0xc5, 0x14], // 17
  [0x01, 0x11, 0x11, 0xc5, 0x05, 0x14], // 18
  [0xc1, 0x14, 0x14, 0x01, 0x11, 0x14], // 19
  [0x01, 0x05, 0x14, 0xc1, 0x14, 0x14], // 20
  [0x01, 0x14, 0x14, 0xc1, 0x14, 0x14], // 21
  [0xc1, 0x14, 0x14, 0x14, 0x01, 0x14], // 22
  [0xc1, 0x14, 0x14, 0x01, 0x14, 0x04], // 23
  [0xc1, 0x14, 0x14, 0x14, 0x04, 0x04], // 24
  [0xc1, 0x14, 0x14, 0x04, 0x04, 0x04], // 25
  [0xc1, 0x05, 0x14, 0x01, 0x14, 0x04], // 26
  [0x01, 0x05, 0x14, 0xc1, 0x14, 0x04], // 27
  [0x04, 0xc1, 0x11, 0x14, 0x01, 0x14], // 28
  [0xc1, 0x14, 0x01, 0x14, 0x04, 0x04], // 29
  [0x04, 0xc1, 0x11, 0x14, 0x04, 0x04], // 30
  [0xc1, 0x14, 0x04, 0x04, 0x04, 0x04], // 31
  [0xc4, 0x04, 0x04, 0x04, 0x04, 0x04], // 32
]);

/**
 * Decodes a DX7 algorithm (1..32) into per-operator carrier, feedback,
 * and modulation target metadata.
 *
 * @param {number} [algorithm=1] - 1-based DX7 algorithm number (1..32)
 * @returns {{
 *   algorithm: number,
 *   operators: Array<{ op: number, isCarrier: boolean, hasFeedback: boolean, targets: number[], modulatedBy: number[] }>,
 *   carriers: number[],
 *   modulators: number[],
 *   edges: Array<{ from: number, to: number }>,
 * }}
 */
export function describeDx7Algorithm(algorithm = 1) {
  const clamped = Math.max(1, Math.min(32, Math.round(Number(algorithm) || 1)));
  const row = DX7_ALGORITHMS[clamped - 1];
  const opsByNum = new Map();
  for (let op = 1; op <= 6; op++) {
    opsByNum.set(op, {
      op,
      isCarrier: false,
      hasFeedback: false,
      targets: [],
      modulatedBy: [],
    });
  }

  const busProducers = [[], [], []];
  const edges = [];

  for (let idx = 0; idx < 6; idx++) {
    const opNum = 6 - idx;
    const flags = row[idx];
    const add = (flags & OUT_BUS_ADD) !== 0;
    const inbus = (flags >> 4) & 3;
    const outbus = flags & 3;
    const info = opsByNum.get(opNum);

    if (outbus === 0) info.isCarrier = true;
    if ((flags & (FB_IN | FB_OUT)) !== 0) info.hasFeedback = true;

    if (inbus > 0 && busProducers[inbus].length > 0) {
      for (const srcOp of busProducers[inbus]) {
        const srcInfo = opsByNum.get(srcOp);
        if (!srcInfo.targets.includes(opNum)) srcInfo.targets.push(opNum);
        if (!info.modulatedBy.includes(srcOp)) info.modulatedBy.push(srcOp);
        edges.push({ from: srcOp, to: opNum });
      }
    }

    if (outbus > 0) {
      if (add) {
        if (!busProducers[outbus].includes(opNum)) {
          busProducers[outbus].push(opNum);
        }
      } else {
        busProducers[outbus] = [opNum];
      }
    }
  }

  const operators = [];
  const carriers = [];
  const modulators = [];
  for (let op = 1; op <= 6; op++) {
    const info = opsByNum.get(op);
    operators.push(info);
    if (info.isCarrier) carriers.push(op);
    else modulators.push(op);
  }

  return { algorithm: clamped, operators, carriers, modulators, edges };
}

/**
 * Generates an accessible SVG topology diagram for any of the 32 DX7 algorithms.
 *
 * @param {number} [algorithm=1]
 * @param {number|null} [activeOp=null]
 * @returns {string}
 */
export function renderAlgorithmSvg(algorithm = 1, activeOp = null) {
  const desc = describeDx7Algorithm(algorithm);

  // Assign tree depth (distance above carrier row) for clean top-down layout
  const depthMap = new Map();
  const assignDepth = (op, depth) => {
    const prev = depthMap.get(op) ?? -1;
    if (depth > prev) depthMap.set(op, depth);
    const info = desc.operators[op - 1];
    for (const modOp of info.modulatedBy) {
      assignDepth(modOp, depth + 1);
    }
  };
  for (const c of desc.carriers) {
    assignDepth(c, 0);
  }

  // Group operators by depth layer (0 = bottom carriers, higher = modulators above)
  let maxDepth = 0;
  for (const d of depthMap.values()) {
    if (d > maxDepth) maxDepth = d;
  }

  const layers = Array.from({ length: maxDepth + 1 }, () => []);
  for (let op = 1; op <= 6; op++) {
    const d = depthMap.get(op) ?? 0;
    layers[d].push(op);
  }

  const width = 260;
  const height = 114;
  const boxW = 28;
  const boxH = 18;
  const bottomY = height - 28;
  const layerStepY = maxDepth > 0 ? Math.min(28, Math.floor(68 / maxDepth)) : 0;

  const coords = new Map();
  layers.forEach((opsInLayer, d) => {
    const y = bottomY - d * layerStepY;
    const count = opsInLayer.length;
    const spacing = Math.min(42, Math.floor((width - 24) / Math.max(1, count)));
    const totalW = (count - 1) * spacing;
    const startX = width / 2 - totalW / 2;
    opsInLayer.forEach((op, i) => {
      coords.set(op, { x: startX + i * spacing, y });
    });
  });

  const edgeLines = desc.edges
    .map(({ from, to }) => {
      const a = coords.get(from);
      const b = coords.get(to);
      if (!a || !b) return "";
      return `<line x1="${a.x.toFixed(1)}" y1="${(a.y + boxH / 2).toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${(b.y - boxH / 2).toFixed(1)}" stroke="rgba(128, 212, 219, 0.7)" stroke-width="1.5" />`;
    })
    .join("");

  const carrierBusY = height - 6;
  const carrierDrops = desc.carriers
    .map((op) => {
      const c = coords.get(op);
      return `<line x1="${c.x.toFixed(1)}" y1="${(c.y + boxH / 2).toFixed(1)}" x2="${c.x.toFixed(1)}" y2="${carrierBusY}" stroke="#80d4db" stroke-width="1.5" />`;
    })
    .join("");

  const carrierMinX = Math.min(...desc.carriers.map((op) => coords.get(op).x));
  const carrierMaxX = Math.max(...desc.carriers.map((op) => coords.get(op).x));

  const boxes = desc.operators
    .map((info) => {
      const c = coords.get(info.op);
      const x = c.x - boxW / 2;
      const y = c.y - boxH / 2;
      const isSelected = Number(activeOp) === info.op;
      const fill = info.isCarrier ? "#1b3b3e" : "#1d2426";
      const stroke = isSelected
        ? "#f59e0b"
        : info.isCarrier
          ? "#80d4db"
          : "#64748b";
      const fbArc = info.hasFeedback
        ? `<path d="M ${(x + boxW).toFixed(1)} ${(c.y - 3).toFixed(1)} C ${(x + boxW + 10).toFixed(1)} ${(c.y - 10).toFixed(1)}, ${(x + boxW + 10).toFixed(1)} ${(c.y + 10).toFixed(1)}, ${(x + boxW).toFixed(1)} ${(c.y + 3).toFixed(1)}" fill="none" stroke="#f59e0b" stroke-width="1.4" />`
        : "";
      return `
        ${fbArc}
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${boxW}" height="${boxH}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${isSelected ? "2" : "1.2"}" />
        <text x="${c.x.toFixed(1)}" y="${(c.y + 3.5).toFixed(1)}" text-anchor="middle" font-size="9" font-family="monospace" font-weight="700" fill="${info.isCarrier ? "#a5f3fc" : "#cbd5e1"}">OP${info.op}</text>
      `;
    })
    .join("");

  return `<svg class="scdaw-synth__algo-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="DX7 Algorithm ${desc.algorithm}: carriers ${desc.carriers.join(", ")}; modulators ${desc.modulators.join(", ") || "none"}">
    <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" fill="rgba(8, 13, 15, 0.7)" stroke="rgba(255,255,255,0.1)" />
    ${edgeLines}
    ${carrierDrops}
    <line x1="${Math.max(12, carrierMinX).toFixed(1)}" y1="${carrierBusY}" x2="${Math.min(width - 12, carrierMaxX).toFixed(1)}" y2="${carrierBusY}" stroke="#80d4db" stroke-width="2" />
    ${boxes}
    <text x="8" y="13" font-size="9" font-family="monospace" fill="#94a3b8">ALG ${String(desc.algorithm).padStart(2, "0")}</text>
  </svg>`;
}

/**
 * Computes the standard Yamaha DX7 7-bit two's-complement SysEx checksum.
 *
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function dx7SysexChecksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    sum -= bytes[i];
  }
  return sum & 0x7f;
}

/**
 * Unpacks a 128-byte VMEM cartridge voice into the 155-byte VCED format.
 *
 * @param {Uint8Array} bulk
 * @returns {Uint8Array}
 */
export function unpackDx7Voice(bulk) {
  const patch = new Uint8Array(DX7_PATCH_SIZE);
  for (let op = 0; op < 6; op++) {
    const src = op * 17;
    const dst = op * 21;
    for (let i = 0; i < 11; i++) {
      patch[dst + i] = bulk[src + i] & 0x7f;
    }
    const lrCurves = bulk[src + 11] & 0x0f;
    patch[dst + 11] = lrCurves & 3;
    patch[dst + 12] = (lrCurves >> 2) & 3;
    const detuneRs = bulk[src + 12] & 0x7f;
    patch[dst + 13] = detuneRs & 7;
    const kvsAms = bulk[src + 13] & 0x1f;
    patch[dst + 14] = kvsAms & 3;
    patch[dst + 15] = (kvsAms >> 2) & 7;
    patch[dst + 16] = bulk[src + 14] & 0x7f;
    const coarseMode = bulk[src + 15] & 0x3f;
    patch[dst + 17] = coarseMode & 1;
    patch[dst + 18] = (coarseMode >> 1) & 0x1f;
    patch[dst + 19] = bulk[src + 16] & 0x7f;
    patch[dst + 20] = (detuneRs >> 3) & 0x0f;
  }
  for (let i = 0; i < 8; i++) {
    patch[126 + i] = bulk[102 + i] & 0x7f;
  }
  patch[134] = bulk[110] & 0x1f;
  const syncFb = bulk[111] & 0x0f;
  patch[135] = syncFb & 7;
  patch[136] = (syncFb >> 3) & 1;
  patch[137] = bulk[112] & 0x7f;
  patch[138] = bulk[113] & 0x7f;
  patch[139] = bulk[114] & 0x7f;
  patch[140] = bulk[115] & 0x7f;
  const sensWaveSync = bulk[116] & 0x7f;
  patch[141] = sensWaveSync & 1;
  patch[142] = (sensWaveSync >> 1) & 7;
  patch[143] = (sensWaveSync >> 4) & 7;
  patch[144] = bulk[117] & 0x7f;
  for (let i = 0; i < 10; i++) {
    patch[145 + i] = bulk[118 + i] & 0x7f;
  }
  return patch;
}

/**
 * Packs a 155-byte VCED voice into a 128-byte VMEM cartridge slot.
 *
 * @param {Uint8Array} patch
 * @returns {Uint8Array}
 */
export function packDx7Voice(patch) {
  const bulk = new Uint8Array(DX7_PACKED_SIZE);
  for (let op = 0; op < 6; op++) {
    const src = op * 21;
    const dst = op * 17;
    bulk.set(patch.subarray(src, src + 11), dst);
    bulk[dst + 11] = ((patch[src + 12] & 3) << 2) | (patch[src + 11] & 3);
    bulk[dst + 12] = ((patch[src + 20] & 0x0f) << 3) | (patch[src + 13] & 7);
    bulk[dst + 13] = ((patch[src + 15] & 7) << 2) | (patch[src + 14] & 3);
    bulk[dst + 14] = patch[src + 16] & 0x7f;
    bulk[dst + 15] = ((patch[src + 18] & 0x1f) << 1) | (patch[src + 17] & 1);
    bulk[dst + 16] = patch[src + 19] & 0x7f;
  }
  bulk.set(patch.subarray(126, 134), 102);
  bulk[110] = patch[134] & 0x1f;
  bulk[111] = ((patch[136] & 1) << 3) | (patch[135] & 7);
  bulk.set(patch.subarray(137, 141), 112);
  bulk[116] =
    ((patch[143] & 7) << 4) | ((patch[142] & 7) << 1) | (patch[141] & 1);
  bulk[117] = patch[144] & 0x7f;
  bulk.set(patch.subarray(145, 155), 118);
  return bulk;
}

function readPatchName(patch) {
  let out = "";
  for (let i = 145; i < 155; i++) {
    const ch = patch[i] & 0x7f;
    out += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : " ";
  }
  return out.trim() || "INIT VOICE";
}

function dx7RateToSeconds(rate, minSec, maxSec) {
  const clamped = Math.max(0, Math.min(99, Number(rate ?? 50)));
  const norm = (99 - clamped) / 99;
  return Number((minSec + Math.pow(norm, 2.2) * (maxSec - minSec)).toFixed(3));
}

function secondsToDx7Rate(sec, minSec, maxSec) {
  const norm = Math.max(
    0,
    Math.min(1, (Number(sec ?? minSec) - minSec) / (maxSec - minSec)),
  );
  return Math.max(
    0,
    Math.min(99, Math.round(99 - Math.pow(norm, 1 / 2.2) * 99)),
  );
}

/**
 * Converts a 155-byte unpacked DX7 VCED patch into ShadowClaw `tubular` parameters.
 *
 * @param {Uint8Array} patch
 * @param {number} [index=0]
 * @returns {{ index: number, name: string, algorithm: number, feedback: number, params: object }}
 */
export function dx7PatchToTubularParams(patch, index = 0) {
  const algorithm = (patch[134] & 0x1f) + 1;
  const feedback = patch[135] & 7;
  const name = readPatchName(patch);
  const desc = describeDx7Algorithm(algorithm);

  const params = {
    instrument: "tubular",
    patchName: name,
    algorithm,
    feedback,
    modIndex: 2.5,
    brightness: 1.0,
    attack: 0.01,
    decay: 0.5,
    sustain: 0.4,
    release: 0.3,
    lfoRate: Number((0.2 + (patch[137] / 99) * 14).toFixed(2)),
    lfoPitchDepth: Math.round((patch[139] / 99) * 80),
  };

  let carrierAttackSum = 0;
  let carrierDecaySum = 0;
  let carrierSustainSum = 0;
  let carrierReleaseSum = 0;
  let carrierCount = 0;
  let modLevelSum = 0;
  let modCount = 0;

  // VCED stores OP6 at idx=0 .. OP1 at idx=5
  for (let idx = 0; idx < 6; idx++) {
    const opNum = 6 - idx;
    const base = idx * 21;
    const r1 = patch[base + 0];
    const r2 = patch[base + 1];
    const r3 = patch[base + 2];
    const r4 = patch[base + 3];
    const l3 = patch[base + 6];
    const outLevel = patch[base + 16];
    const coarse = patch[base + 18] & 0x1f;
    const fine = patch[base + 19];
    const detuneRaw = patch[base + 20] & 0x0f;

    const coarseVal = coarse === 0 ? 0.5 : coarse;
    const ratio = Math.max(
      0.25,
      Math.min(16, Number((coarseVal * (1 + fine / 100)).toFixed(2))),
    );
    const level = Number((Math.max(0, Math.min(99, outLevel)) / 99).toFixed(2));
    const detune = Math.max(-100, Math.min(100, (detuneRaw - 7) * 7));
    const opAttack = dx7RateToSeconds(r1, 0.002, 1.8);
    const opDecay = dx7RateToSeconds((r2 + r3) / 2, 0.03, 3.5);
    const opRelease = dx7RateToSeconds(r4, 0.02, 3.5);

    params[`op${opNum}Ratio`] = ratio;
    params[`op${opNum}Level`] = level;
    params[`op${opNum}Detune`] = detune;
    params[`op${opNum}Attack`] = opAttack;
    params[`op${opNum}Decay`] = opDecay;

    const opInfo = desc.operators[opNum - 1];
    if (opInfo.isCarrier) {
      carrierAttackSum += opAttack;
      carrierDecaySum += opDecay;
      carrierSustainSum += Math.max(0, Math.min(1, l3 / 99));
      carrierReleaseSum += opRelease;
      carrierCount++;
    } else if (level > 0) {
      modLevelSum += level;
      modCount++;
    }
  }

  if (carrierCount > 0) {
    params.attack = Number((carrierAttackSum / carrierCount).toFixed(3));
    params.decay = Number((carrierDecaySum / carrierCount).toFixed(3));
    params.sustain = Number((carrierSustainSum / carrierCount).toFixed(2));
    params.release = Number((carrierReleaseSum / carrierCount).toFixed(3));
  }
  if (modCount > 0) {
    params.modIndex = Number(
      Math.max(0.2, Math.min(10, (modLevelSum / modCount) * 6.5)).toFixed(2),
    );
  }

  return { index, name, algorithm, feedback, params };
}

/**
 * Parses a DX7 `.syx` buffer (163-byte single VCED, 155-byte raw VCED,
 * 4104-byte 32-voice VMEM cartridge, or 4096-byte raw VMEM body) into voices.
 *
 * @param {ArrayBuffer|Uint8Array} inputBuffer
 * @returns {Array<{ index: number, name: string, algorithm: number, feedback: number, params: object }>}
 */
export function parseDx7Sysex(inputBuffer) {
  const bytes =
    inputBuffer instanceof Uint8Array
      ? inputBuffer
      : new Uint8Array(inputBuffer || 0);

  if (bytes.length === DX7_BANK_BODY && bytes[0] !== 0xf0) {
    const voices = [];
    for (let i = 0; i < 32; i++) {
      const slot = bytes.subarray(
        i * DX7_PACKED_SIZE,
        (i + 1) * DX7_PACKED_SIZE,
      );
      voices.push(dx7PatchToTubularParams(unpackDx7Voice(slot), i));
    }
    return voices;
  }

  if (bytes.length === DX7_PATCH_SIZE && bytes[0] !== 0xf0) {
    return [dx7PatchToTubularParams(bytes, 0)];
  }

  const voices = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const start = bytes.indexOf(0xf0, cursor);
    if (start < 0) break;
    const end = bytes.indexOf(0xf7, start);
    if (end < 0) {
      throw new Error("Unterminated DX7 SysEx message");
    }
    const msg = bytes.subarray(start, end + 1);
    const isBank =
      msg.length === DX7_BANK_SIZE &&
      msg[1] === 0x43 &&
      (msg[2] & 0xf0) === 0 &&
      msg[3] === 0x09 &&
      msg[4] === 0x20 &&
      msg[5] === 0x00;
    const isVoice =
      msg.length === DX7_VOICE_SIZE &&
      msg[1] === 0x43 &&
      (msg[2] & 0xf0) === 0 &&
      msg[3] === 0x00 &&
      msg[4] === 0x01 &&
      msg[5] === 0x1b;

    if (isBank) {
      const body = msg.subarray(6, 6 + DX7_BANK_BODY);
      if (dx7SysexChecksum(body) !== msg[6 + DX7_BANK_BODY]) {
        throw new Error("DX7 bank SysEx checksum mismatch");
      }
      for (let i = 0; i < 32; i++) {
        const slot = body.subarray(
          i * DX7_PACKED_SIZE,
          (i + 1) * DX7_PACKED_SIZE,
        );
        voices.push(
          dx7PatchToTubularParams(unpackDx7Voice(slot), voices.length),
        );
      }
    } else if (isVoice) {
      const data = msg.subarray(6, 6 + DX7_PATCH_SIZE);
      if (dx7SysexChecksum(data) !== msg[6 + DX7_PATCH_SIZE]) {
        throw new Error("DX7 single-voice SysEx checksum mismatch");
      }
      voices.push(dx7PatchToTubularParams(data, voices.length));
    } else {
      throw new Error(
        `Unsupported DX7 SysEx message length (${msg.length} bytes)`,
      );
    }
    cursor = end + 1;
  }

  if (voices.length === 0) {
    throw new Error("No DX7 voices found in SysEx data");
  }
  return voices;
}

/**
 * Encodes ShadowClaw `tubular` parameters into a 155-byte DX7 VCED patch buffer.
 *
 * @param {object} [params={}]
 * @param {string} [name]
 * @returns {Uint8Array}
 */
export function tubularParamsToDx7Patch(params = {}, name = null) {
  const patch = new Uint8Array(DX7_PATCH_SIZE);
  const algorithm = Math.max(
    1,
    Math.min(32, Math.round(Number(params.algorithm ?? 1))),
  );
  const feedback = Math.max(
    0,
    Math.min(7, Math.round(Number(params.feedback ?? 4))),
  );
  const desc = describeDx7Algorithm(algorithm);

  const defaultLevels = [1.0, 0.75, 0.6, 0.45, 0.0, 0.0];
  const defaultRatios = [1.0, 2.0, 1.0, 3.0, 1.0, 4.0];

  for (let idx = 0; idx < 6; idx++) {
    const opNum = 6 - idx;
    const base = idx * 21;
    const ratio = Number(params[`op${opNum}Ratio`] ?? defaultRatios[opNum - 1]);
    const level = Number(params[`op${opNum}Level`] ?? defaultLevels[opNum - 1]);
    const detune = Number(params[`op${opNum}Detune`] ?? 0);
    const opAtk = Number(params[`op${opNum}Attack`] ?? params.attack ?? 0.01);
    const opDec = Number(params[`op${opNum}Decay`] ?? params.decay ?? 0.5);
    const isCarrier = desc.operators[opNum - 1].isCarrier;
    const susVal = isCarrier ? Number(params.sustain ?? 0.4) : 0.2;

    const r1 = secondsToDx7Rate(opAtk, 0.002, 1.8);
    const r2 = secondsToDx7Rate(opDec, 0.03, 3.5);
    const r4 = secondsToDx7Rate(Number(params.release ?? 0.3), 0.02, 3.5);

    patch[base + 0] = r1;
    patch[base + 1] = r2;
    patch[base + 2] = r2;
    patch[base + 3] = r4;
    patch[base + 4] = 99;
    patch[base + 5] = 99;
    patch[base + 6] = Math.max(0, Math.min(99, Math.round(susVal * 99)));
    patch[base + 7] = 0;
    patch[base + 16] = Math.max(0, Math.min(99, Math.round(level * 99)));

    // Coarse / Fine ratio
    const clampedRatio = Math.max(0.5, Math.min(31.99, ratio));
    const coarse =
      clampedRatio < 1.0 ? 0 : Math.min(31, Math.floor(clampedRatio));
    const baseRatio = coarse === 0 ? 0.5 : coarse;
    const fine = Math.max(
      0,
      Math.min(99, Math.round((clampedRatio / baseRatio - 1) * 100)),
    );
    patch[base + 17] = 0; // ratio mode
    patch[base + 18] = coarse;
    patch[base + 19] = fine;
    patch[base + 20] = Math.max(0, Math.min(14, Math.round(7 + detune / 7)));
  }

  // Pitch EG neutral (levels = 50, rates = 99)
  patch[126] = 99;
  patch[127] = 99;
  patch[128] = 99;
  patch[129] = 99;
  patch[130] = 50;
  patch[131] = 50;
  patch[132] = 50;
  patch[133] = 50;

  patch[134] = algorithm - 1;
  patch[135] = feedback;
  patch[136] = 1; // osc key sync
  patch[137] = Math.max(
    0,
    Math.min(99, Math.round(((Number(params.lfoRate ?? 4) - 0.2) / 14) * 99)),
  );
  patch[139] = Math.max(
    0,
    Math.min(99, Math.round((Number(params.lfoPitchDepth ?? 0) / 80) * 99)),
  );
  patch[143] = 3; // pitch mod sens
  patch[144] = 24; // transpose C3

  const cleanName = String(name || params.patchName || "SCDAW FM")
    .slice(0, 10)
    .padEnd(10, " ");
  for (let i = 0; i < 10; i++) {
    const code = cleanName.charCodeAt(i);
    patch[145 + i] = code >= 32 && code < 127 ? code : 32;
  }
  return patch;
}

/**
 * Encodes `tubular` synth parameters into a 163-byte DX7 single-voice `.syx` message.
 *
 * @param {object} [params={}]
 * @param {string} [name]
 * @returns {Uint8Array}
 */
export function encodeDx7SysexVoice(params = {}, name = null) {
  const patch = tubularParamsToDx7Patch(params, name);
  const out = new Uint8Array(DX7_VOICE_SIZE);
  out.set([0xf0, 0x43, 0x00, 0x00, 0x01, 0x1b], 0);
  out.set(patch, 6);
  out[6 + DX7_PATCH_SIZE] = dx7SysexChecksum(patch);
  out[DX7_VOICE_SIZE - 1] = 0xf7;
  return out;
}

/**
 * Encodes up to 32 voice parameter objects into a 4104-byte DX7 bulk `.syx` cartridge.
 *
 * @param {Array<object>} [voices=[]]
 * @returns {Uint8Array}
 */
export function encodeDx7SysexBank(voices = []) {
  const out = new Uint8Array(DX7_BANK_SIZE);
  out.set([0xf0, 0x43, 0x00, 0x09, 0x20, 0x00], 0);
  for (let i = 0; i < 32; i++) {
    const src = voices[i] || voices[0] || {};
    const patch = tubularParamsToDx7Patch(
      src.params || src,
      src.name || src.patchName,
    );
    out.set(packDx7Voice(patch), 6 + i * DX7_PACKED_SIZE);
  }
  out[6 + DX7_BANK_BODY] = dx7SysexChecksum(out.subarray(6, 6 + DX7_BANK_BODY));
  out[DX7_BANK_SIZE - 1] = 0xf7;
  return out;
}
