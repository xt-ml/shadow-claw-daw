// Ported concepts from openDAW packages/studio/core-wasm (AGPL-3.0, © André Michelle)
// and crates/stock-devices/device-soundfont (AGPL-3.0, © André Michelle).
/**
 * .agents/scripts/scdaw-soundfont.js
 *
 * Pure ESM SoundFont 2 (SF2) parser, zone simplifier, voice DSP, and General MIDI engine.
 * Zero external third-party dependencies.
 */

// SF2 generator IDs (spec-fixed contract, matching openDAW soundfont-simplify.ts)
export const GeneratorType = Object.freeze({
  Pan: 17,
  AttackVolEnv: 34,
  DecayVolEnv: 36,
  SustainVolEnv: 37,
  ReleaseVolEnv: 38,
  KeyRange: 43,
  VelRange: 44,
  CoarseTune: 51,
  FineTune: 52,
  SampleId: 53,
  SampleModes: 54,
  OverridingRootKey: 58,
});

// General MIDI Program Map (0-127)
export const GM_INSTRUMENTS = Object.freeze({
  // Pianos (0-7)
  "acoustic-grand": 0,
  "bright-acoustic": 1,
  "electric-grand": 2,
  "honky-tonk": 3,
  "electric-piano-1": 4,
  "electric-piano-2": 5,
  harpsichord: 6,
  clavi: 7,

  // Chromatic Percussion (8-15)
  celesta: 8,
  glockenspiel: 9,
  "music-box": 10,
  vibraphone: 11,
  marimba: 12,
  xylophone: 13,
  "tubular-bells": 14,
  dulcimer: 15,

  // Organs (16-23)
  "drawbar-organ": 16,
  "percussive-organ": 17,
  "rock-organ": 18,
  "church-organ": 19,
  "reed-organ": 20,
  accordion: 21,
  harmonica: 22,
  "tango-accordion": 23,

  // Guitars (24-31)
  "acoustic-guitar-nylon": 24,
  "acoustic-guitar-steel": 25,
  "electric-guitar-jazz": 26,
  "electric-guitar-clean": 27,
  "clean-electric-guitar": 27,
  "clean-guitar": 27,
  "electric-guitar": 27,
  guitar: 27,
  "electric-guitar-muted": 28,
  "overdriven-guitar": 29,
  "lead-guitar": 29,
  "rock-guitar": 29,
  "slide-guitar": 29,
  "distortion-guitar": 30,
  "guitar-harmonics": 31,

  // Basses (32-39)
  "acoustic-bass": 32,
  "electric-bass": 33,
  "electric-bass-finger": 33,
  "finger-bass": 33,
  bass: 33,
  "bass-guitar": 33,
  "electric-bass-pick": 34,
  "pick-bass": 34,
  "fretless-bass": 35,
  "slap-bass": 36,
  "slap-bass-1": 36,
  "slap-bass-2": 37,
  "synth-bass-1": 38,
  "synth-bass-2": 39,

  // Strings / Orchestral (40-47)
  violin: 40,
  viola: 41,
  cello: 42,
  contrabass: 43,
  "tremolo-strings": 44,
  "pizzicato-strings": 45,
  "orchestral-harp": 46,
  timpani: 47,

  // Brass (56-63)
  trumpet: 56,
  trombone: 57,
  tuba: 58,
  "muted-trumpet": 59,
  "french-horn": 60,
  "brass-section": 61,
  "synth-brass-1": 62,
  "synth-brass-2": 63,

  // Reeds (64-71)
  "soprano-sax": 64,
  "alto-sax": 65,
  "tenor-sax": 66,
  "baritone-sax": 67,
  oboe: 68,
  "english-horn": 69,
  bassoon: 70,
  clarinet: 71,
});

export const GM_DRUM_MAP = Object.freeze({
  35: "Acoustic Bass Drum",
  36: "Bass Drum 1",
  37: "Side Stick",
  38: "Acoustic Snare",
  39: "Hand Clap",
  40: "Electric Snare",
  41: "Low Floor Tom",
  42: "Closed Hi-Hat",
  43: "High Floor Tom",
  44: "Pedal Hi-Hat",
  45: "Low Tom",
  46: "Open Hi-Hat",
  47: "Low-Mid Tom",
  48: "Hi-Mid Tom",
  49: "Crash Cymbal 1",
  50: "High Tom",
  51: "Ride Cymbal 1",
  52: "Chinese Cymbal",
  53: "Ride Bell",
  54: "Tambourine",
  55: "Splash Cymbal",
  56: "Cowbell",
  57: "Crash Cymbal 2",
  58: "Vibraslap",
  59: "Ride Cymbal 2",
});

export function resolveGmProgram(nameOrNumber) {
  if (typeof nameOrNumber === "number") {
    return Math.max(0, Math.min(127, Math.floor(nameOrNumber)));
  }
  if (!nameOrNumber || typeof nameOrNumber !== "string") return 0;
  const key = nameOrNumber.toLowerCase().trim().replace(/_/g, "-");
  if (GM_INSTRUMENTS[key] !== undefined) {
    return GM_INSTRUMENTS[key];
  }
  const parsed = parseInt(nameOrNumber, 10);
  return Number.isNaN(parsed) ? 0 : Math.max(0, Math.min(127, parsed));
}

// ---------------------------------------------------------------------------
// 1. SF2 RIFF Binary Parser
// ---------------------------------------------------------------------------

function readFourCC(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readNullTerminatedString(view, offset, maxLength) {
  let str = "";
  for (let i = 0; i < maxLength; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    str += String.fromCharCode(c);
  }
  return str.trim();
}

/**
 * Parses an ArrayBuffer containing an SF2 file into the standard SoundFont2 hierarchy.
 */
export function parseSf2(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 12) {
    throw new Error("Invalid SF2 file: file too small");
  }

  const riff = readFourCC(view, 0);
  const form = readFourCC(view, 8);
  if (riff !== "RIFF" || form !== "sfbk") {
    throw new Error(
      `Invalid SF2 file: expected RIFF sfbk, found ${riff} ${form}`,
    );
  }

  let pos = 12;
  let smplInt16 = null;
  const pdtaChunks = {};

  while (pos + 8 <= view.byteLength) {
    const chunkId = readFourCC(view, pos);
    const chunkSize = view.getUint32(pos + 4, true);
    const chunkDataStart = pos + 8;
    const chunkEnd = chunkDataStart + chunkSize;

    if (chunkId === "LIST") {
      const listType = readFourCC(view, chunkDataStart);
      let subPos = chunkDataStart + 4;

      if (listType === "sdta") {
        while (subPos + 8 <= chunkEnd) {
          const subId = readFourCC(view, subPos);
          const subSize = view.getUint32(subPos + 4, true);
          if (subId === "smpl") {
            const smplByteOffset = subPos + 8;
            smplInt16 = new Int16Array(
              arrayBuffer,
              smplByteOffset,
              Math.floor(subSize / 2),
            );
          }
          subPos += 8 + subSize + (subSize % 2);
        }
      } else if (listType === "pdta") {
        while (subPos + 8 <= chunkEnd) {
          const subId = readFourCC(view, subPos);
          const subSize = view.getUint32(subPos + 4, true);
          pdtaChunks[subId] = {
            offset: subPos + 8,
            size: subSize,
          };
          subPos += 8 + subSize + (subSize % 2);
        }
      }
    }

    pos += 8 + chunkSize + (chunkSize % 2);
  }

  if (!smplInt16) {
    throw new Error("Invalid SF2: missing 'smpl' sample data in sdta chunk");
  }
  if (
    !pdtaChunks.phdr ||
    !pdtaChunks.pbag ||
    !pdtaChunks.pgen ||
    !pdtaChunks.inst ||
    !pdtaChunks.ibag ||
    !pdtaChunks.igen ||
    !pdtaChunks.shdr
  ) {
    throw new Error("Invalid SF2: missing required pdta subchunks");
  }

  // 1. Parse Sample Headers (shdr) - 46 bytes each
  const shdrChunk = pdtaChunks.shdr;
  const sampleCount = Math.floor(shdrChunk.size / 46) - 1; // last record is EOS
  const rawSamples = [];

  for (let i = 0; i < sampleCount; i++) {
    const b = shdrChunk.offset + i * 46;
    const sampleName = readNullTerminatedString(view, b, 20);
    const start = view.getUint32(b + 20, true);
    const end = view.getUint32(b + 24, true);
    const startLoop = view.getUint32(b + 28, true);
    const endLoop = view.getUint32(b + 32, true);
    const sampleRate = view.getUint32(b + 36, true);
    const originalPitch = view.getUint8(b + 40);
    const pitchCorrection = view.getInt8(b + 41);

    const safeStart = Math.min(start, smplInt16.length);
    const safeEnd = Math.min(Math.max(safeStart, end), smplInt16.length);
    const samplePcm = smplInt16.subarray(safeStart, safeEnd);

    rawSamples.push({
      data: samplePcm,
      header: {
        name: sampleName,
        sampleRate,
        startLoop: Math.max(0, startLoop - start),
        endLoop: Math.max(0, endLoop - start),
        originalPitch,
        pitchCorrection,
      },
    });
  }

  // Helper for parsing generators
  function parseGenerators(genChunk, startIndex, count) {
    const gens = {};
    for (let i = 0; i < count; i++) {
      const b = genChunk.offset + (startIndex + i) * 4;
      const genOper = view.getUint16(b, true);
      const rawVal = view.getUint16(b + 2, true);

      if (
        genOper === GeneratorType.KeyRange ||
        genOper === GeneratorType.VelRange
      ) {
        gens[genOper] = {
          range: {
            lo: rawVal & 0xff,
            hi: (rawVal >> 8) & 0xff,
          },
        };
      } else {
        const signedVal = view.getInt16(b + 2, true);
        gens[genOper] = { value: signedVal };
      }
    }
    return gens;
  }

  // 2. Parse Instruments (inst, ibag, igen)
  const instChunk = pdtaChunks.inst;
  const ibagChunk = pdtaChunks.ibag;
  const igenChunk = pdtaChunks.igen;
  const instCount = Math.floor(instChunk.size / 22) - 1; // last is EOI
  const ibagTotal = Math.floor(ibagChunk.size / 4);
  const igenTotal = Math.floor(igenChunk.size / 4);

  const parsedInstruments = [];
  for (let i = 0; i < instCount; i++) {
    const b = instChunk.offset + i * 22;
    const nextB = instChunk.offset + (i + 1) * 22;
    const name = readNullTerminatedString(view, b, 20);
    const bagStart = view.getUint16(b + 20, true);
    const bagEnd = view.getUint16(nextB + 20, true);

    const zones = [];
    for (
      let bagIdx = bagStart;
      bagIdx < bagEnd && bagIdx < ibagTotal;
      bagIdx++
    ) {
      const bagOffset = ibagChunk.offset + bagIdx * 4;
      const nextBagOffset = ibagChunk.offset + (bagIdx + 1) * 4;
      const genStart = view.getUint16(bagOffset, true);
      const genEnd =
        bagIdx + 1 < ibagTotal
          ? view.getUint16(nextBagOffset, true)
          : igenTotal;
      const genCount = Math.max(0, genEnd - genStart);

      const generators = parseGenerators(igenChunk, genStart, genCount);
      const sampleId = generators[GeneratorType.SampleId]?.value;
      const sample = sampleId !== undefined ? rawSamples[sampleId] : undefined;

      zones.push({
        generators,
        sample,
      });
    }

    parsedInstruments.push({
      name,
      zones,
    });
  }

  // 3. Parse Presets (phdr, pbag, pgen)
  const phdrChunk = pdtaChunks.phdr;
  const pbagChunk = pdtaChunks.pbag;
  const pgenChunk = pdtaChunks.pgen;
  const presetCount = Math.floor(phdrChunk.size / 38) - 1; // last is EOP
  const pbagTotal = Math.floor(pbagChunk.size / 4);
  const pgenTotal = Math.floor(pgenChunk.size / 4);

  const parsedPresets = [];
  for (let i = 0; i < presetCount; i++) {
    const b = phdrChunk.offset + i * 38;
    const nextB = phdrChunk.offset + (i + 1) * 38;
    const name = readNullTerminatedString(view, b, 20);
    const preset = view.getUint16(b + 20, true);
    const bank = view.getUint16(b + 22, true);
    const bagStart = view.getUint16(b + 24, true);
    const bagEnd = view.getUint16(nextB + 24, true);

    const zones = [];
    for (
      let bagIdx = bagStart;
      bagIdx < bagEnd && bagIdx < pbagTotal;
      bagIdx++
    ) {
      const bagOffset = pbagChunk.offset + bagIdx * 4;
      const nextBagOffset = pbagChunk.offset + (bagIdx + 1) * 4;
      const genStart = view.getUint16(bagOffset, true);
      const genEnd =
        bagIdx + 1 < pbagTotal
          ? view.getUint16(nextBagOffset, true)
          : pgenTotal;
      const genCount = Math.max(0, genEnd - genStart);

      const generators = parseGenerators(pgenChunk, genStart, genCount);
      // sfGenOper 41 is 'instrument'
      const instrumentIndex = generators[41]?.value;
      const instrument =
        instrumentIndex !== undefined
          ? parsedInstruments[instrumentIndex]
          : { zones: [] };

      zones.push({
        generators,
        instrument,
      });
    }

    parsedPresets.push({
      name,
      preset,
      bank,
      zones,
    });
  }

  return {
    samples: rawSamples,
    presets: parsedPresets,
  };
}

// ---------------------------------------------------------------------------
// 2. SF2 Simplification (Port of openDAW packages/studio/core-wasm/src/soundfont-simplify.ts)
// ---------------------------------------------------------------------------

const numeric = (zone, type) => zone?.generators?.[type]?.value;
const combined = (preset, inst, type, globalPreset = null, globalInst = null) =>
  numeric(inst, type) ??
  numeric(globalInst, type) ??
  numeric(preset, type) ??
  numeric(globalPreset, type);
const timecentsToSeconds = (value) =>
  value !== undefined ? Math.pow(2.0, value / 1200.0) : 0.005;
const rangeOf = (zone, type) =>
  zone?.generators?.[type]?.range ?? { lo: 0, hi: 127 };

export function simplifySoundfont(soundfont) {
  const samples = [];
  const sampleIndexByRef = new Map();

  const internSample = (sample) => {
    const existing = sampleIndexByRef.get(sample);
    if (existing !== undefined) return existing;

    const pcm = new Float32Array(sample.data.length);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = sample.data[i] / 32768.0;
    }
    const index = samples.length;
    samples.push({
      pcm,
      sampleRate: sample.header.sampleRate,
      loopStart: sample.header.startLoop,
      loopEnd: sample.header.endLoop,
    });
    sampleIndexByRef.set(sample, index);
    return index;
  };

  const presetsMeta = [];
  const programMap = Object.create(null);

  const presets = soundfont.presets.map((preset, idx) => {
    const bank = preset.bank ?? 0;
    const program = preset.preset ?? idx;
    presetsMeta.push({
      name: preset.name || "",
      bank,
      preset: program,
    });
    const bankKey = `${bank}:${program}`;
    if (programMap[bankKey] === undefined) {
      programMap[bankKey] = idx;
    }

    const regions = [];
    const presetZones = preset.zones || [];
    const globalPresetZone =
      presetZones.length > 1 &&
      presetZones[0]?.generators?.[41] === undefined &&
      !presetZones[0]?.instrument?.zones?.length
        ? presetZones[0]
        : null;

    for (const presetZone of presetZones) {
      if (presetZone === globalPresetZone) continue;
      const presetKey = presetZone.generators?.[GeneratorType.KeyRange]
        ?.range ??
        globalPresetZone?.generators?.[GeneratorType.KeyRange]?.range ?? {
          lo: 0,
          hi: 127,
        };
      const presetVel = presetZone.generators?.[GeneratorType.VelRange]
        ?.range ??
        globalPresetZone?.generators?.[GeneratorType.VelRange]?.range ?? {
          lo: 0,
          hi: 127,
        };

      const instZones = presetZone.instrument?.zones || [];
      const globalInstZone =
        instZones.length > 1 &&
        instZones[0]?.generators?.[GeneratorType.SampleId] === undefined &&
        !instZones[0]?.sample
          ? instZones[0]
          : null;

      for (const instZone of instZones) {
        if (instZone === globalInstZone) continue;
        const instKey = instZone.generators?.[GeneratorType.KeyRange]?.range ??
          globalInstZone?.generators?.[GeneratorType.KeyRange]?.range ?? {
            lo: 0,
            hi: 127,
          };
        const instVel = instZone.generators?.[GeneratorType.VelRange]?.range ??
          globalInstZone?.generators?.[GeneratorType.VelRange]?.range ?? {
            lo: 0,
            hi: 127,
          };

        // Intersection of preset and instrument key/vel ranges
        const keyLo = Math.max(presetKey.lo, instKey.lo);
        const keyHi = Math.min(presetKey.hi, instKey.hi);
        const velLo = Math.max(presetVel.lo, instVel.lo);
        const velHi = Math.min(presetVel.hi, instVel.hi);

        if (keyLo > keyHi || velLo > velHi) continue; // Unreachable zone

        const sample =
          instZone.sample ??
          soundfont.samples[numeric(instZone, GeneratorType.SampleId) ?? 0];
        if (!sample) continue;

        const sampleIndex = internSample(sample);
        const rootKey =
          numeric(instZone, GeneratorType.OverridingRootKey) ??
          numeric(globalInstZone, GeneratorType.OverridingRootKey) ??
          sample.header.originalPitch ??
          60;
        const sampleModes =
          combined(
            presetZone,
            instZone,
            GeneratorType.SampleModes,
            globalPresetZone,
            globalInstZone,
          ) ?? 0;
        const sustain = combined(
          presetZone,
          instZone,
          GeneratorType.SustainVolEnv,
          globalPresetZone,
          globalInstZone,
        );
        const coarseTune =
          combined(
            presetZone,
            instZone,
            GeneratorType.CoarseTune,
            globalPresetZone,
            globalInstZone,
          ) ?? 0;
        const fineTune =
          combined(
            presetZone,
            instZone,
            GeneratorType.FineTune,
            globalPresetZone,
            globalInstZone,
          ) ?? 0;
        const pitchCorrection = sample.header?.pitchCorrection ?? 0;
        const tuningSemis =
          (coarseTune * 100 + fineTune + pitchCorrection) / 100;

        regions.push({
          keyLo,
          keyHi,
          velLo,
          velHi,
          sampleIndex,
          rootKey,
          tuningSemis,
          loopMode: sampleModes === 1 || sampleModes === 3 ? 1 : 0,
          pan:
            (combined(
              presetZone,
              instZone,
              GeneratorType.Pan,
              globalPresetZone,
              globalInstZone,
            ) ?? 0) / 1000.0,
          attack: timecentsToSeconds(
            combined(
              presetZone,
              instZone,
              GeneratorType.AttackVolEnv,
              globalPresetZone,
              globalInstZone,
            ),
          ),
          decay: timecentsToSeconds(
            combined(
              presetZone,
              instZone,
              GeneratorType.DecayVolEnv,
              globalPresetZone,
              globalInstZone,
            ),
          ),
          sustain: 1.0 - (sustain ?? 0.0) / 1000.0,
          release: timecentsToSeconds(
            combined(
              presetZone,
              instZone,
              GeneratorType.ReleaseVolEnv,
              globalPresetZone,
              globalInstZone,
            ),
          ),
        });
      }
    }
    return regions;
  });

  return {
    samples,
    presets,
    presetsMeta,
    programMap,
  };
}

export function findPresetIndex(simpleSoundfont, program = 0, bank = 0) {
  if (!simpleSoundfont || !Array.isArray(simpleSoundfont.presets)) return 0;
  const maxIdx = Math.max(0, simpleSoundfont.presets.length - 1);
  if (simpleSoundfont.programMap) {
    const exact = simpleSoundfont.programMap[`${bank}:${program}`];
    if (typeof exact === "number") return exact;
    if (bank !== 0) {
      const bank0 = simpleSoundfont.programMap[`0:${program}`];
      if (typeof bank0 === "number") return bank0;
    }
    // Fall back to first program in requested bank if specific program missing
    const meta = simpleSoundfont.presetsMeta;
    if (Array.isArray(meta)) {
      const sameBank = meta.findIndex((p) => p.bank === bank);
      if (sameBank !== -1) return sameBank;
    }
  }
  return Math.max(0, Math.min(program, maxIdx));
}

// ---------------------------------------------------------------------------
// 3. Voice DSP (Port of openDAW crates/stock-devices/device-soundfont/src/voice.rs)
// ---------------------------------------------------------------------------

const SILENCE_THRESHOLD = 1.0e-4;
const SMOOTH_SECONDS = 0.003;

export const AdsrStage = Object.freeze({
  Idle: 0,
  Attack: 1,
  Decay: 2,
  Sustain: 3,
  Release: 4,
});

export class Adsr {
  constructor(sampleRate = 44100) {
    this.stage = AdsrStage.Idle;
    this.value = 0.0;
    this.invSampleRate = 1.0 / sampleRate;
    this.attack = 0.005;
    this.decay = 0.005;
    this.sustain = 1.0;
    this.release = 0.005;
    this.attackInc = 0.0;
    this.decayDec = 0.0;
    this.releaseDec = 0.0;
  }

  set(attack, decay, sustain, release) {
    this.attack = attack;
    this.decay = decay;
    this.sustain = sustain;
    this.release = release;
    this.updateRates();
  }

  updateRates() {
    const inv = this.invSampleRate;
    switch (this.stage) {
      case AdsrStage.Attack:
        this.attackInc =
          ((1.0 - this.value) * inv) / Math.max(1.0e-6, this.attack);
        break;
      case AdsrStage.Decay:
        this.decayDec =
          ((this.value - this.sustain) * inv) / Math.max(1.0e-6, this.decay);
        break;
      case AdsrStage.Release:
        this.releaseDec = (this.value * inv) / Math.max(1.0e-6, this.release);
        break;
      default:
        this.attackInc = inv / Math.max(1.0e-6, this.attack);
        this.decayDec =
          ((1.0 - this.sustain) * inv) / Math.max(1.0e-6, this.decay);
        this.releaseDec = (this.sustain * inv) / Math.max(1.0e-6, this.release);
        break;
    }
  }

  gateOn() {
    this.stage = AdsrStage.Attack;
    this.updateRates();
  }

  gateOff() {
    if (this.stage !== AdsrStage.Idle) {
      this.stage = AdsrStage.Release;
      this.updateRates();
    }
  }

  complete() {
    return this.stage === AdsrStage.Idle;
  }

  next() {
    switch (this.stage) {
      case AdsrStage.Attack:
        this.value += this.attackInc;
        if (this.value >= 1.0) {
          this.value = 1.0;
          this.stage = AdsrStage.Decay;
          this.updateRates();
        }
        return this.value;
      case AdsrStage.Decay:
        this.value -= this.decayDec;
        if (this.value <= this.sustain) {
          this.value = this.sustain;
          this.stage = AdsrStage.Sustain;
        }
        return this.value;
      case AdsrStage.Sustain:
        return this.sustain;
      case AdsrStage.Release:
        this.value -= this.releaseDec;
        if (this.value <= 0.0) {
          this.value = 0.0;
          this.stage = AdsrStage.Idle;
        }
        return this.value;
      case AdsrStage.Idle:
      default:
        return 0.0;
    }
  }
}

export class Smooth {
  constructor(time = SMOOTH_SECONDS, sampleRate = 44100) {
    this.coeff = 1.0 - Math.exp(-1.0 / (time * sampleRate));
    this.val = 0.0;
  }

  process(target) {
    this.val += this.coeff * (target - this.val);
    return this.val;
  }

  value() {
    return this.val;
  }
}

export class SoundfontVoice {
  constructor() {
    this.active = false;
    this.id = 0;
    this.sampleIndex = 0;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.looping = false;
    this.position = 0.0;
    this.playbackRate = 1.0;
    this.gain = 1.0;
    this.panLeft = 0.7071;
    this.panRight = 0.7071;
    this.adsr = new Adsr(44100);
    this.smooth = new Smooth(SMOOTH_SECONDS, 44100);
  }

  isActive() {
    return this.active;
  }

  start(
    id,
    pitch,
    cent = 0,
    velocity = 0.8,
    region,
    sample,
    sampleRate = 44100,
  ) {
    this.active = true;
    this.id = id;
    this.sampleIndex = region.sampleIndex;
    this.loopStart = sample.loopStart;
    this.loopEnd = sample.loopEnd;
    this.looping = region.loopMode !== 0;
    this.position = 0.0;

    const semis = pitch + cent / 100.0 - region.rootKey;
    const pitchRatio = Math.pow(2.0, semis / 12.0);
    this.playbackRate = pitchRatio * (sample.sampleRate / sampleRate);
    this.gain = Math.max(0.0, velocity);

    const panAngle = (region.pan + 1.0) * (Math.PI / 4.0);
    this.panLeft = Math.cos(panAngle);
    this.panRight = Math.sin(panAngle);

    this.adsr = new Adsr(sampleRate);
    this.adsr.set(region.attack, region.decay, region.sustain, region.release);
    this.adsr.gateOn();
    this.smooth = new Smooth(SMOOTH_SECONDS, sampleRate);
  }

  release() {
    this.adsr.gateOff();
  }

  forceStop() {
    this.active = false;
  }

  process(outLeft, outRight, pcm) {
    const frameCount = pcm.length;
    if (frameCount === 0) return true;

    const last = frameCount - 1;
    const loopStart = this.loopStart;
    const loopEnd = this.loopEnd;
    const blockSize = outLeft.length;

    for (let i = 0; i < blockSize; i++) {
      const intPos = Math.floor(this.position);
      let sampleVal;
      if (intPos >= last) {
        sampleVal = pcm[last];
      } else {
        const frac = this.position - intPos;
        sampleVal = pcm[intPos] * (1.0 - frac) + pcm[intPos + 1] * frac;
      }

      const env = this.adsr.next();
      const amp = sampleVal * this.gain * this.smooth.process(env);
      outLeft[i] += amp * this.panLeft;
      outRight[i] += amp * this.panRight;

      this.position += this.playbackRate;

      if (this.looping) {
        if (this.position >= loopEnd && loopEnd > loopStart) {
          this.position = loopStart + (this.position - loopEnd);
        }
      } else if (this.position >= last) {
        this.active = false;
        return true;
      }
    }

    if (this.adsr.complete() && this.smooth.value() < SILENCE_THRESHOLD) {
      this.active = false;
      return true;
    }

    return false;
  }
}

// ---------------------------------------------------------------------------
// 4. Region Finder & Offline Voice Renderer
// ---------------------------------------------------------------------------

export function findRegionForNote(
  simpleSoundfont,
  presetIndex = 0,
  key = 60,
  velocity = 100,
) {
  const regions = simpleSoundfont.presets[presetIndex];
  if (!regions || regions.length === 0) return null;

  for (const r of regions) {
    if (
      key >= r.keyLo &&
      key <= r.keyHi &&
      velocity >= r.velLo &&
      velocity <= r.velHi
    ) {
      return r;
    }
  }
  // Fallback to first region if note is outside bounds
  return regions[0];
}

export function renderSoundfontVoice(
  region,
  sample,
  pitch,
  velocity,
  durationSec,
  sampleRate = 44100,
) {
  const totalFrames = Math.ceil(
    Math.max(0.05, durationSec + region.release + 0.05) * sampleRate,
  );
  const outLeft = new Float32Array(totalFrames);
  const outRight = new Float32Array(totalFrames);

  const voice = new SoundfontVoice();
  voice.start(1, pitch, 0, velocity, region, sample, sampleRate);

  const noteFrames = Math.floor(durationSec * sampleRate);
  const blockSize = 128;
  let cursor = 0;

  while (cursor < totalFrames) {
    const chunk = Math.min(blockSize, totalFrames - cursor);
    if (cursor >= noteFrames) {
      voice.release();
    }
    const blockL = outLeft.subarray(cursor, cursor + chunk);
    const blockR = outRight.subarray(cursor, cursor + chunk);
    const finished = voice.process(blockL, blockR, sample.pcm);
    cursor += chunk;
    if (finished) break;
  }

  return { left: outLeft, right: outRight };
}

// ---------------------------------------------------------------------------
// 5. SoundFont Web Audio Graph & Sample Cache Integration
// ---------------------------------------------------------------------------

const bufferCache = new WeakMap();
const activeSoundfonts = new Map();

export function registerSoundfont(name, simpleSoundfont) {
  activeSoundfonts.set(name, simpleSoundfont);
}

export function getSoundfont(name = "default") {
  if (name === "drums") {
    return activeSoundfonts.get("drums") || null;
  }
  return activeSoundfonts.get(name) || activeSoundfonts.get("default") || null;
}

export function getOrCreateAudioBuffer(ctx, sample) {
  if (
    !ctx ||
    typeof ctx.createBuffer !== "function" ||
    !sample ||
    !sample.pcm
  ) {
    return null;
  }
  let ctxMap = bufferCache.get(ctx);
  if (!ctxMap) {
    ctxMap = new Map();
    bufferCache.set(ctx, ctxMap);
  }
  let audioBuf = ctxMap.get(sample);
  if (audioBuf) return audioBuf;

  const pcm = sample.pcm;
  audioBuf = ctx.createBuffer(1, pcm.length, sample.sampleRate || 44100);
  try {
    if (typeof audioBuf.copyToChannel === "function") {
      audioBuf.copyToChannel(pcm, 0);
    } else if (typeof audioBuf.getChannelData === "function") {
      const channel = audioBuf.getChannelData(0);
      if (channel && typeof channel.set === "function") {
        channel.set(pcm);
      }
    }
  } catch (_) {}
  ctxMap.set(sample, audioBuf);
  return audioBuf;
}

export function ensureBundledSoundfontLoaded(type = "drums") {
  if (activeSoundfonts.has(type)) return activeSoundfonts.get(type);

  const filename = type === "drums" ? "A320U_drums.sf2" : "gm-lofi.sf2";

  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      // Synchronous filesystem loading in Node.js via process.getBuiltinModule
      const getModule = (name) => {
        if (typeof process.getBuiltinModule === "function") {
          return process.getBuiltinModule(name);
        }
        if (typeof globalThis.require === "function") {
          return globalThis.require(name);
        }
        return null;
      };
      const fs = getModule("node:fs");
      const path = getModule("node:path");
      if (fs && path) {
        const candidates = [
          path.resolve(
            process.cwd(),
            "pages/resources/assets/soundfonts",
            filename,
          ),
          path.resolve(
            "/packages/xt-ml/shadow-claw-daw/pages/resources/assets/soundfonts",
            filename,
          ),
          path.resolve(
            process.cwd(),
            "pages/resources/assets/soundfonts/A320U.sf2",
          ),
          path.resolve(
            "/packages/xt-ml/shadow-claw-daw/pages/resources/assets/soundfonts/A320U.sf2",
          ),
        ];
        for (const p of candidates) {
          if (fs.existsSync(p)) {
            const buf = fs.readFileSync(p).buffer;
            const parsed = parseSf2(buf);
            const simple = simplifySoundfont(parsed);
            activeSoundfonts.set(type, simple);
            if (type === "gm" || type === "lofi") {
              activeSoundfonts.set("default", simple);
            }
            return simple;
          }
        }
      }
    } catch (_) {}
  }
  return null;
}

export async function loadBundledSoundfontAsync(type = "drums") {
  if (activeSoundfonts.has(type)) return activeSoundfonts.get(type);

  const filename = type === "drums" ? "A320U_drums.sf2" : "gm-lofi.sf2";

  const syncLoaded = ensureBundledSoundfontLoaded(type);
  if (syncLoaded) return syncLoaded;

  if (typeof fetch === "function") {
    const urls = [
      `assets/soundfonts/${filename}`,
      `../assets/soundfonts/${filename}`,
      `/assets/soundfonts/${filename}`,
      `pages/resources/assets/soundfonts/${filename}`,
      `/pages/resources/assets/soundfonts/${filename}`,
    ];
    for (const url of urls) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          const parsed = parseSf2(buf);
          const simple = simplifySoundfont(parsed);
          activeSoundfonts.set(type, simple);
          if (type === "gm" || type === "lofi") {
            activeSoundfonts.set("default", simple);
          }
          return simple;
        }
      } catch (_) {}
    }
  }
  return null;
}

export function createSoundfontVoiceHandle(
  nodesToDisconnect = [],
  sourcesToStop = [],
  stopTime = 0,
  ctx = null,
) {
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const node of nodesToDisconnect) {
      try {
        if (typeof node?.disconnect === "function") node.disconnect();
      } catch (_) {}
    }
    if (typeof voice.onended === "function") {
      voice.onended();
    }
  };

  const primarySource = sourcesToStop[0];
  if (primarySource) {
    primarySource.onended = cleanup;
  }
  const delayMs = Math.max(
    50,
    Math.round((stopTime - (ctx?.currentTime || 0)) * 1000 + 100),
  );
  const safetyTimeout = setTimeout(cleanup, delayMs);

  const voice = {
    stop: (t = 0) => {
      clearTimeout(safetyTimeout);
      for (const src of sourcesToStop) {
        try {
          if (typeof src?.stop === "function") src.stop(t);
        } catch (_) {}
      }
      cleanup();
    },
    disconnect: () => {
      clearTimeout(safetyTimeout);
      cleanup();
    },
    onended: null,
  };
  return voice;
}

export function triggerDrumSoundfont(
  ctx,
  dest,
  note,
  when,
  trackVolume = 1,
  trackPan = 0,
) {
  const pitch = note.pitch ?? 36;
  const velocity = Math.max(
    0.01,
    Math.min(1.0, (note.velocity ?? 0.8) * trackVolume),
  );

  const sf = getSoundfont("drums") || ensureBundledSoundfontLoaded("drums");
  if (!sf || !sf.presets || sf.presets.length === 0) return null;

  const drumPresetIndex = findPresetIndex(sf, 0, 128);
  const region = findRegionForNote(
    sf,
    drumPresetIndex,
    pitch,
    Math.round(velocity * 127),
  );
  if (!region) return null;

  const sample = sf.samples[region.sampleIndex];
  if (!sample) return null;

  const audioBuf = getOrCreateAudioBuffer(ctx, sample);
  if (!audioBuf) return null;

  const src = ctx.createBufferSource();
  src.buffer = audioBuf;

  // Drum/percussion samples in GM kits are fixed-pitch per key and play at 1:1 speed.
  // AudioBuffer.sampleRate already tells Web Audio the sample rate, so playbackRate stays 1.0.
  const pitchRatio = 1.0;
  src.playbackRate.setValueAtTime(pitchRatio, when);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(velocity, when);

  let panNode = null;
  const effectivePan = Math.max(-1, Math.min(1, (region.pan || 0) + trackPan));
  if (typeof ctx.createStereoPanner === "function" && effectivePan !== 0) {
    panNode = ctx.createStereoPanner();
    panNode.pan.setValueAtTime(effectivePan, when);
  }

  if (panNode) {
    src.connect(gain);
    gain.connect(panNode);
    panNode.connect(dest);
  } else {
    src.connect(gain);
    gain.connect(dest);
  }

  src.start(when);
  const duration =
    sample.pcm.length / (sample.sampleRate || 44100) / pitchRatio;
  const stopTime = when + Math.min(duration, 3.0);
  try {
    src.stop(stopTime);
  } catch (_) {}

  return createSoundfontVoiceHandle(
    [gain, panNode].filter(Boolean),
    [src],
    stopTime,
    ctx,
  );
}

export function triggerSoundfontNote(
  ctx,
  dest,
  note,
  when,
  params = {},
  bpm = 120,
  trackVolume = 1,
  trackPan = 0,
) {
  const pitch = note.pitch ?? 60;
  const velocity = Math.max(
    0.01,
    Math.min(1.0, (note.velocity ?? 0.8) * trackVolume),
  );
  const durationSec = Math.max(
    0.05,
    ((note.duration ?? 240) / 960) * (60 / bpm),
  );

  const sf =
    getSoundfont("gm") ||
    getSoundfont("default") ||
    ensureBundledSoundfontLoaded("gm");
  if (!sf || !sf.presets || sf.presets.length === 0) return null;

  let program = 0;
  if (params.program !== undefined) {
    program = Number(params.program);
  } else if (params.instrument) {
    program = resolveGmProgram(params.instrument);
  }

  // Resolve preset by MIDI bank & program number (not raw preset array index)
  const presetIndex = findPresetIndex(sf, program, params.bank ?? 0);
  const region = findRegionForNote(
    sf,
    presetIndex,
    pitch,
    Math.round(velocity * 127),
  );
  if (!region) return null;

  const sample = sf.samples[region.sampleIndex];
  if (!sample) return null;

  const audioBuf = getOrCreateAudioBuffer(ctx, sample);
  if (!audioBuf) return null;

  const src = ctx.createBufferSource();
  src.buffer = audioBuf;

  const sampleSr = sample.sampleRate || 44100;
  const loopStart = region.loopStart ?? sample.loopStart ?? 0;
  const loopEnd = region.loopEnd ?? sample.loopEnd ?? 0;
  src.loop = region.loopMode !== 0 && loopEnd > loopStart;
  if (src.loop) {
    src.loopStart = loopStart / sampleSr;
    src.loopEnd = loopEnd / sampleSr;
  }

  // AudioBuffer.sampleRate already handles sample-rate conversion to ctx.sampleRate;
  // playbackRate only applies semitone/cent pitch transposition relative to rootKey.
  const semis = pitch - region.rootKey + (region.tuningSemis || 0);
  const pitchRatio = Math.pow(2.0, semis / 12.0);
  src.playbackRate.setValueAtTime(pitchRatio, when);

  const gain = ctx.createGain();
  const attack = Math.max(0.001, region.attack);
  const decay = Math.max(0.005, region.decay);
  const sustainLevel =
    Math.max(0.0001, Math.min(1.0, region.sustain)) * velocity;
  const release = Math.max(0.01, region.release);

  const attackEnd = when + attack;
  const decayEnd = attackEnd + decay;
  const releaseStart = when + durationSec;

  gain.gain.setValueAtTime(0.0001, when);
  if (releaseStart <= attackEnd) {
    const frac = Math.max(0, Math.min(1, durationSec / attack));
    const releaseLevel = Math.max(0.0001, 0.0001 + (velocity - 0.0001) * frac);
    gain.gain.linearRampToValueAtTime(releaseLevel, releaseStart);
    gain.gain.linearRampToValueAtTime(0.0001, releaseStart + release);
  } else if (releaseStart < decayEnd) {
    gain.gain.linearRampToValueAtTime(velocity, attackEnd);
    const frac = Math.max(0, Math.min(1, (releaseStart - attackEnd) / decay));
    const releaseLevel = Math.max(
      0.0001,
      velocity + (sustainLevel - velocity) * frac,
    );
    gain.gain.linearRampToValueAtTime(releaseLevel, releaseStart);
    gain.gain.linearRampToValueAtTime(0.0001, releaseStart + release);
  } else {
    gain.gain.linearRampToValueAtTime(velocity, attackEnd);
    gain.gain.linearRampToValueAtTime(sustainLevel, decayEnd);
    gain.gain.setValueAtTime(sustainLevel, releaseStart);
    gain.gain.linearRampToValueAtTime(0.0001, releaseStart + release);
  }

  let panNode = null;
  const panVal = Math.max(-1, Math.min(1, (region.pan || 0) + trackPan));
  if (typeof ctx.createStereoPanner === "function" && panVal !== 0) {
    panNode = ctx.createStereoPanner();
    panNode.pan.setValueAtTime(panVal, when);
  }

  if (panNode) {
    src.connect(gain);
    gain.connect(panNode);
    panNode.connect(dest);
  } else {
    src.connect(gain);
    gain.connect(dest);
  }

  src.start(when);
  const stopTime = releaseStart + release + 0.05;
  try {
    src.stop(stopTime);
  } catch (_) {}

  return createSoundfontVoiceHandle(
    [gain, panNode].filter(Boolean),
    [src],
    stopTime,
    ctx,
  );
}
