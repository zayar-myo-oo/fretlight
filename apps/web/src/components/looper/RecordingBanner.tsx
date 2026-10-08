"use client";

import { secondsPerBar } from "@fretlight/core";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { LooperEngine, LooperState } from "@/lib/looper/looper-engine";
import { useTx } from "@/lib/i18n/locale";
import { cn } from "@/lib/ui/cn";

const clock = (seconds: number) => {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s * 10) % 10)}`;
};

/**
 * The one thing on screen while recording. It stays pinned to the top of the
 * viewport, so a player scrolled anywhere on the page can always tell whether
 * the looper is waiting, counting in, or actually recording, and can stop it.
 */
export function RecordingBanner({ engine, state, onStop }: { engine: LooperEngine; state: LooperState; onStop: () => void }) {
  const { recording, phase, settings, loopSeconds } = state;
  const [now, setNow] = useState(0);
  const x = useTx();

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setNow(engine.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine]);

  // Show it in the tab title too, for anyone who has switched windows.
  useEffect(() => {
    const original = document.title;
    document.title = x(phase === "recording" ? "● Recording… Fretlight" : "Get ready… Fretlight");
    return () => {
      document.title = original;
    };
  }, [phase, x]);

  if (!recording) return null;
  const counting = phase === "counting";
  const remaining = recording.startsAt - now;
  const elapsed = now - recording.startsAt;
  const bar = secondsPerBar(settings.bpm, settings.beatsPerBar);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "sticky top-3 z-30 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border-2 px-5 py-4 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur",
        counting
          ? "border-[#ffb454] bg-[rgba(40,28,8,0.92)]"
          : "border-[var(--color-error)] bg-[rgba(48,10,18,0.92)]",
      )}
    >
      {counting ? (
        <>
          <span className="readout w-16 text-center text-6xl leading-none font-bold text-[#ffb454]">
            {remaining > 0.02 ? settings.beatsPerBar - ((Math.max(1, Math.ceil(remaining / (60 / settings.bpm) - 0.001)) - 1) % settings.beatsPerBar) : x("GO")}
          </span>
          <div className="min-w-[200px] flex-1">
            <p className="text-lg font-semibold">{x("Get ready…")}</p>
            <p className="text-sm text-[var(--color-ink-dim)]">
              {recording.master ? x("Recording starts after the count-in. Play your chords, then press Stop.") : x("Recording “{name}” starts when the loop comes round. Play along.", { name: recording.name })}
            </p>
          </div>
        </>
      ) : (
        <>
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 animate-pulse rounded-full bg-[var(--color-error)]" />
            <span className="text-2xl font-bold tracking-wide text-[var(--color-error)]">REC</span>
          </span>
          <span className="readout text-3xl">{recording.master ? clock(elapsed) : `${clock(Math.min(elapsed, loopSeconds ?? elapsed))} / ${clock(loopSeconds ?? 0)}`}</span>
          <div className="min-w-[200px] flex-1">
            <p className="text-lg font-semibold">
              {recording.master ? x("Recording: bar {n}", { n: Math.max(1, Math.floor(elapsed / bar) + 1) }) : x("Recording “{name}”", { name: recording.name })}
            </p>
            <p className="text-sm text-[var(--color-ink-dim)]">
              {recording.master
                ? x("Play now. Press Stop right after your last chord; it rounds to whole bars.")
                : x("Play now. It records one full loop, then stops by itself.")}
            </p>
            {!recording.master && loopSeconds ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.1)]">
                <div className="h-full bg-[var(--color-error)]" style={{ width: `${Math.min(100, Math.max(0, (elapsed / loopSeconds) * 100))}%` }} />
              </div>
            ) : null}
          </div>
        </>
      )}
      <Button size="lg" variant={counting ? "secondary" : "danger"} onClick={onStop}>
        {x(counting ? "Cancel" : recording.master ? "■ Stop & loop" : "■ Cancel take")}
      </Button>
    </div>
  );
}
