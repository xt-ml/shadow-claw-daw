---
title: "Declarative WebMCP Tools"
created: "2026-11-05T23:00:00Z"
updated: "2026-11-05T23:00:00Z"
slug: "tools"
---

## Declarative WebMCP Tools

Daw provides 40 declarative tools registered in `bin/tool-manifest.mjs` and generated into `.agents/tools/`:

| Tool Name                    | Type         | Description                                                                                            |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| `scdaw_get_status`           | Read-Only    | Return playback position, audio engine state, track count, BPM, and bounce stats.                      |
| `scdaw_get_project`          | Read-Only    | Inspect complete project JSON graph including tracks, notes, volume, pan, and synthesis parameters.    |
| `scdaw_new_project`          | Mutation     | Create and initialize project from template ('basic-beat' or 'empty').                                 |
| `scdaw_load_project`         | Mutation     | Validate and load project schema or load existing project file from OPFS storage.                      |
| `scdaw_set_transport`        | Mutation     | Update tempo (BPM), time signature, pattern length, or swing factor.                                   |
| `scdaw_play`                 | Transport    | Start playback of the looping pattern or arrangement.                                                  |
| `scdaw_stop`                 | Transport    | Stop playback and rewind playhead to loop start.                                                       |
| `scdaw_add_track`            | Mutation     | Add new instrument track ('drums' or 'synth') with custom name and synthesis parameters.               |
| `scdaw_remove_track`         | Mutation     | Remove an existing track by ID.                                                                        |
| `scdaw_set_track`            | Mutation     | Adjust track volume, pan, mute, solo, and synthesis parameters (waveform, cutoff, ADSR).               |
| `scdaw_write_notes`          | Mutation     | Write or merge notes into a track using step, beat, or PPQN coordinates.                               |
| `scdaw_clear_notes`          | Mutation     | Clear notes on a specific track, optionally within a specified step range.                             |
| `scdaw_clear_project_notes`  | Mutation     | Clear all notes across all tracks while preserving tracks, instruments, and effects.                   |
| `scdaw_get_levels`           | Read-Only    | Read real-time peak and RMS audio decibel meter levels for master bus and all tracks.                  |
| `scdaw_bounce`               | Audio Export | Offline render 16/24/32-bit WAV mixdown via `OfflineAudioContext` with metadata report.                |
| `scdaw_export_stems`         | Audio Export | Render consolidated Bar 1 Beat 1 stems across all tracks with multi-tap routing into a ZIP archive.    |
| `scdaw_export_midi`          | MIDI Export  | Export active song or track notes as a Standard MIDI File (.mid SMF Format 0 or 1).                    |
| `scdaw_import_midi`          | MIDI Import  | Import Standard MIDI File into active project or track notes with PPQN scaling.                        |
| `scdaw_export_project`       | Interchange  | Export project as native .scdaw.json or DAWproject v1.0 XML/ZIP archive.                               |
| `scdaw_import_project`       | Interchange  | Import project from native .scdaw.json or DAWproject v1.0 XML/ZIP archive.                             |
| `scdaw_undo`                 | History      | Revert last project mutation from the undo history stack.                                              |
| `scdaw_render_surface`       | Read-Only    | Return custom element HTML tag to embed live workbench, mixer, or transport surface in chat.           |
| `scdaw_reset`                | Mutation     | Hierarchical reset for param, track, pattern notes, or entire project.                                 |
| `scdaw_apply_preset`         | Mutation     | Apply curated synthesizer preset ('init-saw', 'techno-bass', 'acid-303', 'pop-pluck'...) to track.     |
| `scdaw_panic`                | Transport    | Emergency All Notes Off: immediately silence all active voices and stop transport.                     |
| `scdaw_manage_fx`            | Mutation     | Add, update, reset, or remove audio effect or MIDI effect on a track.                                  |
| `scdaw_set_automation`       | Automation   | Set continuous parameter automation points (time in beats, value) for track parameters.                |
| `scdaw_clear_automation`     | Automation   | Clear parameter automation points on a track.                                                          |
| `scdaw_add_audio_clip`       | Audio Clip   | Add an audio clip (sample, vocal take, stem) to an audio track at a specified time position.           |
| `scdaw_set_audio_clip`       | Audio Clip   | Update properties (time, duration, offset, gain, name) of an existing audio clip.                      |
| `scdaw_set_track_send`       | Mutation     | Configure auxiliary send routing level (0.0 to 1.0) from a track to an aux bus.                        |
| `scdaw_record_arm`           | Transport    | Arm or disarm an audio track for live recording.                                                       |
| `scdaw_set_metronome`        | Transport    | Toggle metronome click track and configure click volume.                                               |
| `scdaw_set_instrument`       | Instrument   | Set synthesis instrument on track (808, cubed, pluck, tubular, neon, noise-pad, korpus, soundfont...). |
| `scdaw_set_808`              | Instrument   | Configure and shape authentic 808 sub bass voice with portamento glide, drive, decay, and tone.        |
| `scdaw_configure_fx`         | Mutation     | Add, update, or remove audio effect (autotune, vocoder, maximizer, tidal, transient, sidechain...).    |
| `scdaw_apply_groove`         | Groove       | Apply micro-timing groove templates (mpc60, sp1200, swing16, shuffle) or humanize timing/velocity.     |
| `scdaw_compose_song`         | Composition  | Compile complete multi-bar, multi-track song from high-level SongSpec, chords, and signature motifs.   |
| `scdaw_describe_arrangement` | Read-Only    | Inspect and return human-readable summary of project arrangement (bars, tempo, roles, note counts).    |
| `scdaw_analyze_mix`          | Analysis     | Analyze mix levels, dynamic range, crest factor, clipping, and 3-band energy distribution.             |
