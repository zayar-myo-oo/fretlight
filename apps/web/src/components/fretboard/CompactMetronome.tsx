"use client";

import { useState } from "react";
import { MIN_BPM, MAX_BPM } from "@fretlight/core";
import { Button } from "@/components/ui/Button";
import { useMetronome } from "@/hooks/useMetronome";
import { useMounted } from "@/hooks/useMounted";
import { useTx } from "@/lib/i18n/locale";
import { useSession } from "@/store/session";

/** Rhythm support stays beside the neck, without a separate tool screen. */
export function CompactMetronome() {
  const x = useTx();
  const mounted = useMounted();
  const bpm = useSession(s => s.bpm);
  const setBpm = useSession(s => s.setBpm);
  const { isRunning, beat, toggle } = useMetronome();
  const [error, setError] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-panel)] px-4 py-3">
      <span className="text-sm font-medium">{x("Metronome")}</span>
      <label className="flex items-center gap-2">
        <input type="number" aria-label={x("Tempo")} min={MIN_BPM} max={MAX_BPM} value={mounted ? bpm : 90}
          onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) setBpm(e.target.valueAsNumber); }}
          className="readout h-9 w-20 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-void)] px-2 text-sm" />
        <span className="text-xs text-[var(--color-ink-dim)]">BPM</span>
      </label>
      <Button size="sm" variant={isRunning ? "secondary" : "primary"} aria-pressed={isRunning}
        onClick={() => { setError(false); void toggle().catch(() => setError(true)); }}>
        {x(isRunning ? "Stop" : "Start")}
      </Button>
      <span className="readout text-xs text-[var(--color-signal)]" role="status">
        {isRunning ? `${x("Beat")} ${beat?.beat ?? 1}` : x("Off")}
      </span>
      {error && <p role="alert" className="text-xs text-[var(--color-error)]">{x("Audio could not start. Try again.")}</p>}
    </div>
  );
}
