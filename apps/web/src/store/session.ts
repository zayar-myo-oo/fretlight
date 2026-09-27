"use client";

import {
  type ChordId,
  type ScaleId,
  type Subdivision,
  type TimeSignature,
  defaultTuning,
  getInstrument,
  getTuning,
} from "@fretlight/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NoteLabelMode = "note" | "degree" | "interval";

export interface SessionState {
  // --- Instrument ---
  instrumentId: string;
  tuningId: string;
  fretCount: number;
  /** Reference pitch. Some players tune to 442; orchestras drift further. */
  a4: number;

  // --- Theory selection ---
  root: number;
  scaleId: ScaleId;
  chordId: ChordId;

  // --- Display ---
  labelMode: NoteLabelMode;
  /**
   * Draw the lowest-pitched string along the top edge.
   *
   * Off by default. Tab, chord charts and scale diagrams all put the high E on
   * top, so that is what a player reads fluently; the option exists for anyone
   * who prefers the view they get looking down at their own instrument.
   */
  lowStringOnTop: boolean;
  showOutOfScale: boolean;
  /** Play a short chime when the tuner reading lands in tune. */
  tunerChimeEnabled: boolean;

  // --- Metronome ---
  bpm: number;
  timeSignature: TimeSignature;
  subdivision: Subdivision;
  accentFirstBeat: boolean;
  metronomeVolume: number;

  // --- Practice ---
  matchOctave: boolean;

  /**
   * Which fret the fretting hand is around, or null for "work it out".
   *
   * Audio cannot tell an A2 on the low E at fret 5 from the open A string — they
   * are the same waveform. Without this, the app can only assume the easiest
   * position, which is wrong for most real playing: a pentatonic box at the 5th
   * fret gets drawn down at the nut. Setting it makes the highlight exact.
   */
  handFret: number | null;

  setInstrument: (instrumentId: string) => void;
  setTuning: (tuningId: string) => void;
  setRoot: (root: number) => void;
  setScale: (scaleId: ScaleId) => void;
  setChord: (chordId: ChordId) => void;
  setLabelMode: (mode: NoteLabelMode) => void;
  setBpm: (bpm: number) => void;
  setHandFret: (fret: number | null) => void;
  patch: (partial: Partial<SessionState>) => void;
}

const DEFAULT_INSTRUMENT = "bass-4";

/**
 * Session preferences, persisted to localStorage.
 *
 * Only *selection* lives here — never live detection values. Pitch frames
 * arrive 60 times a second and belong in `detectionHub`, outside React, so a
 * tuner readout never re-renders the fretboard.
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      instrumentId: DEFAULT_INSTRUMENT,
      tuningId: "bass-4-standard",
      fretCount: 20,
      a4: 440,

      root: 9, // A
      scaleId: "minor_pentatonic",
      chordId: "minor",

      labelMode: "note",
      lowStringOnTop: false,
      showOutOfScale: false,
      tunerChimeEnabled: true,

      bpm: 90,
      timeSignature: { beats: 4, value: 4 },
      subdivision: "quarter",
      accentFirstBeat: true,
      metronomeVolume: 0.6,

      matchOctave: false,
      handFret: null,

      setInstrument: (instrumentId) =>
        set(() => {
          const instrument = getInstrument(instrumentId);
          if (!instrument) return {};
          // Switching instrument must also move to a tuning that exists for it,
          // otherwise the fretboard would render against the wrong string count.
          const tuning = defaultTuning(instrument.kind, instrument.stringCount);
          return {
            instrumentId,
            tuningId: tuning.id,
            fretCount: instrument.fretCount,
          };
        }),

      setTuning: (tuningId) => set(() => (getTuning(tuningId) ? { tuningId } : {})),
      setRoot: (root) => set({ root: ((root % 12) + 12) % 12 }),
      setScale: (scaleId) => set({ scaleId }),
      setChord: (chordId) => set({ chordId }),
      setLabelMode: (labelMode) => set({ labelMode }),
      setBpm: (bpm) => set({ bpm: Math.min(400, Math.max(20, Math.round(bpm))) }),
      setHandFret: (handFret) => set({ handFret }),
      patch: (partial) => set(partial),
    }),
    {
      name: "fretlight.session",
      version: 2,
      // Actions are recreated on load; persisting them would pin stale closures.
      partialize: (state) =>
        Object.fromEntries(
          Object.entries(state).filter(([, value]) => typeof value !== "function"),
        ) as SessionState,
      // v1 -> v2: `lowStringOnTop` defaulted to `true` (low string drawn on top),
      // which is backwards from every piece of written guitar material — tab,
      // chord charts, scale diagrams all put the *high* E on top. The default
      // is now `false`, but anyone who already had v1 state saved has `true`
      // baked into localStorage, and persisted state wins over a new in-code
      // default on every load. Nobody could have deliberately chosen `true`
      // before this migration added the toggle that lets them, so it is safe
      // to just correct it rather than leave a stale, invisible flag behind.
      migrate: (persistedState, fromVersion) => {
        const state = persistedState as Partial<SessionState>;
        if (fromVersion < 2) {
          return { ...state, lowStringOnTop: false };
        }
        return state;
      },
    },
  ),
);
