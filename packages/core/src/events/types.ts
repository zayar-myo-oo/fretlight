import type { PitchReading } from "../theory/types";
import type { ClickEvent } from "../timing/metronome";
import type { EvaluationEvent } from "../practice/practice-engine";

/**
 * The application's internal event vocabulary.
 *
 * Everything downstream of detection — the fretboard, the holographic renderer,
 * the progress counters, the practice engine — subscribes here rather than
 * calling into each other. That is what keeps the renderer out of the audio path
 * and lets Phase 5 (vision) and Phase 6 (3D) attach without touching the DSP.
 */
// A type alias rather than an interface: only aliases carry the implicit index
// signature that `EventBus<Events extends Record<string, unknown>>` requires.
export type AppEvents = {
  // --- Audio / detection ---
  NOTE_DETECTED: { reading: PitchReading; clarity: number };
  NOTE_CONFIRMED: { reading: PitchReading; clarity: number; time: number };
  NOTE_RELEASED: { midi: number; time: number };
  SIGNAL_SILENT: { time: number };

  // --- Practice ---
  NOTE_CORRECT: EvaluationEvent;
  NOTE_WRONG: EvaluationEvent;
  NOTE_MISSED: EvaluationEvent;
  PRACTICE_STARTED: { sequenceId: string; time: number };
  PRACTICE_STOPPED: { sequenceId: string; time: number };
  PRACTICE_COMPLETED: { sequenceId: string; time: number };

  // --- Timing ---
  BEAT_DETECTED: ClickEvent;
  BPM_CHANGED: { bpm: number };

  // --- Theory selection ---
  SCALE_CHANGED: { root: number; scaleId: string };
  CHORD_CHANGED: { root: number; chordId: string };
  TUNING_CHANGED: { tuningId: string };

  // --- Vision (Phase 5; declared now so the contract is stable) ---
  CAMERA_READY: { width: number; height: number };
  CAMERA_STOPPED: Record<string, never>;
  HAND_DETECTED: { handedness: "left" | "right"; confidence: number };
  FRETBOARD_DETECTED: { confidence: number; corners: readonly [number, number][] };
  FRETBOARD_LOST: Record<string, never>;
};

export type AppEventName = keyof AppEvents;
