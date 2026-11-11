/**
 * ShadowClaw DAW — Standard MIDI File (SMF) Multi-Track Codec (scdaw-midi.js)
 *
 * Implements pure-JS zero-dependency Standard MIDI File (SMF) Format 0 and Format 1
 * encoder and decoder, fully aligned with openDAW PPQN (960 ticks per quarter note)
 * and General MIDI Channel 10 percussion conventions.
 *
 * Features:
 * - SMF Format 1 multi-track with Conductor Track (Tempo, Time Sig) and Track Names
 * - SMF Format 0 single-track merged export
 * - Delta-time Variable-Length Quantity (VLQ) encoder/decoder
 * - Note ordering: NOTE_OFF before NOTE_ON on identical ticks to prevent note choking
 * - Running status decoding and SysEx skipping
 * - Resolution scaling between arbitrary file TPQN and DAW PPQN (960)
 * - Integration with scdaw.js resolveTrackNotes() for MIDI FX and swing baking
 *
 * @license AGPL-3.0-or-later
 */

import { PPQN, createProject, resolveTrackNotes } from "./scdaw.js";

export const SMF_FORMAT_SINGLE_TRACK = 0;
export const SMF_FORMAT_MULTI_TRACK = 1;

export const SMF_MAGIC_MTHD = 0x4d546864; // 'MThd'
export const SMF_MAGIC_MTRK = 0x4d54726b; // 'MTrk'

export const META_TYPE = {
  SEQUENCE_NUMBER: 0x00,
  TEXT_EVENT: 0x01,
  COPYRIGHT_NOTICE: 0x02,
  TRACK_NAME: 0x03,
  INSTRUMENT_NAME: 0x04,
  LYRICS: 0x05,
  MARKER: 0x06,
  CUE_POINT: 0x07,
  CHANNEL_PREFIX: 0x20,
  END_OF_TRACK: 0x2f,
  SET_TEMPO: 0x51,
  SMPTE_OFFSET: 0x54,
  TIME_SIGNATURE: 0x58,
  KEY_SIGNATURE: 0x59,
  SEQUENCER_SPECIFIC: 0x7f,
};

export const CONTROL_TYPE = {
  NOTE_OFF: 0x80,
  NOTE_ON: 0x90,
  AFTERTOUCH: 0xa0,
  CONTROLLER: 0xb0,
  PROGRAM_CHANGE: 0xc0,
  CHANNEL_AFTERTOUCH: 0xd0,
  PITCH_BEND: 0xe0,
};

/**
 * Encodes an integer value as a Variable-Length Quantity (VLQ).
 * Most significant 7 bits first, with bit 7 set on all bytes except the last.
 * @param {number} value
 * @returns {Uint8Array}
 */
export function writeVarLen(value) {
  let v = Math.max(0, Math.floor(value));
  const bytes = [v & 0x7f];
  v >>>= 7;
  while (v > 0) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return new Uint8Array(bytes.reverse());
}

/**
 * Decodes a Variable-Length Quantity (VLQ) from a Uint8Array.
 * @param {Uint8Array} data
 * @param {number} offset
 * @returns {{ value: number, bytesRead: number }}
 */
export function readVarLen(data, offset = 0) {
  let value = 0;
  let bytesRead = 0;
  let byte;
  do {
    if (offset + bytesRead >= data.length) {
      throw new Error(
        "Unexpected end of data reading variable-length quantity",
      );
    }
    byte = data[offset + bytesRead];
    bytesRead++;
    value = (value << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return { value, bytesRead };
}

/**
 * Encodes text to UTF-8 bytes.
 * @param {string} str
 * @returns {Uint8Array}
 */
function encodeText(str) {
  return new TextEncoder().encode(str || "");
}

/**
 * Decodes UTF-8 bytes to text.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function decodeText(bytes) {
  return new TextDecoder().decode(bytes);
}

/**
 * Encodes a ShadowClaw project into a Standard MIDI File (SMF).
 * @param {object} project
 * @param {object} [options]
 * @param {number} [options.format=1] - 0 (single track) or 1 (multi-track)
 * @param {number} [options.division=960] - Ticks per quarter note
 * @param {boolean} [options.loops=true] - Whether to extend loops
 * @param {boolean} [options.bakeMidiFx=true] - Whether to bake arpeggiator/pitch/vel FX
 * @param {boolean} [options.bakeSwing=true] - Whether to bake 16th-note swing
 * @returns {Uint8Array}
 */
export function encodeMidiFile(project, options = {}) {
  const format =
    options.format !== undefined ? options.format : SMF_FORMAT_MULTI_TRACK;
  const division = options.division || PPQN.Quarter || 960;
  const bpm = Number(project.bpm) || 120;
  const title = project.name || project.title || "Untitled";
  const tracks = project.tracks || [];

  // Helper to append a delta-time and raw bytes to a track byte array
  class TrackWriter {
    constructor() {
      this.bytes = [];
      this.currentTick = 0;
    }

    addEvent(tick, eventBytes) {
      const delta = Math.max(0, Math.floor(tick - this.currentTick));
      const vlq = writeVarLen(delta);
      for (let i = 0; i < vlq.length; i++) this.bytes.push(vlq[i]);
      for (let i = 0; i < eventBytes.length; i++)
        this.bytes.push(eventBytes[i]);
      this.currentTick = tick;
    }

    addMeta(tick, metaType, dataBytes = []) {
      const payload = Array.isArray(dataBytes)
        ? dataBytes
        : Array.from(dataBytes);
      const lenVlq = writeVarLen(payload.length);
      const eventBytes = [0xff, metaType, ...lenVlq, ...payload];
      this.addEvent(tick, eventBytes);
    }

    endTrack(tick) {
      this.addMeta(tick, META_TYPE.END_OF_TRACK, []);
    }

    toArray() {
      return new Uint8Array(this.bytes);
    }
  }

  // Calculate microseconds per quarter note for tempo
  const usPerQuarter = Math.round(60_000_000 / bpm);
  const tempoBytes = [
    (usPerQuarter >>> 16) & 0xff,
    (usPerQuarter >>> 8) & 0xff,
    usPerQuarter & 0xff,
  ];

  // Time signature: default 4/4 (4, 2, 24, 8) -> 4 / 2^2
  const sigNum = Array.isArray(project.signature) ? project.signature[0] : 4;
  const sigDen = Array.isArray(project.signature) ? project.signature[1] : 4;
  const sigDenExp = Math.round(Math.log2(sigDen)) || 2;
  const timeSigBytes = [sigNum, sigDenExp, 24, 8];

  const trackBuffers = [];

  if (format === SMF_FORMAT_MULTI_TRACK) {
    // TRACK 0: Conductor Track
    const conductor = new TrackWriter();
    conductor.addMeta(0, META_TYPE.TRACK_NAME, encodeText(title));
    conductor.addMeta(0, META_TYPE.TIME_SIGNATURE, timeSigBytes);
    conductor.addMeta(0, META_TYPE.SET_TEMPO, tempoBytes);
    conductor.endTrack(0);
    trackBuffers.push(conductor.toArray());

    // TRACKS 1..N: Instrument Tracks
    let melChannelIndex = 0;
    tracks.forEach((track, index) => {
      const isDrums =
        track.kind === "drums" ||
        track.type === "drums" ||
        track.id === "drums" ||
        /drum/i.test(track.id) ||
        /drum/i.test(track.name);
      // MIDI Channel 10 is 0-indexed as channel 9
      let channel;
      if (isDrums) {
        channel = 9;
      } else {
        if (melChannelIndex === 9) melChannelIndex++; // skip drum channel
        channel = melChannelIndex % 16;
        melChannelIndex++;
      }

      // Collect notes using shared resolver
      const resolvedNotes = resolveTrackNotes(project, track, {
        loops: options.loops !== false,
        bakeMidiFx: options.bakeMidiFx !== false,
        bakeSwing: options.bakeSwing !== false,
      });

      // Build note events
      const events = [];
      for (const note of resolvedNotes) {
        const startTick = Math.max(0, Math.floor(note.position));
        const endTick = Math.max(
          startTick + 1,
          Math.floor(note.position + note.duration),
        );
        const pitch = Math.min(127, Math.max(0, Math.floor(note.pitch)));
        let rawVel = note.velocity ?? 0.8;
        if (typeof rawVel === "number" && rawVel <= 1.0) {
          rawVel = Math.round(rawVel * 127);
        }
        const vel = Math.min(127, Math.max(1, Math.floor(rawVel)));

        // Note On: type 1
        // Note Off: type 0 (Note Off must come first if ticks match)
        events.push({ tick: startTick, type: 1, pitch, velocity: vel });
        events.push({ tick: endTick, type: 0, pitch, velocity: 0 });
      }

      // Sort events by tick ascending, with NOTE_OFF before NOTE_ON for same tick
      events.sort((a, b) => {
        if (a.tick !== b.tick) return a.tick - b.tick;
        return a.type - b.type; // 0 (OFF) before 1 (ON)
      });

      const trackWriter = new TrackWriter();
      trackWriter.addMeta(
        0,
        META_TYPE.TRACK_NAME,
        encodeText(track.name || `Track ${index + 1}`),
      );

      if (!isDrums && track.params?.program !== undefined) {
        trackWriter.addEvent(0, [
          CONTROL_TYPE.PROGRAM_CHANGE | channel,
          Number(track.params.program) & 0x7f,
        ]);
      }

      let lastTick = 0;
      for (const ev of events) {
        if (ev.type === 1) {
          // Note On
          trackWriter.addEvent(ev.tick, [
            CONTROL_TYPE.NOTE_ON | channel,
            ev.pitch,
            ev.velocity,
          ]);
        } else {
          // Note Off
          trackWriter.addEvent(ev.tick, [
            CONTROL_TYPE.NOTE_OFF | channel,
            ev.pitch,
            0,
          ]);
        }
        lastTick = Math.max(lastTick, ev.tick);
      }

      trackWriter.endTrack(lastTick);
      trackBuffers.push(trackWriter.toArray());
    });
  } else {
    // FORMAT 0: Single Track merged
    const singleWriter = new TrackWriter();
    singleWriter.addMeta(0, META_TYPE.TRACK_NAME, encodeText(title));
    singleWriter.addMeta(0, META_TYPE.TIME_SIGNATURE, timeSigBytes);
    singleWriter.addMeta(0, META_TYPE.SET_TEMPO, tempoBytes);

    let melChannelIndex = 0;
    const allEvents = [];

    tracks.forEach((track) => {
      const isDrums = track.type === "drums" || track.id === "drums";
      let channel;
      if (isDrums) {
        channel = 9;
      } else {
        if (melChannelIndex === 9) melChannelIndex++;
        channel = melChannelIndex % 16;
        melChannelIndex++;
      }

      const resolvedNotes = resolveTrackNotes(project, track, {
        loops: options.loops !== false,
        bakeMidiFx: options.bakeMidiFx !== false,
        bakeSwing: options.bakeSwing !== false,
      });

      for (const note of resolvedNotes) {
        const startTick = Math.max(0, Math.floor(note.position));
        const endTick = Math.max(
          startTick + 1,
          Math.floor(note.position + note.duration),
        );
        const pitch = Math.min(127, Math.max(0, Math.floor(note.pitch)));
        const vel = Math.min(
          127,
          Math.max(1, Math.floor(note.velocity ?? 100)),
        );

        allEvents.push({
          tick: startTick,
          type: 1,
          channel,
          pitch,
          velocity: vel,
        });
        allEvents.push({ tick: endTick, type: 0, channel, pitch, velocity: 0 });
      }
    });

    allEvents.sort((a, b) => {
      if (a.tick !== b.tick) return a.tick - b.tick;
      return a.type - b.type;
    });

    let lastTick = 0;
    for (const ev of allEvents) {
      if (ev.type === 1) {
        singleWriter.addEvent(ev.tick, [
          CONTROL_TYPE.NOTE_ON | ev.channel,
          ev.pitch,
          ev.velocity,
        ]);
      } else {
        singleWriter.addEvent(ev.tick, [
          CONTROL_TYPE.NOTE_OFF | ev.channel,
          ev.pitch,
          0,
        ]);
      }
      lastTick = Math.max(lastTick, ev.tick);
    }

    singleWriter.endTrack(lastTick);
    trackBuffers.push(singleWriter.toArray());
  }

  // Calculate total SMF file size
  // Header: 14 bytes (4 MThd + 4 len=6 + 2 format + 2 numTracks + 2 division)
  let totalSize = 14;
  for (const tb of trackBuffers) {
    totalSize += 8 + tb.length; // 4 MTrk + 4 len + data
  }

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  // MThd Header
  view.setUint32(0, SMF_MAGIC_MTHD, false);
  view.setUint32(4, 6, false);
  view.setUint16(8, format, false);
  view.setUint16(10, trackBuffers.length, false);
  view.setUint16(12, division, false);

  let offset = 14;
  for (const tb of trackBuffers) {
    view.setUint32(offset, SMF_MAGIC_MTRK, false);
    view.setUint32(offset + 4, tb.length, false);
    out.set(tb, offset + 8);
    offset += 8 + tb.length;
  }

  return out;
}

/**
 * Decodes a Standard MIDI File (SMF) buffer into an AST.
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {object} Parsed MIDI structure
 */
export function decodeMidiFile(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 14) {
    throw new Error("Invalid MIDI file: buffer too short");
  }

  const headerMagic = view.getUint32(0, false);
  if (headerMagic !== SMF_MAGIC_MTHD) {
    throw new Error(
      `Invalid MIDI file: expected 'MThd' (0x4D546864), got 0x${headerMagic.toString(16)}`,
    );
  }

  const headerLength = view.getUint32(4, false);
  if (headerLength < 6) {
    throw new Error(`Invalid MIDI header length: ${headerLength}`);
  }

  const format = view.getUint16(8, false);
  const numTracks = view.getUint16(10, false);
  const division = view.getUint16(12, false);

  if (division & 0x8000) {
    throw new Error("SMPTE time division not currently supported");
  }

  let offset = 8 + headerLength;
  const tracks = [];
  let detectedBpm = 120;
  let detectedTimeSig = [4, 4];

  for (let t = 0; t < numTracks && offset < bytes.length; t++) {
    if (offset + 8 > bytes.length) break;

    const chunkMagic = view.getUint32(offset, false);
    const chunkLength = view.getUint32(offset + 4, false);
    offset += 8;

    if (chunkMagic !== SMF_MAGIC_MTRK) {
      // Skip unknown chunk
      offset += chunkLength;
      continue;
    }

    const chunkEnd = offset + chunkLength;
    let currentTick = 0;
    let runningStatus = 0;
    let trackName = "";
    let trackChannel = null;
    let trackProgram = null;
    let timeSignature = null;

    // Active notes map: key `${channel}:${pitch}` -> { position, velocity }
    const activeNotes = new Map();
    const notes = [];

    while (offset < chunkEnd && offset < bytes.length) {
      // 1. Read delta time
      const { value: delta, bytesRead } = readVarLen(bytes, offset);
      offset += bytesRead;
      currentTick += delta;

      if (offset >= chunkEnd) break;

      // 2. Read event status
      let status = bytes[offset];
      if (status >= 0x80) {
        runningStatus = status;
        offset++;
      } else {
        // Running status mode: status byte is implied
        if (runningStatus === 0) {
          throw new Error(
            `MIDI running status error at tick ${currentTick}, offset ${offset}`,
          );
        }
        status = runningStatus;
      }

      // 3. Process event
      if (status === 0xff) {
        // Meta event
        const metaType = bytes[offset++];
        const { value: metaLen, bytesRead: metaLenBytes } = readVarLen(
          bytes,
          offset,
        );
        offset += metaLenBytes;

        const metaData = bytes.subarray(offset, offset + metaLen);
        offset += metaLen;

        if (metaType === META_TYPE.SET_TEMPO && metaLen === 3) {
          const usPerBeat =
            (metaData[0] << 16) | (metaData[1] << 8) | metaData[2];
          if (usPerBeat > 0) {
            detectedBpm = Math.round(60_000_000 / usPerBeat);
          }
        } else if (metaType === META_TYPE.TIME_SIGNATURE && metaLen >= 2) {
          timeSignature = [metaData[0], 1 << metaData[1]];
          detectedTimeSig = timeSignature;
        } else if (
          metaType === META_TYPE.TRACK_NAME ||
          metaType === META_TYPE.TEXT_EVENT
        ) {
          trackName = decodeText(metaData);
        } else if (metaType === META_TYPE.END_OF_TRACK) {
          // End of track
          break;
        }
      } else if (status === 0xf0 || status === 0xf7) {
        // SysEx event
        const { value: sysExLen, bytesRead: sysExBytes } = readVarLen(
          bytes,
          offset,
        );
        offset += sysExBytes + sysExLen;
      } else {
        // Channel voice event
        const eventType = status & 0xf0;
        const channel = status & 0x0f;
        if (trackChannel === null) {
          trackChannel = channel;
        }

        if (
          eventType === CONTROL_TYPE.NOTE_ON ||
          eventType === CONTROL_TYPE.NOTE_OFF
        ) {
          const pitch = bytes[offset++];
          const velocity = bytes[offset++];
          const noteKey = `${channel}:${pitch}`;

          const isNoteOn = eventType === CONTROL_TYPE.NOTE_ON && velocity > 0;

          if (isNoteOn) {
            // If already active, close previous note
            if (activeNotes.has(noteKey)) {
              const prev = activeNotes.get(noteKey);
              notes.push({
                channel,
                pitch,
                position: prev.position,
                duration: Math.max(1, currentTick - prev.position),
                velocity: prev.velocity,
              });
            }
            activeNotes.set(noteKey, { position: currentTick, velocity });
          } else {
            // Note off
            if (activeNotes.has(noteKey)) {
              const start = activeNotes.get(noteKey);
              activeNotes.delete(noteKey);
              notes.push({
                channel,
                pitch,
                position: start.position,
                duration: Math.max(1, currentTick - start.position),
                velocity: start.velocity,
              });
            }
          }
        } else if (eventType === CONTROL_TYPE.PROGRAM_CHANGE) {
          trackProgram = bytes[offset++];
        } else if (eventType === CONTROL_TYPE.CHANNEL_AFTERTOUCH) {
          offset += 1;
        } else {
          // CONTROLLER, PITCH_BEND, AFTERTOUCH (2 data bytes)
          offset += 2;
        }
      }
    }

    // Flush any still-active notes
    for (const [key, start] of activeNotes.entries()) {
      const [, pitchStr] = key.split(":");
      notes.push({
        channel: trackChannel ?? 0,
        pitch: parseInt(pitchStr, 10),
        position: start.position,
        duration: Math.max(
          PPQN.SemiQuaver || 240,
          currentTick - start.position,
        ),
        velocity: start.velocity,
      });
    }

    // Sort notes by position
    notes.sort((a, b) => a.position - b.position);

    tracks.push({
      name: trackName,
      channel: trackChannel,
      program: trackProgram,
      timeSignature,
      notes,
    });

    offset = chunkEnd;
  }

  return {
    format,
    division,
    bpm: detectedBpm,
    timeSignature: detectedTimeSig,
    tracks,
  };
}

/**
 * Imports a Standard MIDI File into a ShadowClaw DAW project structure.
 * Rescales positions and durations from file TPQN to ShadowClaw PPQN (960).
 * @param {ArrayBuffer|Uint8Array} input
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string} [options.targetTrackId] - If specified, loads notes into that track only
 * @returns {object} ShadowClaw Project
 */
export function midiToProject(input, options = {}) {
  const midi = decodeMidiFile(input);
  const scale = (PPQN.Quarter || 960) / midi.division;

  // Filter out tracks with notes
  const noteTracks = midi.tracks.filter((t) => t.notes && t.notes.length > 0);

  if (noteTracks.length === 0) {
    // Return empty starter project with imported BPM
    return createProject({
      title:
        options.title ||
        midi.tracks.find((t) => t.name)?.name ||
        "Imported MIDI",
      bpm: midi.bpm,
      signature: midi.timeSignature || [4, 4],
    });
  }

  const newTracks = [];
  const usedIds = new Set();
  let drumCount = 0;
  let synthCount = 0;
  let maxPulse = 0;

  for (const mt of noteTracks) {
    const isDrums = mt.channel === 9 || /drum|percussion|beat/i.test(mt.name);
    let trackId;
    if (isDrums) {
      drumCount++;
      trackId = drumCount === 1 ? "trk_drums" : `trk_drums_${drumCount}`;
    } else {
      synthCount++;
      trackId = `trk_synth_${synthCount}`;
    }
    while (usedIds.has(trackId)) {
      trackId = `${trackId}_${Math.random().toString(36).slice(2, 6)}`;
    }
    usedIds.add(trackId);

    const scaledNotes = mt.notes.map((n) => {
      const pos = Math.round(n.position * scale);
      const dur = Math.max(60, Math.round(n.duration * scale));
      const end = pos + dur;
      if (end > maxPulse) maxPulse = end;

      let vel = typeof n.velocity === "number" ? n.velocity : 100;
      if (vel > 1.0) {
        vel = Math.min(1.0, Math.max(0.0, +(vel / 127).toFixed(3)));
      } else {
        vel = Math.min(1.0, Math.max(0.0, +vel.toFixed(3)));
      }

      return {
        position: pos,
        duration: dur,
        pitch: n.pitch,
        velocity: vel,
      };
    });

    const trackName =
      mt.name || (isDrums ? "Drums" : `Synth Track ${synthCount}`);

    const trackObj = {
      id: trackId,
      name: trackName,
      kind: isDrums ? "drums" : "synth",
      volume: 0.85,
      pan: 0,
      notes: scaledNotes,
    };

    if (!isDrums && mt.program !== null && mt.program !== undefined) {
      trackObj.instrument = "soundfont";
      trackObj.params = { program: mt.program };
    }

    newTracks.push(trackObj);
  }

  const sig = midi.timeSignature || [4, 4];
  const pulsesPerBar =
    (PPQN.Quarter || 960) * (Array.isArray(sig) ? sig[0] : 4);
  const lengthBars = Math.max(1, Math.ceil(maxPulse / pulsesPerBar));

  const projectTitle =
    options.title || midi.tracks.find((t) => t.name)?.name || "Imported MIDI";

  return createProject({
    title: projectTitle,
    bpm: midi.bpm,
    signature: sig,
    lengthBars,
    tracks: newTracks,
  });
}
