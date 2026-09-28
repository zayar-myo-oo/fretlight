"use client";

import Link from "next/link";
import { INSTRUMENTS, getInstrument, tuningsFor } from "@fretlight/core";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { Stat } from "@/components/ui/Stat";
import { useMounted } from "@/hooks/useMounted";
import { useSession } from "@/store/session";
import { summarise, useProgress } from "@/store/progress";
import { cn } from "@/lib/ui/cn";
import { NAV_ITEMS } from "@/components/layout/nav";

export default function HomePage() {
  const mounted = useMounted();
  const instrumentId = useSession((s) => s.instrumentId);
  const tuningId = useSession((s) => s.tuningId);
  const setInstrument = useSession((s) => s.setInstrument);
  const setTuning = useSession((s) => s.setTuning);
  const records = useProgress((s) => s.records);

  const instrument = getInstrument(instrumentId);
  const tunings = instrument ? tuningsFor(instrument.kind, instrument.stringCount) : [];
  const summary = summarise(records);

  return (
    <div className="flex flex-col gap-6">
      <section className="animate-rise">
        <Badge tone="signal" className="mb-4">
          Phase 1 · local engine online
        </Badge>
        <h1 className="text-gradient max-w-3xl text-4xl leading-[1.08] font-semibold tracking-tight md:text-6xl">
          Play. It listens, understands and shows you where you are.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-dim)] md:text-base">
          Pitch detection, music theory, fretboard geometry and timing all run on this
          device. No round trip, no model call, no network — the practice loop stays
          under your fingers.
        </p>
      </section>

      <Panel title="Choose your instrument">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {INSTRUMENTS.map((option) => {
            const active = mounted && option.id === instrumentId;
            return (
              <button
                key={option.id}
                onClick={() => setInstrument(option.id)}
                className={cn(
                  "group flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all duration-200",
                  active
                    ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.08)] glow-signal"
                    : "border-[var(--color-hairline)] bg-[var(--color-void)] hover:border-[var(--color-hairline-bright)] hover:bg-[var(--color-panel-raised)]",
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-semibold">{option.name}</span>
                  <span className="readout text-[10px] text-[var(--color-ink-faint)]">
                    {option.stringCount} str
                  </span>
                </div>
                <span className="text-xs text-[var(--color-ink-faint)]">{option.description}</span>
                <span className="readout mt-1 text-[10px] tracking-wider text-[var(--color-ink-faint)] uppercase">
                  detection range {option.minFrequency}–{option.maxFrequency} Hz
                </span>
              </button>
            );
          })}
        </div>

        {mounted && tunings.length > 0 && (
          <div className="mt-5 border-t border-[var(--color-hairline)] pt-4">
            <h3 className="hud-label mb-3">Tuning</h3>
            <div className="flex flex-wrap gap-2">
              {tunings.map((tuning) => {
                const active = tuning.id === tuningId;
                return (
                  <button
                    key={tuning.id}
                    onClick={() => setTuning(tuning.id)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2 transition-all",
                      active
                        ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)]"
                        : "border-[var(--color-hairline)] hover:border-[var(--color-hairline-bright)]",
                    )}
                  >
                    <span className="text-xs font-medium">{tuning.name}</span>
                    <span className="readout text-[10px] text-[var(--color-ink-faint)]">
                      {tuning.strings.join(" ")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Panel title="Where to start">
          <div className="grid gap-3 sm:grid-cols-2">
            {NAV_ITEMS.filter((item) => item.href !== "/").map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center gap-3 rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-4 transition-all hover:border-[var(--color-hairline-bright)] hover:bg-[var(--color-panel-raised)]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel)] text-[var(--color-signal)] transition-colors group-hover:border-[var(--color-signal)]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d={item.icon} />
                  </svg>
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xs text-[var(--color-ink-faint)]">{item.hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel
          title="Your progress"
          meta={
            <>
              <Badge tone="neutral">stored on device</Badge>
              <Link href="/progress" className="hud-label text-[var(--color-signal)] hover:underline">
                View all →
              </Link>
            </>
          }
        >
          {!mounted ? (
            <div className="h-24" />
          ) : summary.sessions === 0 ? (
            <p className="text-sm leading-relaxed text-[var(--color-ink-faint)]">
              No sessions yet. Finish a run in the practice trainer and it will be recorded
              here — locally, with nothing uploaded.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-5">
              <Stat label="Sessions" value={summary.sessions} />
              <Stat label="Practice time" value={summary.totalMinutes} unit="min" />
              <Stat
                label="Avg accuracy"
                value={`${Math.round(summary.averageAccuracy * 100)}%`}
                tone="signal"
              />
              <Stat label="Streak" value={summary.streakDays} unit="days" tone="correct" />
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Capability levels">
        <div className="grid gap-3 md:grid-cols-4">
          {[
            { level: "Level 1", title: "Microphone", detail: "Tuner, note detection, scale practice", state: "Phase 2" },
            { level: "Level 2", title: "+ Camera", detail: "Hand tracking, fretboard detection", state: "Phase 5" },
            { level: "Level 3", title: "+ GPU", detail: "3D holographic fretboard", state: "Phase 6" },
            { level: "Level 4", title: "+ Cloud AI", detail: "Tutor, plans, analysis — optional", state: "Phase 7" },
          ].map((item, index) => (
            <div
              key={item.level}
              className="rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="hud-label">{item.level}</span>
                <Badge tone={index === 0 ? "signal" : "neutral"}>{item.state}</Badge>
              </div>
              <p className="text-sm font-medium">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-faint)]">{item.detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Each level degrades to the one below it. Nothing in levels 1–3 needs the network,
          and level 4 never sits in the real-time path.
        </p>
      </Panel>
    </div>
  );
}
