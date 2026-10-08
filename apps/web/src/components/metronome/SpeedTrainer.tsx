"use client";

import type { ClickEvent } from "@fretlight/core";
import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { useTx } from "@/lib/i18n/locale";
import { useSession } from "@/store/session";

/**
 * Tempo ramp: raise (or lower) the BPM by a step every few bars until a goal,
 * e.g. 80 → 85 → 90 → 95. It counts bars on the metronome's own clock, so the
 * change always lands on a downbeat.
 */
export function SpeedTrainer({ beat, running }: { beat: ClickEvent | null; running: boolean }) {
  const x = useTx();
  const bpm = useSession((s) => s.bpm);
  const setBpm = useSession((s) => s.setBpm);
  const [on, setOn] = useState(false);
  const [step, setStep] = useState(5);
  const [every, setEvery] = useState(4);
  const [goal, setGoal] = useState(() => Math.min(240, bpm + 20));
  const lastBar = useRef(-1);

  useEffect(() => {
    if (!on || !running || !beat || beat.beat !== 1 || beat.step !== 0) return;
    if (beat.bar === 0 || beat.bar === lastBar.current || beat.bar % every !== 0) return;
    lastBar.current = beat.bar;
    const current = useSession.getState().bpm;
    const up = goal >= current;
    const nextBpm = up ? Math.min(goal, current + step) : Math.max(goal, current - step);
    if (nextBpm !== current) setBpm(nextBpm);
  }, [beat, on, running, every, step, goal, setBpm]);

  const reached = on && bpm === goal;

  return (
    <Panel title={x("Speed trainer")}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-ink-dim)]">
          {x("Starts at the current tempo and moves toward your goal a little at a time. Play cleanly at each step before it speeds up.")}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Num label={x("Change by (BPM)")} value={step} min={1} max={20} onChange={setStep} />
          <Num label={x("Every (bars)")} value={every} min={1} max={16} onChange={setEvery} />
          <Num label={x("Goal BPM")} value={goal} min={30} max={240} onChange={setGoal} />
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={on} onChange={(e) => { lastBar.current = -1; setOn(e.target.checked); }} className="h-5 w-5 accent-[var(--color-signal)]" />
          {x("Speed trainer on")}
        </label>
        {on && (
          <p className="readout text-sm text-[var(--color-signal)]" role="status">
            {reached ? x("✓ Goal reached: {bpm} BPM", { bpm }) : x("{bpm} BPM → {goal} BPM", { bpm, goal })}
            {!running && !reached ? ` · ${x("press Start")}` : ""}
          </p>
        )}
      </div>
    </Panel>
  );
}

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="hud-label">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="h-11 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-base"
      />
    </label>
  );
}
