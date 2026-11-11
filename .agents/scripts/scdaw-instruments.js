// Ported from openDAW packages/lib/dsp/src/adsr.ts @10088021 (AGPL-3.0-or-later, © André Michelle)
/**
 * .agents/scripts/scdaw-instruments.js
 *
 * Procedural synthesizers (Vaporisateur dual-oscillator + sub + filter ADSR),
 * Playfield 12-piece drum synthesizer, and sample playback engine.
 * Context-agnostic: operates identically with AudioContext & OfflineAudioContext.
 */

import { pulsesToSeconds } from "./scdaw.js";
import {
  triggerDrumSoundfont,
  triggerSoundfontNote,
} from "./scdaw-soundfont.js";

// Global cache for preloaded sample audio buffers (decoded via ctx.decodeAudioData)
const sampleCache = new Map();

export function setCachedSample(pitch, audioBuffer) {
  sampleCache.set(pitch, audioBuffer);
}

export function getCachedSample(pitch) {
  return sampleCache.get(pitch);
}

// Global cache for loaded SoundFont binary buffers (.sf2 / .sf3)
const soundfontCache = new Map();

export function setCachedSoundfont(name, arrayBuffer) {
  soundfontCache.set(name, arrayBuffer);
}

export function getCachedSoundfont(name) {
  return soundfontCache.get(name);
}

export function clearSoundfontCache() {
  soundfontCache.clear();
}

function createNoiseBuffer(ctx, durationSec = 0.5) {
  const sampleRate = ctx.sampleRate || 44100;
  const numFrames = Math.floor(sampleRate * durationSec);
  const buffer = ctx.createBuffer(1, numFrames, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < numFrames; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export function createVoiceHandle(
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

export function triggerDrums(
  ctx,
  dest,
  note,
  when,
  trackVolume = 1,
  trackPan = 0,
  params = {},
) {
  const pitch = note.pitch ?? 36;
  const velocity = Math.max(
    0.01,
    Math.min(1, (note.velocity ?? 0.8) * trackVolume),
  );

  // If a decoded sample exists for this pitch, play it with preference
  const cachedBuffer = sampleCache.get(pitch);
  if (cachedBuffer) {
    const src = ctx.createBufferSource();
    src.buffer = cachedBuffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(velocity, when);
    src.connect(gain);
    gain.connect(dest);
    src.start(when);
    const stopTime = when + (cachedBuffer.duration || 1);
    try {
      src.stop(stopTime);
    } catch (_) {}
    return createVoiceHandle([gain], [src], stopTime, ctx);
  }

  // If explicitly configured for SoundFont drum kit samples, use triggerDrumSoundfont
  if (
    params?.kit === "soundfont" ||
    params?.kit === "rock-kit" ||
    params?.kit === "acoustic" ||
    params?.source === "soundfont" ||
    params?.instrument === "soundfont"
  ) {
    const sfDrumVoice = triggerDrumSoundfont(
      ctx,
      dest,
      note,
      when,
      trackVolume,
      trackPan,
    );
    if (sfDrumVoice) {
      return sfDrumVoice;
    }
  }

  // Pure Web Audio procedural synthesizers for drums (Playfield 12-Drum kit)
  switch (pitch) {
    case 36: {
      // 36: Kick drum - pitch-dropped sine wave + snappy transient
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";

      osc.frequency.setValueAtTime(160, when);
      osc.frequency.exponentialRampToValueAtTime(36, when + 0.08);

      gain.gain.setValueAtTime(velocity, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.28);

      osc.connect(gain);
      gain.connect(dest);
      osc.start(when);
      osc.stop(when + 0.29);
      return createVoiceHandle([gain], [osc], when + 0.29, ctx);
    }

    case 37: {
      // 37: Side stick / Rimshot - high resonant wooden click
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(450, when);
      osc.frequency.exponentialRampToValueAtTime(200, when + 0.02);

      gain.gain.setValueAtTime(velocity * 0.9, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.04);

      osc.connect(gain);
      gain.connect(dest);
      osc.start(when);
      osc.stop(when + 0.05);
      return createVoiceHandle([gain], [osc], when + 0.05, ctx);
    }

    case 38: {
      // 38: Snare drum - tone oscillator + filtered noise burst
      const toneOsc = ctx.createOscillator();
      const toneGain = ctx.createGain();
      toneOsc.type = "sine";
      toneOsc.frequency.setValueAtTime(185, when);
      toneOsc.frequency.exponentialRampToValueAtTime(80, when + 0.06);

      toneGain.gain.setValueAtTime(velocity * 0.65, when);
      toneGain.gain.exponentialRampToValueAtTime(0.001, when + 0.12);

      toneOsc.connect(toneGain);
      toneGain.connect(dest);
      toneOsc.start(when);
      toneOsc.stop(when + 0.13);

      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, 0.2);
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.setValueAtTime(1200, when);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(velocity * 0.85, when);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, when + 0.18);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(dest);
      noise.start(when);
      noise.stop(when + 0.19);
      return createVoiceHandle(
        [toneGain, filter, noiseGain],
        [toneOsc, noise],
        when + 0.19,
        ctx,
      );
    }

    case 39: {
      // 39: Hand Clap - 3 rapid micro-bursts of noise followed by decay
      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, 0.3);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1100, when);
      filter.Q.setValueAtTime(2.5, when);

      const gain = ctx.createGain();
      const v = velocity * 0.7;
      gain.gain.setValueAtTime(0, when);
      gain.gain.setValueAtTime(v, when + 0.001);
      gain.gain.setValueAtTime(v * 0.2, when + 0.012);
      gain.gain.setValueAtTime(v * 0.9, when + 0.014);
      gain.gain.setValueAtTime(v * 0.2, when + 0.024);
      gain.gain.setValueAtTime(v, when + 0.026);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.22);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      noise.start(when);
      noise.stop(when + 0.23);
      return createVoiceHandle([filter, gain], [noise], when + 0.23, ctx);
    }

    case 41:
    case 45:
    case 48: {
      // 41: Low Tom, 45: Mid Tom, 48: High Tom
      const startFreq = pitch === 41 ? 130 : pitch === 45 ? 175 : 220;
      const endFreq = pitch === 41 ? 55 : pitch === 45 ? 80 : 100;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(startFreq, when);
      osc.frequency.exponentialRampToValueAtTime(endFreq, when + 0.25);

      gain.gain.setValueAtTime(velocity * 0.85, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.32);

      osc.connect(gain);
      gain.connect(dest);
      osc.start(when);
      osc.stop(when + 0.33);
      return createVoiceHandle([gain], [osc], when + 0.33, ctx);
    }

    case 42:
    case 46: {
      // 42: Closed Hi-hat, 46: Open Hi-hat
      const isOpen = pitch === 46;
      const decayTime = isOpen ? 0.38 : 0.055;

      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, decayTime + 0.05);

      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.setValueAtTime(isOpen ? 6500 : 7800, when);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(velocity * 0.65, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + decayTime);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      noise.start(when);
      noise.stop(when + decayTime + 0.01);
      return createVoiceHandle(
        [filter, gain],
        [noise],
        when + decayTime + 0.01,
        ctx,
      );
    }

    case 49: {
      // 49: Crash Cymbal - long sizzling noise + highpass
      const decayTime = 1.2;
      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, decayTime + 0.1);

      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.setValueAtTime(5000, when);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(velocity * 0.7, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + decayTime);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      noise.start(when);
      noise.stop(when + decayTime + 0.05);
      return createVoiceHandle(
        [filter, gain],
        [noise],
        when + decayTime + 0.05,
        ctx,
      );
    }

    case 51: {
      // 51: Ride Cymbal - metallic ping + sizzle
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(580, when);
      oscGain.gain.setValueAtTime(velocity * 0.4, when);
      oscGain.gain.exponentialRampToValueAtTime(0.001, when + 0.4);

      osc.connect(oscGain);
      oscGain.connect(dest);
      osc.start(when);
      osc.stop(when + 0.45);

      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, 0.6);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(8000, when);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(velocity * 0.45, when);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, when + 0.55);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(dest);
      noise.start(when);
      noise.stop(when + 0.6);
      return createVoiceHandle(
        [oscGain, filter, noiseGain],
        [osc, noise],
        when + 0.6,
        ctx,
      );
    }

    case 54:
    case 56: {
      // 54: Shaker / Tambourine, 56: Cowbell
      if (pitch === 56) {
        // Cowbell: two resonant metallic squares ~580Hz and ~840Hz
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.type = "square";
        osc2.type = "square";
        osc1.frequency.setValueAtTime(580, when);
        osc2.frequency.setValueAtTime(840, when);

        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(750, when);
        filter.Q.setValueAtTime(4.0, when);

        gain.gain.setValueAtTime(velocity * 0.5, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + 0.2);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(dest);

        osc1.start(when);
        osc2.start(when);
        osc1.stop(when + 0.22);
        osc2.stop(when + 0.22);
        return createVoiceHandle(
          [filter, gain],
          [osc1, osc2],
          when + 0.22,
          ctx,
        );
      }
      // Shaker
      const noise = ctx.createBufferSource();
      noise.buffer = createNoiseBuffer(ctx, 0.08);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(6000, when);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(velocity * 0.5, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.07);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      noise.start(when);
      noise.stop(when + 0.08);
      return createVoiceHandle([filter, gain], [noise], when + 0.08, ctx);
    }

    default: {
      // Generic percussion tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      const freq = 440 * Math.pow(2, (pitch - 69) / 12);
      osc.frequency.setValueAtTime(freq, when);
      gain.gain.setValueAtTime(velocity * 0.7, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.15);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(when);
      osc.stop(when + 0.16);
      return createVoiceHandle([gain], [osc], when + 0.16, ctx);
    }
  }
}

function getPulseWave(ctx, pulseWidth = 0.5) {
  const d = Math.max(0.05, Math.min(0.95, Number(pulseWidth || 0.5)));
  const nHarmonics = 64;
  const real = new Float32Array(nHarmonics);
  const imag = new Float32Array(nHarmonics);
  for (let n = 1; n < nHarmonics; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d);
  }
  return ctx.createPeriodicWave(real, imag);
}

export function triggerSynth(
  ctx,
  dest,
  note,
  when,
  params = {},
  bpm = 120,
  trackVolume = 1,
) {
  const pitch = note.pitch ?? 60;
  const velocity = Math.max(
    0.01,
    Math.min(1, (note.velocity ?? 0.8) * trackVolume),
  );
  const durationSec = Math.max(
    0.05,
    pulsesToSeconds(note.duration ?? 240, bpm),
  );

  const waveform = params.waveform || "sawtooth";
  const cutoff = Math.max(20, Math.min(20000, params.cutoff || 1200));
  const resonance = Math.max(0.1, Math.min(30, params.resonance || 2));
  const attack = Math.max(0.005, params.attack || 0.01);
  const decay = Math.max(0.01, params.decay || 0.15);
  const sustain = Math.max(
    0,
    Math.min(1, params.sustain !== undefined ? params.sustain : 0.5),
  );
  const release = Math.max(0.02, params.release || 0.15);

  const freq = 440 * Math.pow(2, (pitch - 69) / 12);

  // Main Oscillator 1
  const osc1 = ctx.createOscillator();
  if (waveform === "pulse") {
    try {
      const pw = getPulseWave(ctx, params.pulseWidth || 0.5);
      osc1.setPeriodicWave(pw);
    } catch (_) {
      osc1.type = "square";
    }
  } else {
    osc1.type = waveform;
  }
  osc1.frequency.setValueAtTime(freq, when);
  if (params.detune) {
    osc1.detune.setValueAtTime(Number(params.detune), when);
  }

  // Filter (Lowpass with optional Filter ADSR Envelope sweep)
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.setValueAtTime(resonance, when);

  const filterEnvAmount = Number(params.filterEnvAmount || 0);
  const filterDecay = Math.max(0.01, Number(params.filterDecay || decay));

  if (filterEnvAmount !== 0) {
    const peakCutoff = Math.max(20, Math.min(20000, cutoff + filterEnvAmount));
    filter.frequency.setValueAtTime(cutoff, when);
    filter.frequency.linearRampToValueAtTime(peakCutoff, when + attack);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(20, cutoff),
      when + attack + filterDecay,
    );
  } else {
    filter.frequency.setValueAtTime(cutoff, when);
  }

  // Amp Gain ADSR Envelope
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, when);

  // Attack stage
  const peakVal = velocity;
  amp.gain.linearRampToValueAtTime(peakVal, when + attack);

  // Decay stage
  const sustainVal = Math.max(0.0001, peakVal * sustain);
  amp.gain.linearRampToValueAtTime(sustainVal, when + attack + decay);

  // Release stage
  const releaseStart = when + durationSec;
  amp.gain.setValueAtTime(sustainVal, releaseStart);
  amp.gain.exponentialRampToValueAtTime(0.0001, releaseStart + release);

  osc1.connect(filter);

  // Secondary Oscillator (Osc 2)
  let osc2 = null;
  let osc2Gain = null;
  if (params.osc2Waveform && params.osc2Waveform !== "off") {
    osc2 = ctx.createOscillator();
    if (params.osc2Waveform === "pulse") {
      try {
        const pw = getPulseWave(ctx, params.pulseWidth || 0.5);
        osc2.setPeriodicWave(pw);
      } catch (_) {
        osc2.type = "square";
      }
    } else {
      osc2.type = params.osc2Waveform;
    }
    const osc2Oct = Number(params.osc2Octave || 0);
    const osc2Freq = freq * Math.pow(2, osc2Oct);
    osc2.frequency.setValueAtTime(osc2Freq, when);
    if (params.osc2Detune) {
      osc2.detune.setValueAtTime(Number(params.osc2Detune), when);
    }
    osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(Number(params.osc2Mix ?? 0.35), when);
    osc2.connect(osc2Gain);
    osc2Gain.connect(filter);
    osc2.start(when);
  }

  // Sub Oscillator
  let subOsc = null;
  let subGain = null;
  if (params.subMix && Number(params.subMix) > 0) {
    subOsc = ctx.createOscillator();
    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(freq * 0.5, when); // 1 octave below
    subGain = ctx.createGain();
    subGain.gain.setValueAtTime(Number(params.subMix), when);
    subOsc.connect(subGain);
    subGain.connect(filter);
    subOsc.start(when);
  }

  filter.connect(amp);
  amp.connect(dest);

  osc1.start(when);
  const stopTime = releaseStart + release + 0.05;
  osc1.stop(stopTime);
  if (osc2) osc2.stop(stopTime);
  if (subOsc) subOsc.stop(stopTime);

  return createVoiceHandle(
    [amp, filter, osc2Gain, subGain].filter(Boolean),
    [osc1, osc2, subOsc].filter(Boolean),
    stopTime,
    ctx,
  );
}

/**
 * 808 Sub Bass with pitch glide/portamento and harmonics softclip drive.
 * Ported concepts from claw-daw.
 */
export function trigger808(
  ctx,
  dest,
  note,
  when,
  params = {},
  bpm = 120,
  trackVolume = 1,
) {
  const pitch = note.pitch ?? 36;
  const velocity = Math.max(
    0.01,
    Math.min(1, (note.velocity ?? 0.8) * trackVolume),
  );
  const durationSec = Math.max(
    0.05,
    pulsesToSeconds(note.duration ?? 480, bpm),
  );
  const preset = (params.preset || "clean").toLowerCase();
  const decay = Math.max(0.1, Number(params.decay || 0.85));
  const drive = Math.max(0.5, Number(params.drive || 1.15));
  const glide = Math.max(0.0, Number(params.glide ?? 0.05));
  const f0 = 440 * Math.pow(2, (pitch - 69) / 12);

  let harm2 = 0.1;
  let harm3 = 0.04;
  if (preset === "dist" || preset === "dirty") {
    harm2 = 0.22;
    harm3 = 0.1;
  } else if (preset === "growl" || preset === "grit") {
    harm2 = 0.18;
    harm3 = 0.18;
  }

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.linearRampToValueAtTime(velocity, when + 0.004);
  const decayEnd = when + Math.max(durationSec, decay);
  amp.gain.exponentialRampToValueAtTime(0.0001, decayEnd + 0.05);

  let driveNode = null;
  if (ctx.createWaveShaper) {
    driveNode = ctx.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      const x = i / 256 - 1;
      curve[i] = Math.tanh(x * drive);
    }
    driveNode.curve = curve;
  }

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  const toneCutoff = 180 + Math.max(0.1, Number(params.tone || 0.6)) * 2400;
  filter.frequency.setValueAtTime(toneCutoff, when);

  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  if (glide > 0) {
    const glideFrom = f0 * 1.5;
    osc1.frequency.setValueAtTime(glideFrom, when);
    osc1.frequency.exponentialRampToValueAtTime(f0, when + glide);
  } else {
    osc1.frequency.setValueAtTime(f0, when);
  }

  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(f0 * 2, when);
  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(harm2, when);
  osc2.connect(gain2);

  const osc3 = ctx.createOscillator();
  osc3.type = "sine";
  osc3.frequency.setValueAtTime(f0 * 3, when);
  const gain3 = ctx.createGain();
  gain3.gain.setValueAtTime(harm3, when);
  osc3.connect(gain3);

  osc1.connect(filter);
  gain2.connect(filter);
  gain3.connect(filter);

  if (driveNode) {
    filter.connect(driveNode);
    driveNode.connect(amp);
  } else {
    filter.connect(amp);
  }
  amp.connect(dest);

  const stopTime = decayEnd + 0.08;
  osc1.start(when);
  osc2.start(when);
  osc3.start(when);
  osc1.stop(stopTime);
  osc2.stop(stopTime);
  osc3.stop(stopTime);

  return createVoiceHandle(
    [amp, driveNode, filter, gain2, gain3].filter(Boolean),
    [osc1, osc2, osc3],
    stopTime,
    ctx,
  );
}

/**
 * Cubed Roland TB-303 Acid Bassline Synthesizer.
 * Ported concepts from openDAW CubedDeviceBox.
 */
export function triggerCubed(
  ctx,
  dest,
  note,
  when,
  params = {},
  bpm = 120,
  trackVolume = 1,
) {
  const pitch = note.pitch ?? 36;
  const tuningCents = Number(params.tuning || 0);
  const velocity = Math.max(
    0.01,
    Math.min(1, (note.velocity ?? 0.8) * trackVolume),
  );
  const durationSec = Math.max(
    0.05,
    pulsesToSeconds(note.duration ?? 240, bpm),
  );
  const isAccent = Boolean(note.accent || velocity > 0.85);
  const accentMult = isAccent ? Number(params.accent || 1.3) : 1.0;

  const f0 = 440 * Math.pow(2, (pitch + tuningCents / 100 - 69) / 12);
  const waveform = params.waveform === "square" ? "square" : "sawtooth";
  const baseCutoff = Math.max(
    40,
    Math.min(10000, Number(params.cutoff || 450)),
  );
  const resonance = Math.max(
    0.5,
    Math.min(25, Number(params.resonance || 8.0)),
  );
  const envMod = Math.max(0, Number(params.envMod || 2400)) * accentMult;
  const decay =
    Math.max(0.05, Number(params.decay || 0.25)) / (isAccent ? 1.25 : 1.0);

  const osc = ctx.createOscillator();
  osc.type = waveform;
  osc.frequency.setValueAtTime(f0, when);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.setValueAtTime(resonance, when);

  const peakCutoff = Math.min(18000, baseCutoff + envMod);
  filter.frequency.setValueAtTime(peakCutoff, when);
  filter.frequency.exponentialRampToValueAtTime(baseCutoff, when + decay);

  const amp = ctx.createGain();
  const peakGain = Math.min(1.0, velocity * accentMult);
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.linearRampToValueAtTime(peakGain, when + 0.003);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + durationSec + 0.06);

  osc.connect(filter);
  filter.connect(amp);
  amp.connect(dest);

  const stopTime = when + durationSec + 0.08;
  osc.start(when);
  osc.stop(stopTime);

  return createVoiceHandle([amp, filter], [osc], stopTime, ctx);
}

/**
 * Karplus-Strong Physical Plucked String Synthesizer.
 * Ported concepts from claw-daw PluckKarplusInstrument.
 */
export function triggerPluck(
  ctx,
  dest,
  note,
  when,
  params = {},
  bpm = 120,
  trackVolume = 1,
) {
  const pitch = note.pitch ?? 60;
  const velocity = Math.max(
    0.01,
    Math.min(1, (note.velocity ?? 0.8) * trackVolume),
  );
  const tone = Math.max(0.1, Math.min(1.0, Number(params.tone ?? 0.65)));
  const decay = Math.max(0.05, Math.min(1.0, Number(params.decay ?? 0.4)));
  const drive = Math.max(0.5, Number(params.drive ?? 1.1));
  const f0 = 440 * Math.pow(2, (pitch - 69) / 12);
  const period = 1.0 / Math.max(20, Math.min(10000, f0));

  const exciter = ctx.createBufferSource();
  const burstDur = Math.max(0.002, period);
  exciter.buffer = createNoiseBuffer(ctx, burstDur);

  const exciterGain = ctx.createGain();
  exciterGain.gain.setValueAtTime(velocity, when);
  exciterGain.gain.exponentialRampToValueAtTime(0.0001, when + burstDur);

  let delay = null;
  if (ctx.createDelay) {
    delay = ctx.createDelay(0.1);
    delay.delayTime.setValueAtTime(period, when);
  }

  const dampingFilter = ctx.createBiquadFilter();
  dampingFilter.type = "lowpass";
  const cutoff = 1200 + tone * 8000;
  dampingFilter.frequency.setValueAtTime(cutoff, when);

  const feedbackGain = ctx.createGain();
  const feedbackCoeff = 0.9 + decay * 0.085;
  feedbackGain.gain.setValueAtTime(feedbackCoeff, when);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(velocity * drive, when);
  const totalDecayTime = 0.25 + decay * 0.6;
  amp.gain.exponentialRampToValueAtTime(0.0001, when + totalDecayTime);

  exciter.connect(exciterGain);

  if (delay) {
    exciterGain.connect(delay);
    delay.connect(dampingFilter);
    dampingFilter.connect(feedbackGain);
    feedbackGain.connect(delay);
    dampingFilter.connect(amp);
  } else {
    exciterGain.connect(dampingFilter);
    dampingFilter.connect(amp);
  }
  amp.connect(dest);

  exciter.start(when);
  const stopTime = when + totalDecayTime + 0.05;
  exciter.stop(stopTime);

  return createVoiceHandle(
    [amp, delay, dampingFilter, feedbackGain, exciterGain].filter(Boolean),
    [exciter],
    stopTime,
    ctx,
  );
}

/**
 * Yamaha DX7 6-Operator FM Synthesizer.
 * Ported concepts from openDAW TubularDeviceBox.
 */
export function triggerTubular(
  ctx,
  dest,
  note,
  when,
  params = {},
  bpm = 120,
  trackVolume = 1,
) {
  const pitch = note.pitch ?? 60;
  const velocity = Math.max(
    0.01,
    Math.min(1, (note.velocity ?? 0.8) * trackVolume),
  );
  const durationSec = Math.max(
    0.05,
    pulsesToSeconds(note.duration ?? 240, bpm),
  );
  const f0 = 440 * Math.pow(2, (pitch - 69) / 12);
  const modIndex = Number(params.modIndex ?? 2.5);
  const attack = Math.max(0.002, Number(params.attack ?? 0.01));
  const decay = Math.max(0.05, Number(params.decay ?? 0.5));
  const sustain = Math.max(0.0, Math.min(1.0, Number(params.sustain ?? 0.4)));
  const release = Math.max(0.02, Number(params.release ?? 0.3));

  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.setValueAtTime(f0, when);

  const modulator = ctx.createOscillator();
  modulator.type = "sine";
  const modRatio = Number(params.algorithm) % 2 === 0 ? 2.0 : 1.0;
  modulator.frequency.setValueAtTime(f0 * modRatio, when);

  const modGain = ctx.createGain();
  const peakModGain = f0 * modIndex;
  modGain.gain.setValueAtTime(peakModGain, when);
  modGain.gain.exponentialRampToValueAtTime(
    Math.max(1, peakModGain * 0.2),
    when + attack + decay,
  );

  modulator.connect(modGain);
  if (carrier.frequency && carrier.frequency.setValueAtTime) {
    try {
      modGain.connect(carrier.frequency);
    } catch (_) {
      // AudioParam connection fallback
    }
  }

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.linearRampToValueAtTime(velocity, when + attack);
  amp.gain.linearRampToValueAtTime(velocity * sustain, when + attack + decay);

  const releaseStart = when + durationSec;
  amp.gain.setValueAtTime(Math.max(0.0001, velocity * sustain), releaseStart);
  amp.gain.exponentialRampToValueAtTime(0.0001, releaseStart + release);

  carrier.connect(amp);
  amp.connect(dest);

  const stopTime = releaseStart + release + 0.05;
  carrier.start(when);
  modulator.start(when);
  carrier.stop(stopTime);
  modulator.stop(stopTime);

  return createVoiceHandle([amp, modGain], [carrier, modulator], stopTime, ctx);
}

/**
 * Casio CZ-101 Phase Distortion Synthesizer.
 * Ported concepts from openDAW NeonDeviceBox.
 */
export function triggerNeon(
  ctx,
  dest,
  note,
  when,
  params = {},
  bpm = 120,
  trackVolume = 1,
) {
  const pitch = note.pitch ?? 60;
  const velocity = Math.max(
    0.01,
    Math.min(1, (note.velocity ?? 0.8) * trackVolume),
  );
  const durationSec = Math.max(
    0.05,
    pulsesToSeconds(note.duration ?? 240, bpm),
  );
  const f0 = 440 * Math.pow(2, (pitch - 69) / 12);
  const detune = Number(params.detune ?? 8);
  const dcw = Math.max(0.0, Math.min(1.0, Number(params.dcw ?? 0.5)));
  const mode = (params.mode || "normal").toLowerCase();

  const osc1 = ctx.createOscillator();
  osc1.type = params.wave1?.includes("tri") ? "triangle" : "sawtooth";
  osc1.frequency.setValueAtTime(f0, when);

  const osc2 = ctx.createOscillator();
  osc2.type =
    params.wave2 === "pulse" || params.wave2 === "square"
      ? "square"
      : "sawtooth";
  const f2 = f0 * Math.pow(2, detune / 1200);
  osc2.frequency.setValueAtTime(f2, when);

  const dcwFilter = ctx.createBiquadFilter();
  dcwFilter.type = "lowpass";
  const cutoff = 300 + Math.pow(dcw, 1.8) * 9000;
  dcwFilter.frequency.setValueAtTime(cutoff, when);
  dcwFilter.Q.setValueAtTime(4.0, when);

  const amp = ctx.createGain();
  const attack = Math.max(0.005, Number(params.attack || 0.02));
  const release = Math.max(0.02, Number(params.release || 0.25));

  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.linearRampToValueAtTime(velocity, when + attack);
  const releaseStart = when + durationSec;
  amp.gain.setValueAtTime(velocity * 0.7, releaseStart);
  amp.gain.exponentialRampToValueAtTime(0.0001, releaseStart + release);

  let ringGain = null;
  let lineMix = null;
  if (mode === "ring") {
    ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(0, when);
    osc1.connect(ringGain);
    try {
      osc2.connect(ringGain.gain);
    } catch (_) {
      osc2.connect(ringGain);
    }
    ringGain.connect(dcwFilter);
  } else {
    lineMix = ctx.createGain();
    lineMix.gain.setValueAtTime(0.5, when);
    osc1.connect(lineMix);
    osc2.connect(lineMix);
    lineMix.connect(dcwFilter);
  }

  dcwFilter.connect(amp);
  amp.connect(dest);

  const stopTime = releaseStart + release + 0.05;
  osc1.start(when);
  osc2.start(when);
  osc1.stop(stopTime);
  osc2.stop(stopTime);

  return createVoiceHandle(
    [amp, dcwFilter, ringGain, lineMix].filter(Boolean),
    [osc1, osc2],
    stopTime,
    ctx,
  );
}

/**
 * Atmospheric Ambient Texture Pad Synthesizer.
 * Ported concepts from claw-daw NoisePadInstrument.
 */
export function triggerNoisePad(
  ctx,
  dest,
  note,
  when,
  params = {},
  bpm = 120,
  trackVolume = 1,
) {
  const pitch = note.pitch ?? 60;
  const velocity = Math.max(
    0.01,
    Math.min(1, (note.velocity ?? 0.8) * trackVolume),
  );
  const durationSec = Math.max(0.2, pulsesToSeconds(note.duration ?? 480, bpm));
  const f0 = 440 * Math.pow(2, (pitch - 69) / 12);

  const attack = Math.max(0.05, Number(params.attack || 0.6));
  const decay = Math.max(0.05, Number(params.decay || 0.6));
  const sustain = Math.max(0.0, Math.min(1.0, Number(params.sustain ?? 0.7)));
  const release = Math.max(0.1, Number(params.release || 0.9));
  const texture = Math.max(0.0, Math.min(1.0, Number(params.texture ?? 0.25)));

  const oscL = ctx.createOscillator();
  oscL.type = "sine";
  oscL.frequency.setValueAtTime(f0, when);

  const oscR = ctx.createOscillator();
  oscR.type = "sine";
  const detuneHz = f0 * (Math.pow(2, 6 / 1200) - 1);
  oscR.frequency.setValueAtTime(f0 + detuneHz, when);

  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, durationSec + release + 0.5);

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.setValueAtTime(Math.min(12000, f0 * 2), when);
  noiseFilter.Q.setValueAtTime(1.5, when);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(texture * 0.35, when);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.linearRampToValueAtTime(
    velocity * (1.0 - texture * 0.4),
    when + attack,
  );
  amp.gain.linearRampToValueAtTime(velocity * sustain, when + attack + decay);

  const releaseStart = when + durationSec;
  amp.gain.setValueAtTime(velocity * sustain, releaseStart);
  amp.gain.exponentialRampToValueAtTime(0.0001, releaseStart + release);

  oscL.connect(amp);
  oscR.connect(amp);
  noiseGain.connect(amp);
  amp.connect(dest);

  const stopTime = releaseStart + release + 0.1;
  oscL.start(when);
  oscR.start(when);
  noise.start(when);
  oscL.stop(stopTime);
  oscR.stop(stopTime);
  noise.stop(stopTime);

  return createVoiceHandle(
    [amp, noiseFilter, noiseGain],
    [oscL, oscR, noise],
    stopTime,
    ctx,
  );
}

/**
 * Physical Modeling Resonator Synthesizer.
 * Ported concepts from openDAW KorpusDeviceBox.
 */
export function triggerKorpus(
  ctx,
  dest,
  note,
  when,
  params = {},
  bpm = 120,
  trackVolume = 1,
) {
  const pitch = note.pitch ?? 60;
  const velocity = Math.max(
    0.01,
    Math.min(1, (note.velocity ?? 0.8) * trackVolume),
  );
  const f0 = 440 * Math.pow(2, (pitch - 69) / 12);
  const exciterType = params.exciter || "strike";
  const intensity = Math.max(
    0.1,
    Math.min(1.0, Number(params.intensity ?? 0.6)),
  );
  const damping = Math.max(0.05, Math.min(1.0, Number(params.damping ?? 0.5)));

  const exciter = ctx.createOscillator();
  if (exciterType === "bow" || exciterType === "breath") {
    exciter.type = "sawtooth";
  } else {
    exciter.type = "triangle";
  }
  exciter.frequency.setValueAtTime(f0, when);

  const exciterGain = ctx.createGain();
  const exciterDur = exciterType === "strike" ? 0.02 : 0.15;
  exciterGain.gain.setValueAtTime(velocity * intensity, when);
  exciterGain.gain.exponentialRampToValueAtTime(0.0001, when + exciterDur);

  const resFilter = ctx.createBiquadFilter();
  resFilter.type = "bandpass";
  resFilter.frequency.setValueAtTime(f0, when);
  resFilter.Q.setValueAtTime(25.0 * (1.1 - damping), when);

  const amp = ctx.createGain();
  const decayTime = 0.3 + (1.0 - damping) * 1.5;
  amp.gain.setValueAtTime(velocity, when);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + decayTime);

  exciter.connect(exciterGain);
  exciterGain.connect(resFilter);
  resFilter.connect(amp);
  amp.connect(dest);

  exciter.start(when);
  const stopTime = when + decayTime + 0.05;
  exciter.stop(stopTime);

  return createVoiceHandle(
    [amp, exciterGain, resFilter],
    [exciter],
    stopTime,
    ctx,
  );
}

/**
 * Chromatic Micro-Sampler Instrument.
 * Ported concepts from openDAW NanoDeviceBox.
 */
export function triggerNano(
  ctx,
  dest,
  note,
  when,
  params = {},
  bpm = 120,
  trackVolume = 1,
) {
  const pitch = note.pitch ?? 60;
  const rootKey = Number(params.rootKey ?? 60);
  const velocity = Math.max(
    0.01,
    Math.min(1, (note.velocity ?? 0.8) * trackVolume),
  );
  const rate = Math.pow(2, (pitch - rootKey) / 12);
  const durationSec = Math.max(
    0.05,
    pulsesToSeconds(note.duration ?? 240, bpm),
  );

  const cachedBuffer = sampleCache.get(pitch) || sampleCache.get(rootKey);
  if (cachedBuffer) {
    const src = ctx.createBufferSource();
    src.buffer = cachedBuffer;
    src.playbackRate.setValueAtTime(rate, when);

    const amp = ctx.createGain();
    const attack = Math.max(0.001, Number(params.attack || 0.005));
    const release = Math.max(0.01, Number(params.release || 0.2));

    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.linearRampToValueAtTime(velocity, when + attack);
    amp.gain.setValueAtTime(velocity, when + durationSec);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + durationSec + release);

    src.connect(amp);
    amp.connect(dest);

    src.start(when);
    const stopTime = when + durationSec + release + 0.05;
    src.stop(stopTime);

    return createVoiceHandle([amp], [src], stopTime, ctx);
  }

  // Pure synthetic multi-sample tone fallback
  const f0 = 440 * Math.pow(2, (pitch - 69) / 12);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(f0, when);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(velocity, when);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + durationSec + 0.1);

  osc.connect(amp);
  amp.connect(dest);
  osc.start(when);
  const stopTime = when + durationSec + 0.12;
  osc.stop(stopTime);

  return createVoiceHandle([amp], [osc], stopTime, ctx);
}

/**
 * General MIDI SoundFont Instrument.
 * Ported concepts from signal SoundFontSynth and openDAW SoundfontDeviceBox.
 */
export function triggerSoundfont(
  ctx,
  dest,
  note,
  when,
  params = {},
  bpm = 120,
  trackVolume = 1,
) {
  // Try real General MIDI SoundFont voice first
  const sfVoice = triggerSoundfontNote(
    ctx,
    dest,
    note,
    when,
    params,
    bpm,
    trackVolume,
  );
  if (sfVoice) {
    return sfVoice;
  }

  const pitch = note.pitch ?? 60;
  const velocity = Math.max(
    0.01,
    Math.min(1, (note.velocity ?? 0.8) * trackVolume),
  );
  const durationSec = Math.max(
    0.05,
    pulsesToSeconds(note.duration ?? 240, bpm),
  );
  const program = Number(params.program ?? 0);
  const f0 = 440 * Math.pow(2, (pitch - 69) / 12);

  let waveType = "triangle";
  let attack = 0.01;
  let decay = 0.6;
  let sustain = 0.4;
  let release = 0.25;

  if (program < 8) {
    waveType = "triangle";
    attack = 0.005;
    decay = 1.2;
    sustain = 0.2;
    release = 0.3;
  } else if (program >= 24 && program < 32) {
    waveType = "sawtooth";
    attack = 0.008;
    decay = 0.8;
    sustain = 0.15;
    release = 0.2;
  } else if (program >= 32 && program < 40) {
    waveType = "triangle";
    attack = 0.01;
    decay = 0.4;
    sustain = 0.6;
    release = 0.15;
  } else if (program >= 40 && program < 48) {
    waveType = "sawtooth";
    attack = 0.12;
    decay = 0.4;
    sustain = 0.85;
    release = 0.45;
  } else if (program >= 56 && program < 64) {
    waveType = "sawtooth";
    attack = 0.04;
    decay = 0.3;
    sustain = 0.75;
    release = 0.25;
  }

  const osc = ctx.createOscillator();
  osc.type = waveType;
  osc.frequency.setValueAtTime(f0, when);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  const cutoff = program >= 40 ? 4500 : 2800;
  filter.frequency.setValueAtTime(cutoff, when);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.linearRampToValueAtTime(velocity, when + attack);
  amp.gain.linearRampToValueAtTime(velocity * sustain, when + attack + decay);

  const releaseStart = when + durationSec;
  amp.gain.setValueAtTime(velocity * sustain, releaseStart);
  amp.gain.exponentialRampToValueAtTime(0.0001, releaseStart + release);

  osc.connect(filter);
  filter.connect(amp);
  amp.connect(dest);

  osc.start(when);
  const stopTime = releaseStart + release + 0.05;
  osc.stop(stopTime);

  return createVoiceHandle([amp, filter], [osc], stopTime, ctx);
}

export function triggerInstrumentVoice(ctx, dest, event, when, bpm = 120) {
  const inst = (
    event.trackInstrument ||
    event.trackParams?.instrument ||
    event.trackKind ||
    event.instrument ||
    "synth"
  ).toLowerCase();
  const trackVol = event.trackVolume ?? 1;
  const trackPan = event.trackPan ?? 0;
  const params = event.trackParams || {};

  switch (inst) {
    case "drums":
    case "playfield":
      if (
        event.trackInstrument === "soundfont" ||
        params.kit === "soundfont" ||
        params.kit === "rock-kit" ||
        params.kit === "acoustic" ||
        params.instrument === "soundfont" ||
        params.source === "soundfont"
      ) {
        const sfDrumVoice = triggerDrumSoundfont(
          ctx,
          dest,
          event.note,
          when,
          trackVol,
          trackPan,
        );
        if (sfDrumVoice) return sfDrumVoice;
      }
      return triggerDrums(
        ctx,
        dest,
        event.note,
        when,
        trackVol,
        trackPan,
        params,
      );
    case "808":
      return trigger808(ctx, dest, event.note, when, params, bpm, trackVol);
    case "cubed":
      return triggerCubed(ctx, dest, event.note, when, params, bpm, trackVol);
    case "pluck":
      return triggerPluck(ctx, dest, event.note, when, params, bpm, trackVol);
    case "tubular":
      return triggerTubular(ctx, dest, event.note, when, params, bpm, trackVol);
    case "neon":
      return triggerNeon(ctx, dest, event.note, when, params, bpm, trackVol);
    case "noise-pad":
    case "noisepad":
      return triggerNoisePad(
        ctx,
        dest,
        event.note,
        when,
        params,
        bpm,
        trackVol,
      );
    case "korpus":
      return triggerKorpus(ctx, dest, event.note, when, params, bpm, trackVol);
    case "nano":
      return triggerNano(ctx, dest, event.note, when, params, bpm, trackVol);
    case "soundfont":
      if (
        event.trackKind === "drums" ||
        params.kit === "soundfont" ||
        params.kit === "rock-kit" ||
        params.kit === "acoustic" ||
        params.isDrum
      ) {
        const sfDrumVoice = triggerDrumSoundfont(
          ctx,
          dest,
          event.note,
          when,
          trackVol,
          trackPan,
        );
        if (sfDrumVoice) return sfDrumVoice;
      }
      return triggerSoundfont(
        ctx,
        dest,
        event.note,
        when,
        params,
        bpm,
        trackVol,
      );
    case "vaporisateur":
    case "synth":
    default:
      return triggerSynth(ctx, dest, event.note, when, params, bpm, trackVol);
  }
}
