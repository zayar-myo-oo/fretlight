"use client";

import { type Fretboard, createFretboard, defaultTuning } from "@fretlight/core";
import { useMemo } from "react";
import { useFretboardContext } from "@/hooks/useFretboard";

/**
 * The board for the instrument the Companion is writing for. When it matches the
 * instrument chosen on Home, that is the user's own board (their tuning, string
 * count and fret count); otherwise it is the standard tuning for that kind.
 */
export function useCompanionBoard(kind: "guitar" | "bass"): Fretboard {
  const { board, instrumentKind } = useFretboardContext();
  return useMemo(
    () => (instrumentKind === kind ? board : createFretboard(defaultTuning(kind, kind === "bass" ? 4 : 6), board.fretCount)),
    [board, instrumentKind, kind],
  );
}
