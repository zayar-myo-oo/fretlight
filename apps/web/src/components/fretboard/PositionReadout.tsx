"use client";

import { type Fretboard, noteAt } from "@fretlight/core";
import { useFretPositionState, usePitchState, useSignalState } from "@/hooks/useDetection";
import { cn } from "@/lib/ui/cn";

/**
 * The answer to the one question this screen exists to answer:
 * *what did I just play, and where did I play it?*
 *
 * A note name on its own is not an answer. "A" is true of the 5th fret of a
 * bass E string and of the open A string, and telling the player "A" leaves
 * them exactly as lost as before. So the readout always carries the full
 * identity — pitch with octave, the string by its name, the fret — and says
 * plainly when it is not sure where the note was played rather than asserting a
 * position it guessed.
 */
export function PositionReadout({
  board,
  className,
}: {
  readonly board: Fretboard;
  readonly className?: string;
}) {
  const pitch = usePitchState();
  const position = useFretPositionState();
  const signal = useSignalState();

  const hasNote = signal.state === "note_detected" && pitch.noteName !== null;
  const stringLabel =
    position.string === null ? null : (noteAt(board, position.string, 0)?.name ?? null);
  const uncertain = position.state === "position_uncertain";

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-6", className)}>
      {/* Pitch identity */}
      <div className="flex items-end gap-1">
        <span
          className={cn(
            "readout text-6xl leading-none font-semibold transition-all duration-300",
            hasNote ? "text-[var(--color-ink)] opacity-100" : "text-[var(--color-hairline-bright)] opacity-45",
          )}
        >
          {hasNote ? pitch.noteName : "—"}
        </span>
        <span
          className={cn(
            "readout pb-1 text-2xl font-medium text-[var(--color-ink-faint)] transition-opacity duration-300",
            hasNote ? "opacity-100" : "opacity-0",
          )}
        >
          {pitch.octave ?? ""}
        </span>
      </div>

      {/* Where on the neck */}
      <div className="flex items-center gap-6">
        <Field
          label="String"
          value={
            hasNote && stringLabel && position.string !== null
              ? `${position.string + 1} · ${stringLabel}`
              : "—"
          }
          dim={!hasNote}
        />
        <Field
          label="Fret"
          value={hasNote && position.fret !== null ? (position.fret === 0 ? "open" : String(position.fret)) : "—"}
          dim={!hasNote}
        />
        <Field
          label="Cents"
          value={hasNote && pitch.cents !== null ? `${pitch.cents > 0 ? "+" : ""}${pitch.cents.toFixed(1)}` : "—"}
          dim={!hasNote}
        />
        <Field
          label="Confidence"
          value={hasNote ? `${Math.round(pitch.confidence * 100)}%` : "—"}
          dim={!hasNote}
        />
      </div>

      {/* Status line — never leave the player guessing why nothing is lit. */}
      <p
        className={cn(
          "readout w-full text-[11px] tracking-wider uppercase",
          uncertain && hasNote
            ? "text-[var(--color-warn)]"
            : "text-[var(--color-ink-faint)]",
        )}
      >
        {!hasNote
          ? signal.message || "waiting for input"
          : uncertain
            ? "position uncertain — this pitch exists in more than one place; set “Hand at” or turn the camera on"
            : "position confirmed"}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  dim,
}: {
  readonly label: string;
  readonly value: string;
  readonly dim: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="hud-label">{label}</span>
      <span
        className={cn(
          "readout text-lg font-semibold transition-colors duration-200",
          dim ? "text-[var(--color-hairline-bright)]" : "text-[var(--color-ink)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}
