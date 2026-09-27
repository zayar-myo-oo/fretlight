"use client";

import type { Fretboard as FretboardModel } from "@fretlight/core";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { cn } from "@/lib/ui/cn";

/**
 * The fretboard shown when the camera cannot hold a lock on the real neck.
 *
 * Pinned to the bottom of the camera view and deliberately *not* driven by any
 * tracking output. The whole point is that when detection is struggling, the
 * player still gets a fretboard that does not move, does not fade and does not
 * flicker — a stable UI component that happens to sit over video.
 *
 * Reuses the same `Fretboard` renderer as every other screen, so markers, tones
 * and note labels are identical to what the player already knows.
 */
export function FallbackFretboard({
  board,
  markers,
  reason,
  lowStringOnTop = false,
  className,
}: {
  readonly board: FretboardModel;
  readonly markers: readonly FretMarker[];
  /** Short explanation of why automatic tracking is not available. */
  readonly reason?: string;
  readonly lowStringOnTop?: boolean;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 border-t border-[var(--color-hairline-bright)] bg-[rgba(4,6,11,0.88)] px-3 pt-2 pb-1 backdrop-blur-md",
        className,
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="hud-label">Fretboard</span>
        {reason && (
          <span className="readout text-[9px] tracking-wider text-[var(--color-ink-faint)] uppercase">
            {reason}
          </span>
        )}
      </div>
      <Fretboard
        board={board}
        markers={markers}
        toFret={Math.min(12, board.fretCount)}
        geometry={{ stringGap: 26, taper: 0.3 }}
      lowStringOnTop={lowStringOnTop}
      />
    </div>
  );
}
