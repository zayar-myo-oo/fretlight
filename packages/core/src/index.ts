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




// Events
export * from "./events/types";
export * from "./events/bus";
