// Ported from openDAW packages/lib/dsp/src/adsr.ts @10088021 (AGPL-3.0-or-later, © André Michelle)
/**
 * .agents/scripts/scdaw-instruments.js
 *
 * Procedural synthesizers (Vaporisateur dual-oscillator + sub + filter ADSR),
 * Playfield 12-piece drum synthesizer, and sample playback engine.
 * Context-agnostic: operates identically with AudioContext & OfflineAudioContext.
 */

import { pulsesToSeconds } from "./scdaw.js";

// Global cache for preloaded sample audio buffers (decoded via ctx.decodeAudioData)
const sampleCache = new Map();

export function setCachedSample(pitch, audioBuffer) {
  sampleCache.set(pitch, audioBuffer);
}

export function getCachedSample(pitch) {
  return sampleCache.get(pitch);
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

export function triggerDrums(
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
    return src;
  }

  // Pure Web Audio procedural synthesizers for drums
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
      return osc;
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
      return osc;
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
      return toneOsc;
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
      return noise;
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
      return osc;
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
      return noise;
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
      return noise;
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
      return osc;
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
        return osc1;
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
      return noise;
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
      return osc;
    }
  }
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
  osc1.type = waveform;
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
  if (params.osc2Waveform && params.osc2Waveform !== "off") {
    osc2 = ctx.createOscillator();
    osc2.type = params.osc2Waveform;
    const osc2Oct = Number(params.osc2Octave || 0);
    const osc2Freq = freq * Math.pow(2, osc2Oct);
    osc2.frequency.setValueAtTime(osc2Freq, when);
    if (params.osc2Detune) {
      osc2.detune.setValueAtTime(Number(params.osc2Detune), when);
    }
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(Number(params.osc2Mix ?? 0.35), when);
    osc2.connect(osc2Gain);
    osc2Gain.connect(filter);
    osc2.start(when);
  }

  // Sub Oscillator
  let subOsc = null;
  if (params.subMix && Number(params.subMix) > 0) {
    subOsc = ctx.createOscillator();
    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(freq * 0.5, when); // 1 octave below
    const subGain = ctx.createGain();
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

  // Return voice handle capable of stopping all nodes
  return {
    stop: (t = 0) => {
      try {
        osc1.stop(t);
        if (osc2) osc2.stop(t);
        if (subOsc) subOsc.stop(t);
      } catch (_) {}
    },
    disconnect: () => {
      try {
        amp.disconnect();
      } catch (_) {}
    },
  };
}

export function triggerInstrumentVoice(ctx, dest, event, when, bpm = 120) {
  if (event.trackKind === "drums") {
    return triggerDrums(
      ctx,
      dest,
      event.note,
      when,
      event.trackVolume ?? 1,
      event.trackPan ?? 0,
    );
  }
  return triggerSynth(
    ctx,
    dest,
    event.note,
    when,
    event.trackParams || {},
    bpm,
    event.trackVolume ?? 1,
  );
}
