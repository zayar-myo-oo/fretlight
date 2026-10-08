"use client";

import { SHARP_NAMES, compareWithPreviousDay, recommendations as buildRecommendations, skillMap } from "@fretlight/core";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Stat } from "@/components/ui/Stat";
import { useMounted } from "@/hooks/useMounted";
import { type ProgressRange, filterRecordsByRange, summarise, useProgress } from "@/store/progress";
import { type WeakSpot, useWeakAreas, weakestSpots } from "@/store/weak-areas";
import { cn } from "@/lib/ui/cn";

const RANGE_LABELS: Record<ProgressRange, string> = {
  today: "Today",
  week: "7 Days",
  month: "30 Days",
  all: "All Time",
};

/**
 * Progress dashboard.
 *
 * `summarise()` runs twice on purpose: once on the full, unfiltered history
 * for `streakDays` (a streak is one running number — it does not reset just
 * because you switched the window you're looking at), and once on the
 * range-filtered records for everything else, which genuinely is scoped to
 * the selected window.
 */
export default function ProgressPage() {
  const mounted = useMounted();
  const records = useProgress((s) => s.records);
  const clear = useProgress((s) => s.clear);
  const weakNotes = useWeakAreas((s) => s.notes);
  const weakPositions = useWeakAreas((s) => s.positions);
  const clearWeakAreas = useWeakAreas((s) => s.clear);
  const [range, setRange] = useState<ProgressRange>("week");

  const windowed = useMemo(() => filterRecordsByRange(records, range), [records, range]);
  const summary = useMemo(() => summarise(windowed), [windowed]);
  const streakDays = useMemo(() => summarise(records).streakDays, [records]);

  const recent = windowed.slice(0, 15);

  // Weak areas are always all-time — the whole point is spotting a pattern
  // that a single week's handful of attempts is too little data to show.
  const weakestNotes = useMemo(() => weakestSpots(weakNotes), [weakNotes]);
  const weakestPositions = useMemo(() => weakestSpots(weakPositions), [weakPositions]);
  const comparison = useMemo(() => (mounted ? compareWithPreviousDay(records) : null), [records, mounted]);
  const skills = useMemo(() => skillMap(records, weakNotes, weakPositions), [records, weakNotes, weakPositions]);
  const nextSteps = useMemo(() => buildRecommendations(records, weakNotes), [records, weakNotes]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Progress</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-dim)]">Stored on this device, nothing uploaded.</p>
        </div>
        <SegmentedControl
          options={(Object.keys(RANGE_LABELS) as ProgressRange[]).map((r) => ({ value: r, label: RANGE_LABELS[r] }))}
          value={range}
          onChange={(value) => setRange(value as ProgressRange)}
        />
      </header>

      <Panel title={RANGE_LABELS[range].toUpperCase()} meta={<Badge tone="neutral">stored on device</Badge>}>
        {!mounted ? (
          <div className="h-24" />
        ) : windowed.length === 0 ? (
          <p className="text-sm leading-relaxed text-[var(--color-ink-faint)]">
            No sessions {range === "all" ? "yet" : `in the last ${RANGE_LABELS[range].toLowerCase()}`}. Finish a
            run in Practice, Song or Bassline and it lands here.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Practice" value={formatDuration(summary.totalMinutes)} />
            <Stat label="Sessions" value={summary.sessions} />
            <Stat label="Accuracy" value={`${Math.round(summary.averageAccuracy * 100)}%`} tone="signal" />
            <Stat label="Timing" value={`${Math.round(summary.averageTimingAccuracy * 100)}%`} tone="signal" />
            <Stat label="Pitch" value={`${Math.round(summary.averagePitchAccuracy * 100)}%`} tone="signal" />
            <Stat label="Streak" value={streakDays} unit="days" tone={streakDays > 0 ? "correct" : "default"} />
          </div>
        )}
      </Panel>

      {(weakestNotes.length > 0 || weakestPositions.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel
            title="Weak notes"
            meta={<span className="hud-label">{Object.values(weakNotes).reduce((n, t) => n + t.attempts, 0)} attempts tracked</span>}
          >
            {weakestNotes.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-faint)]">
                Not enough attempts on any single note yet to say.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {weakestNotes.map((spot) => (
                  <WeakBar key={spot.key} label={SHARP_NAMES[Number(spot.key)]!} spot={spot} />
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Weak positions"
            meta={<span className="hud-label">{Object.values(weakPositions).reduce((n, t) => n + t.attempts, 0)} attempts tracked</span>}
          >
            {weakestPositions.length === 0 ? (
              <p className="text-sm text-[var(--color-ink-faint)]">
                Not enough attempts at any single fret yet to say — this only fills in from
                exercises with a specific target position (Fret drills, Song, Bassline).
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {weakestPositions.map((spot) => {
                  const [string, fret] = spot.key.split(":");
                  return <WeakBar key={spot.key} label={`String ${Number(string) + 1}, fret ${fret}`} spot={spot} />;
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {mounted && (
        <Panel title="What to practise next" meta={<Badge tone="signal">from your own data</Badge>}>
          <div className="grid gap-3 md:grid-cols-2">
            {nextSteps.map((step) => (
              <Link
                key={step.title}
                href={step.href}
                className="flex flex-col gap-1 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-4 transition-colors hover:border-[var(--color-signal)]"
              >
                <span className="text-sm font-semibold">{step.title} →</span>
                <span className="text-xs leading-relaxed text-[var(--color-ink-dim)]">{step.detail}</span>
              </Link>
            ))}
            {nextSteps.length === 0 && (
              <p className="text-sm text-[var(--color-ink-dim)]">Nothing stands out. Keep going, or try a faster tempo in Practice.</p>
            )}
          </div>
        </Panel>
      )}

      {mounted && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Improvement">
            {comparison ? (
              <div className="flex flex-wrap items-end gap-6">
                <Stat label={comparison.previousLabel} value={`${Math.round(comparison.previous * 100)}%`} />
                <Stat label="Today" value={`${Math.round(comparison.today * 100)}%`} tone="signal" />
                <Stat
                  label="Change"
                  value={`${comparison.delta >= 0 ? "+" : ""}${Math.round(comparison.delta * 100)}%`}
                  tone={comparison.delta >= 0 ? "correct" : "default"}
                />
              </div>
            ) : (
              <p className="text-sm text-[var(--color-ink-faint)]">Practise today and on another day to see how you are improving.</p>
            )}
          </Panel>
          <Panel title="Skill map" meta={<span className="hud-label">only what has been measured</span>}>
            <div className="flex flex-col gap-2.5">
              {skills.map((skill) => (
                <div key={skill.id} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-xs">{skill.label}</span>
                  {skill.score === null ? (
                    <span className="text-[11px] text-[var(--color-ink-faint)]">Not enough data yet</span>
                  ) : (
                    <>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-hairline)]" role="meter" aria-valuenow={Math.round(skill.score * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={skill.label}>
                        <div
                          className={cn("h-full rounded-full", skill.score < 0.5 ? "bg-[var(--color-error)]" : skill.score < 0.75 ? "bg-[var(--color-warn)]" : "bg-[var(--color-correct)]")}
                          style={{ width: `${Math.round(skill.score * 100)}%` }}
                        />
                      </div>
                      <span className="readout w-10 text-right text-[11px]">{Math.round(skill.score * 100)}%</span>
                    </>
                  )}
                </div>
              ))}
              <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
                Fills, improvising and chord changes are not scored yet. Practise them in the{" "}
                <Link href="/companion" className="underline">Companion</Link>.
              </p>
            </div>
          </Panel>
        </div>
      )}

      <Panel title="Recent sessions">
        {!mounted || recent.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-faint)]">Nothing here yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--color-hairline)]">
            {recent.map((record) => (
              <div key={record.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[var(--color-ink-dim)]">{record.exercise}</span>
                  <span className="readout text-[10px] text-[var(--color-ink-faint)]">
                    {new Date(record.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                    {record.notesCorrect}/{record.notesTotal} notes · {record.bpm} BPM
                  </span>
                </div>
                <span
                  className={cn(
                    "readout rounded-lg border px-2 py-1 text-[11px]",
                    record.overall >= 0.85
                      ? "border-[rgba(57,224,139,0.35)] text-[var(--color-correct)]"
                      : record.overall >= 0.6
                        ? "border-[rgba(255,194,71,0.35)] text-[var(--color-warn)]"
                        : "border-[rgba(255,84,112,0.35)] text-[var(--color-error)]",
                  )}
                >
                  {Math.round(record.overall * 100)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {mounted && (records.length > 0 || weakestNotes.length > 0 || weakestPositions.length > 0) && (
        <button
          onClick={() => {
            if (window.confirm("Clear all locally stored practice history? This cannot be undone.")) {
              clear();
              clearWeakAreas();
            }
          }}
          className="self-start text-[11px] text-[var(--color-ink-faint)] underline decoration-dotted hover:text-[var(--color-error)]"
        >
          Clear practice history
        </button>
      )}
    </div>
  );
}

function WeakBar({ label, spot }: { label: string; spot: WeakSpot }) {
  const percent = Math.round(spot.accuracy * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="readout w-16 shrink-0 text-xs font-semibold">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-hairline)]">
        <div
          className={cn(
            "h-full rounded-full",
            spot.accuracy < 0.5
              ? "bg-[var(--color-error)]"
              : spot.accuracy < 0.75
                ? "bg-[var(--color-warn)]"
                : "bg-[var(--color-correct)]",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="readout w-20 shrink-0 text-right text-[11px] text-[var(--color-ink-faint)]">
        {percent}% · {spot.attempts}×
      </span>
    </div>
  );
}

function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
