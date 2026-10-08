"use client";

import type { EarTally } from "@fretlight/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface EarState {
  /** Keyed "interval:4" or "chord:minor". */
  tallies: Record<string, EarTally>;
  record: (key: string, correct: boolean) => void;
  clear: () => void;
}

/** Per-interval and per-chord-type accuracy, kept on this device only. */
export const useEarTraining = create<EarState>()(
  persist(
    (set) => ({
      tallies: {},
      record: (key, correct) =>
        set((state) => {
          const t = state.tallies[key] ?? { attempts: 0, correct: 0 };
          return { tallies: { ...state.tallies, [key]: { attempts: t.attempts + 1, correct: t.correct + (correct ? 1 : 0) } } };
        }),
      clear: () => set({ tallies: {} }),
    }),
    { name: "fretlight.ear-training", version: 1 },
  ),
);
