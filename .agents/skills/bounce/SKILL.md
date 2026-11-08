---
name: bounce
description: Render the project offline into a broadcast 16/24/32-bit WAV audio file, multi-track stems ZIP, or Standard MIDI file.
user-invocable: true
metadata:
  allowed-tools: scdaw_bounce scdaw_export_stems scdaw_export_midi scdaw_export_project scdaw_get_status
  execution:
    type: tools
    tools:
      - name: scdaw_bounce
        input:
          loops: 2
          bitDepth: 24
          saveToWorkspace: true
---

# Audio Bounce & Stems Export Skill

Renders project loops offline at maximum CPU rendering speed via `OfflineAudioContext`, exports multi-track stems with silence trimming, and bundles project assets into standard formats.

## Capabilities

- Multi-depth WAV binary encoding (16-bit PCM, 24-bit PCM studio standard, 32-bit Float).
- Consolidated Bar 1 Beat 1 stems export with multi-tap routing (`post-fader`, `pre-fader`, `pre-fx`).
- Standard MIDI File (.mid) Format 1 multi-track and Format 0 export with MIDI FX and swing baking.
- Lossless DAWproject v1.0 XML/ZIP interchange export (`scdaw_export_project`).
- Automatic browser download initiation.
- Session metadata, silence-tail trimming, and peak/RMS statistics export.

## Instructions for Agent

1. For mixdown audio, invoke `scdaw_bounce` specifying `loops: 1` or `2` and `bitDepth: 24` (default).
2. For track stems, invoke `scdaw_export_stems` specifying `tap: "post-fader"` and `bundleZip: true`.
3. For MIDI, invoke `scdaw_export_midi` to export SMF Format 1 multi-track notes.
4. Report audio duration in seconds, total byte size, peak level, and RMS level.
