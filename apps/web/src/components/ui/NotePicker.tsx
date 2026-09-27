"use client";

import { SHARP_NAMES } from "@fretlight/core";
import { cn } from "@/lib/ui/cn";

/** Chromatic root selector, laid out like a single octave of a keyboard. */
export function NotePicker({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (pitchClass: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-6 gap-1.5 sm:grid-cols-12", className)}>
      {SHARP_NAMES.map((name, pitchClass) => {
        const active = pitchClass === value;
        const accidental = name.includes("#");
        return (
          <button
            key={name}
            onClick={() => onChange(pitchClass)}
            aria-pressed={active}
            className={cn(
              "readout h-10 rounded-lg border text-xs font-semibold transition-all duration-150 active:scale-95",
              active
                ? "border-[var(--color-root)] bg-[rgba(255,92,138,0.18)] text-[var(--color-root-bright)] glow-root"
                : accidental
                  ? "border-[var(--color-hairline)] bg-[var(--color-void)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]"
                  : "border-[var(--color-hairline)] bg-[var(--color-panel-raised)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]",
            )}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
