# Fretlight audio repair and validation

Date: 2026-10-30. Existing repository: `/Users/zayarmyooo/Documents/fretlight`, branch `main`, base commit `256cb99`. Repairs were developed and tested in an isolated copy of that repository. No replacement application or hosting project was created. No Git push or deployment was performed.

## Audit findings and changes

The repository already contained a Next.js/React application, a custom YIN detector, independent chroma analysis, theory tools, a tuner, bass/guitar tunings, a metronome, sample/modelled note playback, English/Myanmar language controls, and an SVG fretboard. The repository inventory covered both workspaces and 124 source files. Inspection focused on the route/layout and preference wiring, input/analysis lifecycle, worklets/worker, DSP stages and their tests, fretboard semantics, and playback. The deployed website was not accessible through the web reader; validation here concerns the checked-out source.

Concrete defects found:

1. `InputBar` changed React state and immediately reconnected using the previous device ID captured by its callback. It now passes the selected ID directly. Device classification only orders the list; it cannot hide a mislabelled USB device. System default is labelled honestly rather than promising that the OS default is an interface.
2. Both capture implementations acquired separate streams/contexts and constructed the AudioContext after awaiting permission. Setup failures and pending/unmounted starts could leave resources active. `SharedInput` now owns capture, unlocks the context from the gesture, serializes requests, invalidates superseded opens, closes replaced streams, and publishes interruption state. Note analysis and chord analysis use this owner; recording attaches to its exact MediaStream.
3. The input chain used stateful filters on overlapping windows. The end of the previous window was incorrectly treated as adjacent to the earlier start of the next window. New production-size tests reproduced missed F2 detection at 48/96 kHz and slow settling at 44.1 kHz. Independent per-window filter reset fixed those cases. A browser-driven triangle E2 then exposed phase sensitivity with the original two-period minimum window. The minimum now covers four periods, and both the browser test and all 75 synthetic semitone/rate cases pass.
4. Recording was not wired into the application. An old looper worklet was present but unused. Explicit local recording now saves audio, detection transitions, tuning/board, actual track settings and stop reason. It never requests another input stream.
5. The original chord matcher could treat harmonics or incomplete tone sets as chords. The independent FFT/chroma path now subtracts a conservative harmonic envelope, requires observed defining tones, rejects weak and near-tied matches, and clears on silence. It does not assemble chords from serial monophonic notes. C6/Am7 and other inherently ambiguous pitch-class sets may deliberately remain unlabelled.
6. Position readouts could claim “position confirmed” and refer to a nonexistent camera feature. They now identify estimated positions. Live notes mark exact-MIDI alternatives; chord views mark chord-tone locations and root, without claiming detected octaves, inversion or fingering.
7. The newly used chord fretboard exposed intrinsic grid overflow on narrow screens. Grid/panel sizing now contains the existing horizontally scrollable SVG. Live/replay views show frets 0–12, preserving the full-range explore and tuner features.
8. Playback seeking exactly to an event could miss it because the media clock rounds to microseconds. Timeline lookup tolerates that rounding and is tested for backwards seeks and release events.

## Implemented behavior

- USB/interface or microphone selection through enumerateDevices/getUserMedia; explicit deviceId when supported; echo cancellation, automatic gain control and noise suppression requested off. Actual browser track settings are saved with a take. No requested sample-rate assumption: DSP uses AudioContext.sampleRate.
- Input meter and clipping indication, existing live gain/noise/smoothing controls retained, explicit resume control for suspended/interrupted contexts, cleanup on stop/failure/replacement/unmount, device-loss messaging and user-controlled reconnection. No automatic switch to a different physical device after loss.
- YIN remains the monophonic detector and is now validated at actual production window/hop sizes. Worker backpressure prevents a queue of stale analysis frames. A silent worklet output keeps the processing graph connected without monitoring captured sound through the speakers.
- Independent polyphonic waveform FFT/chroma processing, 8192 samples at 44.1/48 kHz and 16384 at 96 kHz, evaluated every 50 ms and requiring three agreeing matches.
- MediaRecorder codec capability selection (WebM/Opus, MP4, Ogg/Opus, or browser default), final-chunk collection, local IndexedDB history, delete, audio export and matching JSON timeline export.
- A take ends on input interruption, device replacement, listening-mode change or leaving the screen. Limits: five minutes or approximately 32 MiB per take. Storage failure keeps the latest take available for export in memory.
- Replay uses the saved tuning and audio element currentTime; seek/pause/rate changes do not depend on scheduled timers. Events are transitions for the selected note/chord mode, including no-confident-detection states. Software analysis gain does not alter the raw recorded stream.

## Proven validation

Environment: macOS, Node 24.22.1, Next.js 15.5.26, Chrome 156.0.8078.79. No physical guitar, microphone or USB interface was used for these checks.

| Check | Result |
|---|---|
| Existing core suite plus new DSP validation | 218 tests passed |
| Browser-adapter unit tests, recording/storage/timeline/marker tests and existing synth tests | 19 tests passed |
| Chrome automated browser regression suite | 6 tests passed |
| TypeScript checks for both workspaces | Passed |
| Production build including generated routes | Passed |
| Whitespace/diff check | Passed |

The original 210 core and 8 web tests still pass. New core tests validate every semitone from MIDI 40/E2 through MIDI 64/E4 at 44.1, 48 and 96 kHz, with no wrong committed notes and under 20 cents error in those generated clean-guitar fixtures. Existing bass, noise, speech-like, vibrato, theory, tuning and position tests remain in the suite.

Polyphonic waveform tests pass for C, D, E, G, A, Am, Em, Dm and G7 open-style voicings at all three rates. Separate tests reject each isolated guitar note in E2–E4 despite its harmonics, reject silence and deterministic broadband noise, and clear after a chord. Nine strummed, decaying synthetic chord voicings settle to the expected result at 48 kHz. This is fixture validation, not a measured real-instrument recognition accuracy percentage.

Chrome checks cover:

1. One getUserMedia call for listening plus recording; real MediaRecorder blob playback; seek, audio/JSON download, reload history and delete.
2. Actual AudioWorklet/Worker frame processing, replacement device ID and ended tracks after off.
3. Fretboard/explore, relationships, tuner, settings and listen routes at 390×844, with no page-level horizontal overflow or uncaught page errors.
4. A generated E2 MediaStream through the real live Worker path, E2 readout, recorded MIDI 40 event and replay highlight at its timestamp.
5. Mode change finalizes recording and releases capture.
6. Permission denial produces an error and no live capture.

## Latency measurements and meaning

Measured using generated waveforms, production window/hop sizing, the actual DSP/gate/stabilizer/display classes, and known injected onsets. CPU timings are performance.now measurements on this machine; they vary by load.

| Sample rate | Note onset to stable decision, 25 pitches | DSP processing p95 per frame |
|---|---:|---:|
| 44.1 kHz | 156.35–167.96 ms | 0.417 ms |
| 48 kHz | 123.33–166.00 ms | 0.428 ms |
| 96 kHz | 123.33–166.00 ms | 0.591 ms |

Nine strummed synthetic chords at 48 kHz: **220.67–270.67 ms** from first-string onset to the correct stable chord, with 20 ms between string starts.

These figures exclude physical input latency, OS buffering, browser scheduling/rendering and codec offsets. They are not guitar-to-screen or round-trip hardware latency measurements. The calibration readout explicitly says browser output latency; baseLatency/outputLatency do not measure guitar input latency.

Recorded event timestamps use the AudioContext clock relative to recorder.start() and represent when a detection decision became available. Audio and events share capture and replay time, but MediaRecorder start/codec priming offsets have not been calibrated. The implementation does not claim sample-accurate waveform-to-event alignment or backdate decisions to estimated acoustic note onsets.

## Untested scenarios and remaining limits

- Physical USB interfaces, multi-input/channel routing, gain knobs, hot-unplug/replug and OS device renumbering. Lifecycle logic is covered with mocked tracks; real hardware is still required.
- Physical iPhone Safari, iOS interruption/background/lock-screen behavior, Bluetooth routes, Safari MP4 encoding and long recordings. Capability paths and resume handling are implemented, not device-certified. Chromium at a phone-sized viewport is not Safari testing.
- Firefox, Android devices, low-powered phones, five-minute soak tests, real storage eviction/quota pressure and private browsing. Storage and recorder failures are surfaced; only the normal persistence path was browser-tested.
- Real acoustic/electric guitars, distortion, weak fundamentals, room reverberation, loud speech, detuned chords, alternate voicings and fast chord changes beyond the listed synthetic fixtures. Harmonic subtraction is heuristic and may remove a real chord tone or retain an overtone. A single mixed audio channel cannot establish physical string/fret positions or reliably infer inversions from pitch classes.
- No simultaneous note-and-chord mode: the existing analysis selector is retained and each take belongs to its selected mode. Changing mode ends the take.
- No export import UI; exported audio plus versioned JSON can be used externally. Browser-local history is replayable in the app.
- Existing lint command was not treated as an ESLint validation; production compilation and TypeScript checks passed. Existing remote sample playback downloads were not exhaustively auditioned. All existing synth tests and route smoke checks passed.
- The live Vercel deployment remains unchanged and was not validated against this patch.

## Reproduce

Use Node 24 (the repository supports 20/22/24), install dependencies with `npm ci`, then run:

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e --workspace @fretlight/web
npm test --workspace @fretlight/core -- --reporter=verbose src/audio/guitar-validation.test.ts
```

The browser suite uses installed Google Chrome and a fake/synthesized stream; it does not need microphone permission from a person. The production build retains the existing Google Fonts and needs network access for their first download. In this sandbox the first dependency installation/build was blocked by network restrictions; both succeeded when run with the permitted network access.

No new production dependency was added. The added development dependencies are @playwright/test (Apache-2.0) and fake-indexeddb (Apache-2.0). DSP, Web Audio, MediaRecorder and IndexedDB run locally and require no paid service. Browser recording capability selection follows the MediaStream Recording specification: https://www.w3.org/TR/mediastream-recording/.

## Changed files

The accompanying patch is based on commit 256cb99. The following list is generated from the final working tree.
- `.gitignore`
- `README.md`
- `apps/web/e2e/audio.spec.ts`
- `apps/web/package.json`
- `apps/web/playwright.config.ts`
- `apps/web/src/components/audio/CalibrationPanel.tsx`
- `apps/web/src/components/audio/InputBar.tsx`
- `apps/web/src/components/audio/InputSourcePanel.tsx`
- `apps/web/src/components/audio/LiveChordPanel.tsx`
- `apps/web/src/components/audio/RecordingPanel.tsx`
- `apps/web/src/components/fretboard/Fretboard.tsx`
- `apps/web/src/components/fretboard/PositionReadout.tsx`
- `apps/web/src/components/fretboard/modes/ListenMode.tsx`
- `apps/web/src/components/ui/Panel.tsx`
- `apps/web/src/lib/audio/audio-input.ts`
- `apps/web/src/lib/audio/chord-listener.ts`
- `apps/web/src/lib/audio/detection-hub.ts`
- `apps/web/src/lib/audio/detection-markers.ts`
- `apps/web/src/lib/audio/microphone-pitch-source.ts`
- `apps/web/src/lib/audio/session-recording.test.ts`
- `apps/web/src/lib/audio/session-recording.ts`
- `apps/web/src/lib/audio/shared-input.test.ts`
- `apps/web/src/lib/audio/shared-input.ts`
- `apps/web/src/store/session.ts`
- `docs/ARCHITECTURE.md`
- `docs/AUDIO-REPAIR.md`
- `docs/ROADMAP.md`
- `package-lock.json`
- `packages/core/src/audio/chroma.ts`
- `packages/core/src/audio/guitar-validation.test.ts`
- `packages/core/src/audio/pipeline.ts`
- `packages/core/src/audio/polyphonic.ts`
- `packages/core/src/index.ts`
