"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Stat } from "@/components/ui/Stat";
import { useMounted } from "@/hooks/useMounted";
import { type ProgressRange, filterRecordsByRange, summarise, useProgress } from "@/store/progress";
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
  const [range, setRange] = useState<ProgressRange>("week");

  const windowed = useMemo(() => filterRecordsByRange(records, range), [records, range]);
  const summary = useMemo(() => summarise(windowed), [windowed]);
  const streakDays = useMemo(() => summarise(records).streakDays, [records]);

  const recent = windowed.slice(0, 15);

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

      {mounted && records.length > 0 && (
        <button
          onClick={() => {
            if (window.confirm("Clear all locally stored practice history? This cannot be undone.")) clear();
          }}
          className="self-start text-[11px] text-[var(--color-ink-faint)] underline decoration-dotted hover:text-[var(--color-error)]"
        >
          Clear practice history
        </button>
      )}
    </div>
  );
}

function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
