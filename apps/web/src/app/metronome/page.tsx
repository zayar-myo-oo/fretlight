"use client";

import {
  MAX_BPM,
  MIN_BPM,
  SUBDIVISION_LABELS,
  type Subdivision,
  TapTempo,
} from "@fretlight/core";
import { useCallback, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Slider } from "@/components/ui/Slider";
import { SpeedTrainer } from "@/components/metronome/SpeedTrainer";
import { useKeyboard } from "@/hooks/useKeyboard";
import { useMetronome } from "@/hooks/useMetronome";
import { useMounted } from "@/hooks/useMounted";
import { useSession } from "@/store/session";
import { cn } from "@/lib/ui/cn";

const TIME_SIGNATURES = [
  { beats: 4, value: 4 },
  { beats: 3, value: 4 },
  { beats: 2, value: 4 },
  { beats: 6, value: 8 },
  { beats: 5, value: 4 },
  { beats: 7, value: 8 },
] as const;

export default function MetronomePage() {
  const mounted = useMounted();
  const bpm = useSession((s) => s.bpm);
  const setBpm = useSession((s) => s.setBpm);
  const timeSignature = useSession((s) => s.timeSignature);
  const subdivision = useSession((s) => s.subdivision);
  const accentFirstBeat = useSession((s) => s.accentFirstBeat);
  const volume = useSession((s) => s.metronomeVolume);
  const patch = useSession((s) => s.patch);

  const { isRunning, beat, toggle, stop } = useMetronome();
  const tapRef = useRef(new TapTempo());
  const [tapHint, setTapHint] = useState<string | null>(null);

  const tap = useCallback(() => {
    const detected = tapRef.current.tap(performance.now() / 1000);
    if (detected === null) {
      setTapHint("keep tapping…");
      return;
    }
    setBpm(detected);
    setTapHint(`${detected} BPM`);
  }, [setBpm]);

  useKeyboard({
    " ": () => void toggle(),
    Space: () => void toggle(),
    ArrowUp: () => setBpm(bpm + 1),
    ArrowDown: () => setBpm(bpm - 1),
    ArrowRight: () => setBpm(bpm + 5),
    ArrowLeft: () => setBpm(bpm - 5),
    t: tap,
    T: tap,
  });

  const beats = useMemo(
    () => Array.from({ length: timeSignature.beats }, (_, i) => i + 1),
    [timeSignature.beats],
  );

  const currentBeat = isRunning ? (beat?.beat ?? null) : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Metronome</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
            Scheduled on the audio clock, not on a timer — tempo stays exact while the rest
            of the page renders.
          </p>
        </div>
        <Badge tone={isRunning ? "signal" : "neutral"}>{isRunning ? "running" : "stopped"}</Badge>
      </header>

      <Panel>
        <div className="flex flex-col items-center gap-8 py-6">
          {/* Beat indicator */}
          <div className="flex items-center gap-3">
            {beats.map((value) => {
              const active = currentBeat === value;
              const downbeat = value === 1 && accentFirstBeat;
              return (
                <span
                  key={value}
                  className={cn(
                    "flex items-center justify-center rounded-full border transition-all duration-75",
                    downbeat ? "h-14 w-14" : "h-11 w-11",
                    active
                      ? downbeat
                        ? "scale-110 border-[var(--color-root)] bg-[rgba(255,92,138,0.3)] glow-root"
                        : "scale-110 border-[var(--color-signal)] bg-[rgba(34,224,214,0.25)] glow-signal"
                      : "border-[var(--color-hairline)] bg-[var(--color-void)]",
                  )}
                >
                  <span
                    className={cn(
                      "readout text-sm font-semibold transition-colors",
                      active ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)]",
                    )}
                  >
                    {value}
                  </span>
                </span>
              );
            })}
          </div>

          {/* Tempo */}
          <div className="flex flex-col items-center gap-1">
            <span className="readout text-[clamp(4rem,13vw,8rem)] leading-none font-semibold tabular-nums">
              {mounted ? bpm : "—"}
            </span>
            <span className="hud-label">beats per minute</span>
          </div>

          <div className="flex w-full max-w-2xl flex-col gap-4">
            <Slider min={MIN_BPM} max={MAX_BPM} value={bpm} onChange={setBpm} aria-label="Tempo" />
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" onClick={() => setBpm(bpm - 5)}>−5</Button>
              <Button size="sm" onClick={() => setBpm(bpm - 1)}>−1</Button>
              <Button variant="primary" size="lg" onClick={() => void toggle()} className="min-w-[132px]">
                {isRunning ? "Stop" : "Start"}
              </Button>
              <Button size="sm" onClick={() => setBpm(bpm + 1)}>+1</Button>
              <Button size="sm" onClick={() => setBpm(bpm + 5)}>+5</Button>
            </div>
            <div className="flex items-center justify-center gap-3">
              <Button variant="ghost" size="sm" onClick={tap}>
                Tap tempo
              </Button>
              {tapHint && <span className="readout text-[11px] text-[var(--color-ink-faint)]">{tapHint}</span>}
            </div>
          </div>
        </div>
      </Panel>

      <SpeedTrainer beat={beat} running={isRunning} />

      <div className="grid gap-6 md:grid-cols-3">
        <Panel title="Time signature">
          <div className="flex flex-wrap gap-2">
            {TIME_SIGNATURES.map((signature) => {
              const active =
                signature.beats === timeSignature.beats && signature.value === timeSignature.value;
              return (
                <button
                  key={`${signature.beats}/${signature.value}`}
                  onClick={() => patch({ timeSignature: { ...signature } })}
                  className={cn(
                    "readout rounded-xl border px-3.5 py-2 text-sm transition-all",
                    active
                      ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)] text-[var(--color-signal)]"
                      : "border-[var(--color-hairline)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]",
                  )}
                >
                  {signature.beats}/{signature.value}
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Subdivision">
          <SegmentedControl
            className="w-full"
            options={(Object.keys(SUBDIVISION_LABELS) as Subdivision[]).map((id) => ({
              value: id,
              label: SUBDIVISION_LABELS[id],
            }))}
            value={subdivision}
            onChange={(value) => patch({ subdivision: value })}
          />
          <label className="mt-4 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={accentFirstBeat}
              onChange={(event) => patch({ accentFirstBeat: event.target.checked })}
              className="h-4 w-4 accent-[var(--color-signal)]"
            />
            <span className="text-xs text-[var(--color-ink-dim)]">Accent the downbeat</span>
          </label>
        </Panel>

        <Panel title="Level">
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(value) => patch({ metronomeVolume: value })}
            label={`Click volume ${Math.round(volume * 100)}%`}
          />
          <dl className="mt-5 space-y-2 text-[11px] text-[var(--color-ink-faint)]">
            <Shortcut keys="Space" action="start / stop" />
            <Shortcut keys="↑ ↓" action="±1 BPM" />
            <Shortcut keys="← →" action="±5 BPM" />
            <Shortcut keys="T" action="tap tempo" />
          </dl>
          <Button variant="ghost" size="sm" className="mt-4" onClick={stop}>
            Reset transport
          </Button>
        </Panel>
      </div>
    </div>
  );
}

function Shortcut({ keys, action }: { keys: string; action: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="readout rounded border border-[var(--color-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--color-ink-dim)]">
        {keys}
      </dt>
      <dd>{action}</dd>
    </div>
  );
}
