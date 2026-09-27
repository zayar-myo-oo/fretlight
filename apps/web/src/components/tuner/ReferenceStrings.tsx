"use client";

import type { Fretboard } from "@fretlight/core";
import { noteAt } from "@fretlight/core";
import { useReferenceTone } from "@/hooks/useReferenceTone";
import { cn } from "@/lib/ui/cn";

/**
 * One button per open string: press and hold to hear that string's target
 * pitch, so you can tune by ear alongside the chromatic readout above.
 */
export function ReferenceStrings({ board, className }: { board: Fretboard; className?: string }) {
  const { playString, stop } = useReferenceTone();

  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-2", className)}>
      {Array.from({ length: board.stringCount }, (_, stringIndex) => {
        const open = noteAt(board, stringIndex, 0);
        if (!open) return null;
        return (
          <button
            key={stringIndex}
            onMouseDown={() => void playString(open.midi)}
            onMouseUp={stop}
            onMouseLeave={stop}
            onTouchStart={(event) => {
              event.preventDefault();
              void playString(open.midi);
            }}
            onTouchEnd={stop}
            className={cn(
              "readout flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-xl border text-sm font-semibold",
              "border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] text-[var(--color-ink-dim)] transition-all",
              "hover:text-[var(--color-ink)] active:scale-95 active:border-[var(--color-signal)] active:text-[var(--color-signal)]",
            )}
          >
            <span>
              {open.name}
              <span className="text-[10px] text-[var(--color-ink-faint)]">{open.octave}</span>
            </span>
            <span className="text-[9px] tracking-wider text-[var(--color-ink-faint)] uppercase">hold</span>
          </button>
        );
      })}
    </div>
  );
}
