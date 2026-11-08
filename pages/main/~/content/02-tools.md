---
title: "Declarative WebMCP Tools"
created: "2026-11-05T23:00:00Z"
updated: "2026-11-05T23:00:00Z"
slug: "tools"
---

# Declarative WebMCP Tools

Daw provides 25 declarative tools registered in `bin/tool-manifest.mjs` and generated into `.agents/tools/`:

| Tool Name              | Type         | Description                                                                    |
| ---------------------- | ------------ | ------------------------------------------------------------------------------ |
| `scdaw_get_status`     | Read-Only    | Return transport state, playhead position, BPM, and bounce stats.              |
| `scdaw_get_project`    | Read-Only    | Inspect complete project JSON schema.                                          |
| `scdaw_new_project`    | Mutation     | Create project from starter genre or empty template.                           |
| `scdaw_load_project`   | Mutation     | Validate and load an existing project schema.                                  |
| `scdaw_set_transport`  | Mutation     | Update tempo (BPM), length, signature, or swing.                               |
| `scdaw_play`           | Transport    | Start loop playback.                                                           |
| `scdaw_stop`           | Transport    | Stop playback and rewind playhead.                                             |
| `scdaw_add_track`      | Mutation     | Add drum or synth track with custom parameters.                                |
| `scdaw_remove_track`   | Mutation     | Remove track by ID.                                                            |
| `scdaw_set_track`      | Mutation     | Adjust volume, pan, mute, solo, and synth filters.                             |
| `scdaw_write_notes`    | Mutation     | Write notes using step, beat, or PPQN coordinates.                             |
| `scdaw_clear_notes`    | Mutation     | Clear notes on a track or within a range.                                      |
| `scdaw_get_levels`     | Read-Only    | Read real-time peak and RMS decibel meters.                                    |
| `scdaw_bounce`         | Audio Export | Offline render 16/24/32-bit WAV mixdown via `OfflineAudioContext`.             |
| `scdaw_export_stems`   | Audio Export | Render consolidated Bar 1 Beat 1 stems with multi-tap routing & ZIP packaging. |
| `scdaw_export_midi`    | MIDI Export  | Export SMF Format 1 or Format 0 file with baked MIDI FX and swing.             |
| `scdaw_import_midi`    | MIDI Import  | Import SMF (.mid) file or track notes with PPQN resolution scaling.            |
| `scdaw_export_project` | Interchange  | Export native .scdaw.json or DAWproject v1.0 XML/ZIP interchange format.       |
| `scdaw_import_project` | Interchange  | Import native JSON schema or DAWproject v1.0 archive.                          |
| `scdaw_undo`           | History      | Revert last project mutation.                                                  |
| `scdaw_render_surface` | Read-Only    | Return custom element tag for embedding in chat.                               |
| `scdaw_reset`          | Mutation     | Hierarchical reset (param, track, pattern, or project scope).                  |
| `scdaw_apply_preset`   | Mutation     | Apply curated synth preset (techno-bass, pop-pluck, acid-303...).              |
| `scdaw_manage_fx`      | Mutation     | Add, update, reset, or remove audio/MIDI effect on track.                      |
| `scdaw_panic`          | Transport    | Emergency All Notes Off: silence voices and stop transport.                    |
