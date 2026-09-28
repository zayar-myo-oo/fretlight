"use client";

import { useCallback, useEffect, useRef } from "react";
import { ChimePlayer } from "@/lib/audio/chime-player";

/**
 * After this many confirmations *in a row on the same note*, switch from the
 * normal clip to the more insistent "mid" one.
 */
const MID_AFTER = 3;
/** And past this many, the most insistent "high" clip. */
const HIGH_AFTER = 6;

export interface TunerChimeController {
  /**
   * Call once per string landing in tune (the caller debounces to the
   * false→true edge; this hook only decides *which* clip that earns).
   * Repeating the *same* note escalates normal → mid → high; tuning a
   * different string resets back to normal.
   */
  notifyInTune: (midi: number) => void;
}

/**
 * Escalating "you're already in tune" feedback.
 *
 * A single chime is a fine one-off confirmation, but a player who keeps
 * replaying a string that is already correct is usually asking "is this
 * really right?" rather than just confirming a fresh tune — so the response
 * gets louder/more insistent the more times running they hear it on the
 * *same* note, and drops back to the gentle clip the moment they move to a
 * different string.
 */
export function useTunerChime(): TunerChimeController {
  const playerRef = useRef<ChimePlayer | null>(null);
  const lastMidiRef = useRef<number | null>(null);
  const repeatCountRef = useRef(0);

  if (playerRef.current === null && typeof window !== "undefined") {
    playerRef.current = new ChimePlayer();
  }

  useEffect(() => {
    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  const notifyInTune = useCallback((midi: number) => {
    if (lastMidiRef.current === midi) {
      repeatCountRef.current += 1;
    } else {
      lastMidiRef.current = midi;
      repeatCountRef.current = 1;
    }

    const level = repeatCountRef.current >= HIGH_AFTER ? "high" : repeatCountRef.current >= MID_AFTER ? "mid" : "normal";
    void playerRef.current?.play(level);
  }, []);

  return { notifyInTune };
}
