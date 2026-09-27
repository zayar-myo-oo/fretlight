# Roadmap

## Phase 1 — Foundation ✅ complete

Deterministic engine plus a full UI prototype.

- [x] Workspace with a platform-agnostic core package
- [x] Design system: tokens, surfaces, motion, dark holographic direction
- [x] Music theory engine — 13 scales, 16 chord types, arpeggios, intervals
- [x] Fretboard engine — guitar 6/7, bass 4/5/6, 15 tunings, generated position shapes
- [x] YIN pitch detector with bass octave recovery (verified to 30.87 Hz)
- [x] Signal conditioning and note stabiliser
- [x] Mock pitch source modelling attack, drift, vibrato and decay
- [x] Chromatic tuner with cents meter and note finder
- [x] Web Audio metronome — lookahead scheduling, subdivisions, tap tempo
- [x] Scale finder, chord finder, position boxes, "chords that fit"
- [x] Practice trainer with live grading and local history
- [x] 87 unit tests, clean typecheck, clean production build

## Phase 2 — Real audio ✅ complete

Live microphone input. The `PitchSource` seam meant nothing downstream changed.

- [x] `frame-collector` AudioWorklet — ring buffer, framing only, runs on the audio thread
- [x] `pitch.worker.ts` — conditioning, decimation and YIN off both the audio and main threads
- [x] `MicrophonePitchSource` → `detectionHub.useMicrophone()`
- [x] Constraints: `echoCancellation`, `noiseSuppression`, `autoGainControl` all disabled
- [x] Device picker, input level meter, permission and error states
- [x] Detector retunes its search range when the instrument changes
- [x] Falls back to the virtual instrument when the microphone is blocked
- [x] `Decimator` + `PitchPipeline` — ~80x less work per frame, same accuracy

**Verified** end to end against a synthesised plucked bass with a deliberately weak
fundamental (0.10) against a strong 2nd harmonic (0.34):

| Injected | Reported |
| --- | --- |
| B0 · 30.868 Hz | B0 +1¢ |
| E1 · 41.203 Hz | E1 −1¢ |
| A1 · 55.000 Hz | A1 −1¢ |
| D2 · 73.416 Hz | D2 +0¢ |
| G2 · 97.999 Hz | G2 +0¢ |
| C3 · 130.813 Hz | C3 +0¢ |

Still to do: calibration screen for reference pitch and noise floor, and a benchmark
against recorded instruments rather than synthesised ones.

## Phase 3 — Practice engine depth 🟢 drills shipped

- [x] **Note practice** — play the target anywhere
- [x] **Fret practice** — exact string and fret, with a `wrong_position` verdict distinct
      from a wrong note
- [x] **Interval practice** — intervals from a root
- [x] Seeded, reproducible drills; streak and reaction-time tracking
- [x] Input abstraction: microphone vs audio interface, device selection, hot-plug and
      disconnect handling, per-type noise floor
- [x] Separated state slices (audio / pitch / position / signal) with independent
      subscriptions
- [x] Full input state vocabulary — no input, no signal, low signal, noise, pitch
      uncertain, note detected; position unknown / uncertain / confirmed

Remaining from the original Phase 3:

- Timed mode graded against the metronome on one shared audio clock
- Rushing/dragging feedback from `TimingTracker`
- Session summaries, per-exercise history, tempo progression
- Optional session recording (local, opt-in, never auto-uploaded)

## Phase 4 — Song mode 🟡 architecture in place

- [x] Song and backing-track types: sections, parts in beats, licensing kept separate
- [x] **Phrase decomposition** — splits a part where the music breathes (rests first, then
      bar lines, then a length cap), merges orphaned tails, estimates difficulty
- [x] `phraseToSequence` — a phrase becomes something the existing practice engine grades,
      with suggested fingerings
- [x] Slow-practice ladder — harder phrases start slower and repeat more, always ending at
      full tempo

Still to build: audio playback, tempo/key detection, and time-stretching that preserves
pitch. Deliberately not started — the data model had to be right first.

### Original Phase 4 scope

- Song schema: sections, riffs, chord charts, tempo map
- Loop points, section practice, 25–100 % speed **without pitch change** (WSOLA/phase vocoder)
- Content pipeline kept strictly separate from the engine — licensed, public-domain and
  user-created material only

## Phase 5 — Computer vision 🟢 detection and tracking shipped

- [x] `openCamera` with permission handling, device picker, mirror toggle
- [x] **Automatic neck detection** — Sobel + Hough, in a worker, no model to download
- [x] **Tracking** — speed-adaptive smoothing, outlier rejection, adaptive detection rate
- [x] **State machine with hysteresis** — searching → acquiring → tracking → degraded → fallback
- [x] **Stable fallback fretboard** pinned to the bottom of the camera view
- [x] Manual four-corner alignment retained for awkward angles and lighting
- [x] Perspective fret grid using real 12th-root-of-2 spacing
- [x] Frame-differencing motion detection and stroke-rate estimation
- [x] Confidence fades the overlay; a degenerate or low-confidence pose draws nothing

Verified in a browser against a synthetic scene:

| Scenario | Result |
| --- | --- |
| Instrument moving and rotating | stays `tracking`, fallback never shown |
| Instrument removed | `tracking` → `holding pose` → `lost — using panel` |
| Instrument returns | `lost` → `tracking` in one transition, no flicker |
| Empty room, two crossing lines | no detection (previously a confident false positive) |

Known limits: a neck that fills too little of the frame is declined rather than guessed at
— the fallback covers it. String counting is approximate, so instrument classification is
offered as a hint and never switches the user's selection on its own.

Still to do: MediaPipe hand landmarks, to feed fretting-hand position into the position
estimator as stronger evidence.

## Phase 6 — Holographic mode

- Three.js 3D fretboard, orbit and zoom, 2D/3D toggle
- Floating note markers, scale paths, particle events on correct notes
- Instanced geometry, GPU particles, automatic downgrade on weak devices

## Phase 7 — Optional AI

Last, and behind a boundary.

- Theory explanation, practice plans, exercise generation, session summaries
- Strictly outside the real-time loop; the app stays fully functional without it
