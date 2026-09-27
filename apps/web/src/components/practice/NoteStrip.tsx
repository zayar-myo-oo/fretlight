"use client";

import type { PracticeStep, StepVerdict } from "@fretlight/core";
import { cn } from "@/lib/ui/cn";

/**
 * The horizon: what was just played, what to play now, what comes next.
 * Past notes fade, the current note is bright, upcoming notes stay legible —
 * the "follow the path" reading the whole exercise depends on.
 */
export function NoteStrip({
  steps,
  index,
  verdicts,
}: {
  steps: readonly PracticeStep[];
  index: number;
  verdicts: ReadonlyMap<number, StepVerdict>;
}) {
  const from = Math.max(0, index - 2);
  const window = steps.slice(from, from + 9);

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {window.map((step, offset) => {
        const absolute = from + offset;
        const state =
          absolute === index ? "current" : absolute < index ? (verdicts.get(absolute) ?? "skipped") : "upcoming";
        return (
          <div
            key={`${step.id}-${absolute}`}
            className={cn(
              "flex min-w-[58px] shrink-0 flex-col items-center gap-1 rounded-xl border px-3 py-2 transition-all duration-200",
              state === "current" &&
                "scale-105 border-[var(--color-signal)] bg-[rgba(34,224,214,0.14)] glow-signal",
              state === "correct" && "border-[rgba(57,224,139,0.35)] bg-[rgba(57,224,139,0.07)] opacity-70",
              state === "wrong" && "border-[rgba(255,84,112,0.4)] bg-[rgba(255,84,112,0.08)] opacity-70",
            // Right note, wrong place — amber, not red. The player knew the
            // note; they just have not internalised where it lives yet.
            state === "wrong_position" &&
              "border-[rgba(255,194,71,0.45)] bg-[rgba(255,194,71,0.09)] opacity-80",
              state === "skipped" && "border-[var(--color-hairline)] opacity-40",
              state === "upcoming" && "border-[var(--color-hairline)] bg-[var(--color-void)] opacity-80",
            )}
          >
            <span
              className={cn(
                "readout text-base font-semibold",
                state === "current" ? "text-[var(--color-signal)]" : "text-[var(--color-ink-dim)]",
              )}
            >
              {step.label}
            </span>
            <span className="readout text-[9px] text-[var(--color-ink-faint)]">{step.degree ?? ""}</span>
          </div>
        );
      })}
    </div>
  );
}
