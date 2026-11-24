---
name: audio-editing
description: Non-destructive & offline audio editing, spectral/noise reduction, time/pitch stretching, analysis, and label-track workflows.
user-invocable: true
metadata:
  allowed-tools: scdaw_import_audio scdaw_add_track scdaw_add_audio_clip scdaw_set_audio_clip scdaw_edit_audio_clip scdaw_process_audio_clip scdaw_analyze_audio_clip scdaw_manage_labels scdaw_get_project scdaw_render_surface scdaw_undo scdaw_bounce
  execution:
    type: prompt
---

# Audio Editing, Spectral Restoration & Labels Skill

Executes non-destructive timeline clip edits, lossless offline DSP processors, spectral noise reduction, acoustic analysis, and point, region, and spectral label workflows.

## Instructions for Agent

1. Inspect the active session with `scdaw_get_project` to identify audio tracks and clip IDs.
2. **Import / Generate Audio**:
   - Import base64/data-URI WAV, MP3, OGG, or FLAC audio onto a timeline track using `scdaw_import_audio`.
   - Synthesize reference audio (tone, chirp, white/pink/brownian noise, DTMF, silence) with `scdaw_process_audio_clip` (`effect: "generate_tone" | "generate_noise" | "generate_dtmf" | "generate_silence"`).
3. **Non-Destructive Clip Arrangement (`scdaw_edit_audio_clip`)**:
   - Split (`split`), trim (`trim`), duplicate (`duplicate`), join (`join`), equal-power crossfade (`crossfade`), configure fade curves (`set_fades`), sculpt gain envelopes (`set_envelope`), silence ranges (`silence_range`), mute (`mute`), or split across detected silences (`split_at_silences`).
   - Adjust non-destructive clip `pitch` (semitones), `speed`, and `stretchToMatchTempo` via `scdaw_set_audio_clip`.
4. **Offline PCM & Spectral Processing (`scdaw_process_audio_clip`)**:
   - Conditioning & dynamics: `normalize`, `loudness` (EBU R128 LUFS/RMS), `amplify`, `remove_dc`, `invert`, `reverse`, `click_removal`, `fade_in`, `fade_out`, `bake_fades`.
   - Spectral Noise Reduction: capture a noise fingerprint (`effect: "noise_profile"`, optionally over `startSec`/`endSec`) then run `effect: "noise_reduction"`, or filter frequency bands via `effect: "spectral_edit"`.
   - Time & Pitch: `change_tempo` (WSOLA pitch-preserving), `change_pitch` (duration-preserving), `change_speed`, and `truncate_silence`. Every destructive edit creates a new versioned buffer key so `scdaw_undo` restores cleanly.
5. **Analysis & Labels (`scdaw_analyze_audio_clip` & `scdaw_manage_labels`)**:
   - Run `stats`, `spectrum`, `clipping`, `silence_finder`, `beat_finder`, or `spectrogram` (optionally with `params: { createLabels: true }`).
   - Add, update, list, clear, or `split_at_labels` via `scdaw_manage_labels`.
6. **Inspect Visually or Bounce**:
   - Open `<scdaw-wave-editor>` (`scdaw_render_surface` with `element: "wave-editor"`) or `<scdaw-spectrum>` (`element: "spectrum"`), and render final audio via `scdaw_bounce`.
