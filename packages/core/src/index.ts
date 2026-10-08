/**
 * @fretlight/core — platform-agnostic engines.
 *
 * Rules for this package:
 *  - no DOM, no Web Audio, no React, no fetch;
 *  - pure functions and small stateful classes only;
 *  - every export must be unit-testable under plain Node.
 *
 * Browser-specific adapters (AudioWorklet, getUserMedia, WebGL, MediaPipe) live
 * in the app layer and depend on this package, never the other way round.
 */

// Theory
export * from "./theory/types";
export * from "./theory/pitch";
export * from "./theory/intervals";
export * from "./theory/scales";
export * from "./theory/chords";
export * from "./theory/arpeggio";
export * from "./theory/harmonic-function";
export * from "./theory/key-detection";
export * from "./song-analysis";
export * from "./companion";
export * from "./looper/loop-math";

// Instrument
export * from "./instrument/tunings";
export * from "./instrument/instruments";
export * from "./instrument/fretboard";
export * from "./instrument/position-estimator";

// Audio DSP
export * from "./audio/types";
export * from "./audio/yin";
export * from "./audio/decimate";
export * from "./audio/pipeline";
export * from "./audio/fft";
export * from "./audio/onset";
export * from "./audio/noise-floor";
export * from "./audio/quality";
export * from "./audio/test-signals";
export * from "./audio/conditioning";
export * from "./audio/stabilizer";
export * from "./audio/pitch-state";
export * from "./audio/signal-state";
export * from "./audio/chroma";
export * from "./audio/pluck";

// Timing
export * from "./timing/metronome";
export * from "./timing/rhythm";

// Practice
export * from "./practice/sequence";
export * from "./practice/practice-engine";
export * from "./practice/scoring";
export * from "./practice/drills";
export * from "./practice/bassline";
export * from "./practice/insights";
export * from "./practice/ear-training";

// Song / backing-track architecture
export * from "./song/types";
export * from "./song/phrase";
export * from "./song/library";

// Vision
export * from "./vision/homography";
export * from "./vision/edges";
export * from "./vision/hough";
export * from "./vision/neck-detector";
export * from "./vision/tracking";
export * from "./vision/motion";

// Events
export * from "./events/types";
export * from "./events/bus";
