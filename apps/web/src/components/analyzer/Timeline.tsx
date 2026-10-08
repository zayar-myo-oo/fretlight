"use client";

import { type AnalysisSection, type ChordDetection, type MusicKey, formatTimestamp, spellChord } from "@fretlight/core";
import { cn } from "@/lib/ui/cn";

const SECTION_COLORS: Record<string, string> = {
  intro: "bg-[rgba(148,176,255,0.18)] border-[rgba(148,176,255,0.4)]",
  verse: "bg-[rgba(139,124,255,0.22)] border-[rgba(139,124,255,0.55)]",
  "pre-chorus": "bg-[rgba(255,180,84,0.18)] border-[rgba(255,180,84,0.5)]",
  chorus: "bg-[rgba(34,224,214,0.2)] border-[rgba(34,224,214,0.6)]",
  bridge: "bg-[rgba(255,92,138,0.18)] border-[rgba(255,92,138,0.5)]",
  outro: "bg-[rgba(148,176,255,0.12)] border-[rgba(148,176,255,0.3)]",
  unknown: "bg-[rgba(255,255,255,0.05)] border-[var(--color-hairline-bright)]",
};

/** Section bar and chord bar on one shared time axis, with the playhead across both. */
export function Timeline({
  duration,
  time,
  sections,
  chords,
  keyInfo,
  activeChord,
  onSeek,
  onSelectChord,
}: {
  duration: number;
  time: number;
  sections: readonly AnalysisSection[];
  chords: readonly ChordDetection[];
  keyInfo: MusicKey | null;
  activeChord: number;
  onSeek: (seconds: number) => void;
  onSelectChord: (index: number) => void;
}) {
  const pct = (seconds: number) => `${(seconds / duration) * 100}%`;
  const ticks = Array.from({ length: Math.floor(duration / 30) + 1 }, (_, i) => i * 30).filter((t) => t < duration);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-5 text-[10px] text-[var(--color-ink-faint)]">
        {ticks.map((t) => (
          <span key={t} className="readout absolute -translate-x-1/2" style={{ left: pct(t) }}>
            {formatTimestamp(t)}
          </span>
        ))}
      </div>

      <div className="relative">
        <div className="flex h-9 overflow-hidden rounded-lg border border-[var(--color-hairline)]">
          {sections.map((section, i) => (
            <button
              key={i}
              onClick={() => onSeek(section.start)}
              title={`${section.label} · ${formatTimestamp(section.start)}`}
              style={{ width: pct(section.end - section.start) }}
              className={cn(
                "readout truncate border-r px-2 text-[10px] tracking-wide uppercase transition-colors last:border-r-0 hover:brightness-125",
                SECTION_COLORS[section.type],
              )}
            >
              {section.label}
            </button>
          ))}
        </div>

        <div className="mt-1 flex h-9 overflow-hidden rounded-lg border border-[var(--color-hairline)]">
          {chords.map((chord, i) => {
            const label = spellChord(chord, keyInfo);
            return (
              <button
                key={i}
                onClick={() => {
                  onSelectChord(i);
                  onSeek(chord.start);
                }}
                title={`${label ?? "No clear chord"} · ${formatTimestamp(chord.start)}`}
                style={{ width: pct(chord.end - chord.start) }}
                className={cn(
                  "readout truncate border-r border-[var(--color-hairline)] text-[11px] transition-colors last:border-r-0",
                  i === activeChord
                    ? "bg-[rgba(34,224,214,0.25)] text-[var(--color-ink)]"
                    : label
                      ? "bg-[var(--color-void)] text-[var(--color-ink-dim)] hover:bg-[var(--color-panel-raised)]"
                      : "bg-[rgba(255,255,255,0.02)] text-[var(--color-ink-faint)] hover:bg-[var(--color-panel-raised)]",
                )}
              >
                {label ?? "·"}
              </button>
            );
          })}
        </div>

        <div
          className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
          style={{ left: pct(Math.min(time, duration)) }}
        />
      </div>
    </div>
  );
}
