---
name: scdaw-audio-clip
description: Manage audio tracks, arrange audio clips, set clip offsets and gains, and configure auxiliary track sends for bus processing.
user-invocable: true
metadata:
  allowed-tools: scdaw_add_track scdaw_add_audio_clip scdaw_set_audio_clip scdaw_set_track_send scdaw_get_project
  execution:
    type: prompt
---

# Audio Tracks & Audio Clips Skill

Manages audio tracks, timeline audio clips (vocals, stems, recorded audio, sound effects), and auxiliary send/return routing.

## Instructions for Agent

1. Query current project structure using `scdaw_get_project`.
2. To create an audio track:
   - Call `scdaw_add_track` with `kind: "audio"` and `name: "Vocals"`.
3. To place an audio clip onto an audio track:
   - Call `scdaw_add_audio_clip` with `trackId` and `clip`:
     ```json
     {
       "trackId": "trk_vocals",
       "clip": {
         "name": "Chorus Vocal",
         "sample": "vocals_chorus.wav",
         "time": 0.0,
         "duration": 4.0,
         "offset": 0.0,
         "gain": 1.0
       }
     }
     ```
4. To adjust clip timing, length, or level:
   - Call `scdaw_set_audio_clip` with `trackId`, `clipId`, and `patch`.
5. To route track audio to an effects return or submix bus:
   - Call `scdaw_set_track_send` with `trackId`, `targetTrackId`, and `level` (0.0 to 1.0).
6. Verify layout on timeline using `scdaw_render_surface` or bounce audio using `scdaw_bounce`.
