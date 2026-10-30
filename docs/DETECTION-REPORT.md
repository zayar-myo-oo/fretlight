# Detection audit (Phase 4)

No accuracy, latency, CPU or memory figures below are measured. Nothing here has been run on hardware.

## Pipeline as found
- `sharedInput` opens one stream with echo cancellation, noise suppression and AGC disabled, and a single AudioContext at the device's native rate. Nothing is resampled; `context.sampleRate` (44.1 or 48 kHz, or higher) is passed to every stage.
- Notes: AudioWorklet (`frame-collector.js`, framing only) → Worker (`PitchPipeline`: conditioning, decimation, YIN with octave recovery, adaptive noise floor) → `InstrumentGate` → `NoteStabilizer` → `PitchStateMachine`. Frame size comes from the lowest frequency (4 periods of low E), and the hop is frameSize/8.
- Chords: an `AnalyserNode` on the same gain node → `PolyphonicDetector` (FFT chroma with harmonic suppression; every chord tone must be present), polled every 50 ms.
- UI: the hub coalesces updates to one per animation frame, and the Live view re-renders only when what it shows changes. Detection rate (worklet hop, 50 ms chord poll) and UI rate (rAF) are already separate.
- Gain, noise gate (≥ 1× base floor) and smoothing presets apply live through `CalibrationPanel`. Clipping (peak ≥ 0.97) is flagged in the UI.

## Defects fixed
1. **Chord flicker on decaying DI chords.** One frame missing a chord tone reset the 3-frame stabiliser, so the name dropped out and came back. Now up to 2 missed frames are tolerated while the input is still active; silence still clears immediately. (`packages/core/src/audio/polyphonic.ts`)
2. **One worker exception killed the input.** `worker.onerror` was handled as "device lost", which stopped listening and ended any recording. Now a failed frame is skipped, and only more than 10 consecutive failures are fatal. (`microphone-pitch-source.ts`)
3. **Permanent stall.** If the worker never answered a frame, `inFlight` stayed true and detection stopped for good. Now a frame unanswered after 500 ms is abandoned.

## Not done / limitations
- No new automated tests or benchmarks were added (skipped by request). The existing synthetic suites (`yin`, `pipeline`, `guitar-validation`, `chroma`) remain.
- No real guitar recordings are in the repo, so chord accuracy on real DI is unmeasured.
- Alternative detectors (e.g. pYIN, CREPE) were not benchmarked; no replacement is proposed without data.
- Chord detection cannot separate inversions or voicings, and pitch-class aliases such as C6/Am7 stay unlabelled by design.

## Manual hardware test plan
For each setup: Chrome desktop with a USB interface (guitar DI at 44.1 kHz, then 48 kHz), and iPhone Safari with a Lightning/USB-C interface or the built-in mic.
1. Fretboard › Play & listen › turn the input on. Confirm one permission prompt and that the level meter moves.
2. Note mode: play open E2 A2 D3 G3 B3 E4, then fret 5 and fret 12 on each string. Record correct / octave-off / wrong / missed for each.
3. Rapid line: play a chromatic run at 120 bpm in 8th notes. Count missed and spurious notes.
4. Chord mode: strum G, D, Em, C, Am 5× each. Record correct, uncertain, wrong, and seconds until the name appears.
5. Auto mode: alternate single notes and chords. Count single notes wrongly shown as chords.
6. Silence (30 s with the volume knob down) and room talking (30 s): count any detections.
7. Clipping: raise the interface gain until the clipping warning appears, then confirm detection recovers after lowering it.
8. Record a 5 s, 15 s and 30 s take. Play, pause, seek; check the fretboard matches what you hear. Reload the page and confirm takes persist; export the audio and play it in the OS player.
9. iPhone: lock the screen mid-listen, unlock, and confirm audio resumes or the Resume button appears.
10. Chrome performance panel: record 60 s of listening and note main-thread % and JS heap at the start and end.
