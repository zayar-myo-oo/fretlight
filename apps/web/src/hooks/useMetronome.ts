"use client";

import { type ClickEvent, type MetronomeSettings } from "@fretlight/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { MetronomeEngine } from "@/lib/audio/metronome-engine";
import { useSession } from "@/store/session";

export interface MetronomeController {
  readonly isRunning: boolean;
  /** The most recent click, for flashing the beat indicator. */
  readonly beat: ClickEvent | null;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => Promise<void>;
  /** Audio-clock time, shared with practice grading. */
  now: () => number;
  /** The audio-clock instant beat zero falls on — start a timed exercise's clock here, not at `now()`. */
  startedAt: () => number;
  onBeat: (listener: (event: ClickEvent) => void) => () => void;
}

/**
 * Binds the metronome engine to session settings.
 *
 * The engine is created lazily and kept in a ref: re-creating an AudioContext
 * on every render would leak contexts and Safari caps how many a page may open.
 */
export function useMetronome(): MetronomeController {
  const bpm = useSession((s) => s.bpm);
  const timeSignature = useSession((s) => s.timeSignature);
  const subdivision = useSession((s) => s.subdivision);
  const accentFirstBeat = useSession((s) => s.accentFirstBeat);
  const volume = useSession((s) => s.metronomeVolume);

  const engineRef = useRef<MetronomeEngine | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [beat, setBeat] = useState<ClickEvent | null>(null);

  const settings: MetronomeSettings = { bpm, timeSignature, subdivision, accentFirstBeat };

  if (engineRef.current === null && typeof window !== "undefined") {
    engineRef.current = new MetronomeEngine(settings);
  }

  useEffect(() => {
    engineRef.current?.update(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm, timeSignature.beats, timeSignature.value, subdivision, accentFirstBeat]);

  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const unsubscribe = engine.onBeat(setBeat);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    await engineRef.current?.start();
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    setIsRunning(false);
    setBeat(null);
  }, []);

  const toggle = useCallback(async () => {
    if (engineRef.current?.isRunning) stop();
    else await start();
  }, [start, stop]);

  const now = useCallback(() => engineRef.current?.now() ?? 0, []);
  const startedAt = useCallback(() => engineRef.current?.startedAt ?? 0, []);
  const onBeat = useCallback(
    (listener: (event: ClickEvent) => void) => engineRef.current?.onBeat(listener) ?? (() => {}),
    [],
  );

  return { isRunning, beat, start, stop, toggle, now, startedAt, onBeat };
}
