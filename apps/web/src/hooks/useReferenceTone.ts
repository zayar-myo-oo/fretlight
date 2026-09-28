"use client";

import { useCallback, useEffect, useRef } from "react";
import { ReferenceToneEngine } from "@/lib/audio/reference-tone-engine";
import { useSession } from "@/store/session";

export interface ReferenceToneController {
  /** Sounds the target pitch for `midi` so you can tune by ear against it. */
  playString: (midi: number) => Promise<void>;
  stop: () => void;
}

/**
 * Binds the reference-tone engine to the session's reference pitch (A4).
 *
 * Same ref-held-engine lifecycle as `useMetronome`: the AudioContext is
 * created once, on first use, and disposed on unmount.
 */
export function useReferenceTone(): ReferenceToneController {
  const a4 = useSession((s) => s.a4);
  const engineRef = useRef<ReferenceToneEngine | null>(null);

  if (engineRef.current === null && typeof window !== "undefined") {
    engineRef.current = new ReferenceToneEngine();
  }

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const playString = useCallback(
    async (midi: number) => {
      await engineRef.current?.playNote(midi, a4);
    },
    [a4],
  );

  const stop = useCallback(() => {
    engineRef.current?.stop();
  }, []);

  return { playString, stop };
}
