"use client";

import { useSession } from "@/store/session";
import { cn } from "@/lib/ui/cn";

/**
 * Tells the app roughly where the fretting hand is.
 *
 * This is the single control that decides whether the fretboard highlight is
 * right or wrong, and it exists because of a hard physical limit rather than a
 * shortcoming in the detector: an A2 played on the low E at the 5th fret and the
 * open A string produce the same waveform. No amount of DSP separates them.
 *
 * Measured on a guitar: with no hand position, notes played in 5th position land
 * in the right place 0 times out of 6, and a pentatonic box at the 5th fret 2
 * times out of 12 — because the only defensible guess is the lowest position.
 * With the hand position set, both are exact.
 *
 * "Auto" is honest about this: it assumes open position, which is right for
 * beginners and wrong the moment you move up the neck.
 */
export function PositionControl({
  fretCount,
  className,
}: {
  readonly fretCount: number;
  readonly className?: string;
}) {
  const handFret = useSession((s) => s.handFret);
  const setHandFret = useSession((s) => s.setHandFret);

  const anchors = [0, 3, 5, 7, 9, 12, 15, 17].filter((fret) => fret <= fretCount);

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="hud-label mr-1">Hand at</span>

      <button
        onClick={() => setHandFret(null)}
        title="Assume open position — accurate only while you play near the nut"
        className={cn(
          "readout rounded-lg border px-2.5 py-1 text-[11px] transition-colors",
          handFret === null
            ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)] text-[var(--color-signal)]"
            : "border-[var(--color-hairline)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]",
        )}
      >
        Auto
      </button>

      {anchors.map((fret) => (
        <button
          key={fret}
          onClick={() => setHandFret(fret)}
          title={`Playing around fret ${fret}`}
          className={cn(
            "readout rounded-lg border px-2.5 py-1 text-[11px] transition-colors",
            handFret === fret
              ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)] text-[var(--color-signal)]"
              : "border-[var(--color-hairline)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]",
          )}
        >
          {fret === 0 ? "Open" : fret}
        </button>
      ))}
    </div>
  );
}
