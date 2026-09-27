"use client";

import {
  type Chord,
  type Fretboard,
  type Scale,
  createFretboard,
  getChord,
  getInstrument,
  getScale,
  getTuning,
} from "@fretlight/core";
import { useMemo } from "react";
import { useSession } from "@/store/session";

export interface FretboardContext {
  readonly board: Fretboard;
  readonly scale: Scale;
  readonly chord: Chord;
  readonly instrumentName: string;
  readonly instrumentKind: "guitar" | "bass";
}

/**
 * Derives the board, scale and chord from session selection.
 *
 * All of this is pure computation over `@fretlight/core`, so it is memoised on
 * the four inputs that can change it rather than recomputed on every render —
 * a full 24-fret scale projection is a few hundred objects.
 */
export function useFretboardContext(): FretboardContext {
  const instrumentId = useSession((s) => s.instrumentId);
  const tuningId = useSession((s) => s.tuningId);
  const fretCount = useSession((s) => s.fretCount);
  const root = useSession((s) => s.root);
  const scaleId = useSession((s) => s.scaleId);
  const chordId = useSession((s) => s.chordId);

  return useMemo(() => {
    const instrument = getInstrument(instrumentId) ?? getInstrument("bass-4")!;
    // Fall back to the instrument's standard tuning if a persisted tuning id no
    // longer matches the selected instrument (e.g. after switching guitar→bass).
    const tuning =
      getTuning(tuningId)?.stringCount === instrument.stringCount
        ? getTuning(tuningId)!
        : getTuning(instrument.kind === "bass" ? `bass-${instrument.stringCount}-standard` : "guitar-6-standard")!;

    return {
      board: createFretboard(tuning, fretCount),
      scale: getScale(root, scaleId)!,
      chord: getChord(root, chordId)!,
      instrumentName: instrument.name,
      instrumentKind: instrument.kind,
    };
  }, [instrumentId, tuningId, fretCount, root, scaleId, chordId]);
}
