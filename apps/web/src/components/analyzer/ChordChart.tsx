"use client";

import { type ChartSection, type ChordDetection, type MusicKey, formatTimestamp, spellChord } from "@fretlight/core";
import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/ui/cn";

/** The song as a lead sheet: each section a heading, then rows of four bars. */
export function ChordChart({
  chart,
  chords,
  keyInfo,
  activeChord,
  activeSection,
  onSeek,
  onSelectChord,
  sectionLink,
}: {
  chart: readonly ChartSection[];
  chords: readonly ChordDetection[];
  keyInfo: MusicKey | null;
  activeChord: number;
  activeSection: number;
  onSeek: (seconds: number) => void;
  onSelectChord: (index: number) => void;
  /** Where "Practice this section" goes, or null when the section has no progression. */
  sectionLink?: (index: number) => string | null;
}) {
  return (
    <Panel title="3 · Chord chart" meta={<span className="text-[11px] text-[var(--color-ink-faint)]">Tap a bar or heading to jump there</span>}>
      <div className="flex flex-col gap-6">
        {chart.map(({ section, rows }, s) => {
          const practice = sectionLink?.(s) ?? null;
          return (
          <section key={s}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
            <button
              onClick={() => onSeek(section.start)}
              className={cn(
                "mb-2 flex items-baseline gap-3 text-left",
                s === activeSection ? "text-[var(--color-signal)]" : "text-[var(--color-theory-bright)]",
              )}
            >
              <span className="readout text-sm font-semibold tracking-wide uppercase">{section.label}</span>
              <span className="readout text-[11px] text-[var(--color-ink-faint)]">
                {formatTimestamp(section.start)} – {formatTimestamp(section.end)}
              </span>
            </button>
            {practice && (
              <Link href={practice} className="text-[11px] text-[var(--color-ink-dim)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-signal)]">
                Practice this section →
              </Link>
            )}
            </div>
            <div className="flex flex-col gap-1.5">
              {rows.map((row, r) => (
                <div key={r} className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {row.map((bar, b) => {
                    const first = bar.chordIndexes[0];
                    const active = bar.chordIndexes.includes(activeChord);
                    return (
                      <button
                        key={b}
                        onClick={() => {
                          if (first !== undefined) onSelectChord(first);
                          onSeek(first !== undefined ? chords[first]!.start : bar.start);
                        }}
                        className={cn(
                          "readout flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-2 py-2 text-base font-semibold transition-colors",
                          active
                            ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.14)] text-[var(--color-ink)]"
                            : "border-[var(--color-hairline)] bg-[var(--color-void)] text-[var(--color-ink-dim)] hover:border-[var(--color-hairline-bright)]",
                        )}
                      >
                        {bar.chordIndexes.length === 0 ? (
                          <span className="text-[var(--color-ink-faint)]">–</span>
                        ) : (
                          bar.chordIndexes.map((i) => (
                            <span key={i} className={chords[i]!.edited ? "text-[var(--color-theory-bright)]" : undefined}>
                              {spellChord(chords[i]!, keyInfo)}
                            </span>
                          ))
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        );
        })}
      </div>
    </Panel>
  );
}
