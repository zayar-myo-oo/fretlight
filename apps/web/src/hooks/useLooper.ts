"use client";

import { type Progression, chordAtBeat } from "@fretlight/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LooperEngine, type LooperState } from "@/lib/looper/looper-engine";

/** One looper engine for the life of the component, with its state as React state. */
export function useLooper(): { engine: LooperEngine; state: LooperState } {
  const ref = useRef<LooperEngine | null>(null);
  if (ref.current === null) ref.current = new LooperEngine();
  const engine = ref.current;
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);

  // React may mount, unmount and remount an effect in development; only a real
  // unmount (still unmounted a tick later) should release the microphone.
  const mounted = useRef(false);
  useEffect(() => {
    // Development only: lets the looper be driven from the console with a synthetic input.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __looper?: LooperEngine }).__looper = engine;
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current) engine.dispose();
      }, 0);
    };
  }, [engine]);

  return { engine, state };
}

export interface ClockReading {
  readonly bar: number;
  readonly beat: number;
  readonly totalBars: number;
  /** Index of the progression chord sounding now, or -1 when the loop is not running. */
  readonly chordIndex: number;
}

const IDLE: ClockReading = { bar: 0, beat: 0, totalBars: 0, chordIndex: -1 };

/**
 * The loop's bar / beat / chord, updated as they change (not every frame, so the
 * page stays light). Chords repeat across the loop: the progression is assumed
 * to start on the first beat of the loop.
 */
export function useLoopClock(engine: LooperEngine, progression: Progression | null, running: boolean): ClockReading {
  const [reading, setReading] = useState<ClockReading>(IDLE);
  const last = useRef<ClockReading>(IDLE);

  useEffect(() => {
    if (!running) {
      last.current = IDLE;
      setReading(IDLE);
      return;
    }
    let frame = 0;
    const tick = () => {
      const info = engine.barPosition();
      if (info) {
        const chord = progression && progression.chords.length > 0 ? chordAtBeat(progression, info.beats) : null;
        const next: ClockReading = { bar: info.bar, beat: info.beat, totalBars: info.totalBars, chordIndex: chord ? chord.index : -1 };
        const prev = last.current;
        if (next.bar !== prev.bar || next.beat !== prev.beat || next.chordIndex !== prev.chordIndex || next.totalBars !== prev.totalBars) {
          last.current = next;
          setReading(next);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine, progression, running]);

  return reading;
}
