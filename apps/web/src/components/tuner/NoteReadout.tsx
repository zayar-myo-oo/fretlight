"use client";

import type { PitchReading } from "@fretlight/core";
import { cn } from "@/lib/ui/cn";
import { IN_TUNE_CENTS } from "./TunerMeter";

export type ReadoutState = "no_signal" | "detecting" | "stable" | "holding";

export interface NoteReadoutProps {
  readonly reading: PitchReading | null;
  readonly state: ReadoutState;
  readonly clarity?: number;
  /** 0..1 confidence that this is the instrument rather than the room. */
  readonly instrumentConfidence?: number;
  readonly className?: string;
  readonly compact?: boolean;
}

/**
 * The tuner's primary readout.
 *
 * The note element is never unmounted. Showing and hiding it on every detection
 * cycle is what produces the flashing this component exists to avoid, so instead
 * it is always present and only its opacity and scale change — which the
 * compositor can animate without a layout pass, and which reads as the note
 * fading rather than the UI breaking.
 *
 * During `holding` — the signal has stopped but the note is deliberately still
 * shown — it dims rather than disappearing, so the player can see the reading
 * settle after they mute the string.
 */
export function NoteReadout({
  reading,
  state,
  clarity = 0,
  instrumentConfidence = 0,
  className,
  compact,
}: NoteReadoutProps) {
  const inTune = reading !== null && Math.abs(reading.cents) <= IN_TUNE_CENTS;
  const direction =
    reading === null
      ? ""
      : reading.cents > IN_TUNE_CENTS
        ? "sharp"
        : reading.cents < -IN_TUNE_CENTS
          ? "flat"
          : "";

  const visible = reading !== null && state !== "no_signal";

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div className="relative flex items-end justify-center">
        <span
          className={cn(
            "readout font-semibold leading-none tabular-nums",
            "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            compact ? "text-6xl" : "text-[clamp(4rem,14vw,9rem)]",
            !visible
              ? "scale-90 text-[var(--color-hairline-bright)] opacity-40"
              : state === "holding"
                ? "scale-100 opacity-55"
                : inTune
                  ? "scale-100 text-[var(--color-correct)] opacity-100"
                  : "scale-100 text-[var(--color-ink)] opacity-100",
          )}
        >
          {reading?.note.name ?? "—"}
        </span>
        <span
          className={cn(
            "readout ml-1 font-medium text-[var(--color-ink-faint)] transition-opacity duration-300",
            compact ? "text-xl" : "text-3xl",
            visible ? "opacity-100" : "opacity-0",
          )}
        >
          {reading?.note.octave ?? ""}
        </span>
      </div>

      <div className="flex min-h-[20px] items-center gap-4">
        <span
          className={cn(
            "readout text-sm transition-opacity duration-300",
            visible ? "text-[var(--color-ink-dim)] opacity-100" : "opacity-60",
          )}
        >
          {visible ? `${reading!.frequency.toFixed(2)} Hz` : stateLabel(state)}
        </span>

        <span
          className={cn(
            "readout text-sm font-semibold transition-all duration-200",
            !visible
              ? "text-[var(--color-hairline-bright)] opacity-0"
              : inTune
                ? "text-[var(--color-correct)] opacity-100"
                : Math.abs(reading!.cents) > 25
                  ? "text-[var(--color-error)] opacity-100"
                  : "text-[var(--color-warn)] opacity-100",
          )}
        >
          {visible ? `${reading!.cents > 0 ? "+" : ""}${reading!.cents.toFixed(1)}¢` : "—"}
        </span>

        <span
          className={cn(
            "hud-label transition-opacity duration-300",
            direction && visible ? "opacity-100" : "opacity-0",
          )}
        >
          {direction === "sharp" ? "tune down" : direction === "flat" ? "tune up" : " "}
        </span>
      </div>

      <div
        className={cn(
          "flex items-center gap-2 transition-opacity duration-300",
          visible || state === "detecting" ? "opacity-100" : "opacity-0",
        )}
      >
        <span className="hud-label">signal</span>
        <div className="h-1 w-24 overflow-hidden rounded-full bg-[var(--color-hairline)]">
          <div
            className="h-full rounded-full bg-[var(--color-signal)] transition-[width] duration-200"
            style={{ width: `${Math.round(Math.max(clarity, instrumentConfidence) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function stateLabel(state: ReadoutState): string {
  switch (state) {
    case "detecting":
      return "listening…";
    case "holding":
      return "signal fading";
    default:
      return "waiting for input";
  }
}
