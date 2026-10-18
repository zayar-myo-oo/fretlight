import type { PitchReading } from "../theory/types";
import type { ClickEvent } from "../timing/metronome";

/**
 * The application's internal event vocabulary.
 *
 * Detection, theory selection and timing share events without coupling the
 * fretboard renderer to the audio processing loop.
 */
// A type alias rather than an interface: only aliases carry the implicit index
// signature that `EventBus<Events extends Record<string, unknown>>` requires.
export type AppEvents = {
  // --- Audio / detection ---
  NOTE_DETECTED: { reading: PitchReading; clarity: number };
  NOTE_CONFIRMED: { reading: PitchReading; clarity: number; time: number };
  NOTE_RELEASED: { midi: number; time: number };
  SIGNAL_SILENT: { time: number };

  // --- Timing ---
  BEAT_DETECTED: ClickEvent;
  BPM_CHANGED: { bpm: number };

  // --- Theory selection ---
  SCALE_CHANGED: { root: number; scaleId: string };
  CHORD_CHANGED: { root: number; chordId: string };
  TUNING_CHANGED: { tuningId: string };

};

export type AppEventName = keyof AppEvents;
