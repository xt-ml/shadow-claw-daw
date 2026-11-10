---
name: scdaw-record
description: Manage audio recording arms, configure metronome click tracks, and record live microphone/line-in audio takes.
user-invocable: true
metadata:
  allowed-tools: scdaw_record_arm scdaw_set_metronome scdaw_add_track scdaw_get_project scdaw_play scdaw_stop
  execution:
    type: prompt
---

# Audio Recording & Metronome Skill

Manages live recording workflows, track record-arming, and audible metronome configuration.

## Instructions for Agent

1. Query current project structure using `scdaw_get_project`.
2. Configure metronome click track:
   - Call `scdaw_set_metronome` with `enabled: true` and optional `volume` (0.0 to 1.0) to provide a timing reference.
3. Prepare an audio track for recording:
   - If an audio track exists, call `scdaw_record_arm` with `trackId` and `armed: true`.
   - If no audio track exists, first create one with `scdaw_add_track` (`kind: "audio"`), then arm it.
4. Transport control:
   - Call `scdaw_play` to start transport playback with active metronome guide clicks (accented 800 Hz on beat 1, 500 Hz on beats 2-4).
   - Call `scdaw_stop` to conclude playback or recording.
5. In the UI:
   - Users can click `[● R]` on the audio track header to toggle record-arm.
   - Users can click `[● REC]` on the transport bar to trigger `getUserMedia` microphone capture and automatic WAV take insertion.
   - Users can click `[📂]` on the audio track header to import local WAV files directly into the track.
