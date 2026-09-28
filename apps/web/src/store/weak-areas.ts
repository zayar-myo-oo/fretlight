"use client";

import { mod, type StepResult } from "@fretlight/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Tally {
  readonly attempts: number;
  readonly correct: number;
}

interface WeakAreaState {
  /** Keyed by pitch class, "0".."11". */
  notes: Record<string, Tally>;
  /** Keyed by "string:fret". Only populated for steps that had a target position. */
  positions: Record<string, Tally>;
  /**
   * Fold one run's step-by-step results into the running tallies.
   *
   * Called with `PracticeEngine.history` right where a session already gets
   * recorded to `useProgress` — same moment, same data, just aggregated
   * instead of stored per-run. A skipped step never counts: the player never
   * attempted it, so it says nothing about whether they know the note.
   */
  recordResults: (results: readonly StepResult[]) => void;
  clear: () => void;
}

function bump(map: Record<string, Tally>, key: string, correct: boolean): Record<string, Tally> {
  const existing = map[key] ?? { attempts: 0, correct: 0 };
  return {
    ...map,
    [key]: { attempts: existing.attempts + 1, correct: existing.correct + (correct ? 1 : 0) },
  };
}

/**
 * Per-note and per-position accuracy, aggregated across every session.
 *
 * "wrong_position" is graded as a *correct* note but a *wrong* position —
 * the player knew what to play and got it wrong only in where, which is a
 * completely different weakness from not knowing the note at all, so
 * collapsing the two into one number would hide which drill actually helps.
 * "wrong" (the note itself was wrong) tells you nothing reliable about which
 * position they meant to play, so it is left out of the position tally
 * rather than guessed at.
 */
export const useWeakAreas = create<WeakAreaState>()(
  persist(
    (set) => ({
      notes: {},
      positions: {},
      recordResults: (results) =>
        set((state) => {
          let notes = state.notes;
          let positions = state.positions;
          for (const result of results) {
            if (result.verdict === "skipped") continue;
            const pitchCorrect = result.verdict === "correct" || result.verdict === "wrong_position";
            notes = bump(notes, String(mod(result.expected.pitchClass, 12)), pitchCorrect);

            if (result.expected.position && pitchCorrect) {
              const { string, fret } = result.expected.position;
              positions = bump(positions, `${string}:${fret}`, result.verdict === "correct");
            }
          }
          return { notes, positions };
        }),
      clear: () => set({ notes: {}, positions: {} }),
    }),
    { name: "fretlight.weak-areas", version: 1 },
  ),
);

export interface WeakSpot {
  readonly key: string;
  readonly accuracy: number;
  readonly attempts: number;
}

/** Weakest entries first, filtered to enough attempts that the number means something. */
export function weakestSpots(tallies: Record<string, Tally>, minAttempts = 3, limit = 5): WeakSpot[] {
  return Object.entries(tallies)
    .map(([key, tally]) => ({ key, accuracy: tally.correct / tally.attempts, attempts: tally.attempts }))
    .filter((spot) => spot.attempts >= minAttempts)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, limit);
}
