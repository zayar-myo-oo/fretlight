"use client";

import { noteAt } from "@fretlight/core";
import { useEffect, useMemo, useRef } from "react";
import { InputSourcePanel } from "@/components/audio/InputSourcePanel";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { NoteReadout } from "@/components/tuner/NoteReadout";
import { ReferenceStrings } from "@/components/tuner/ReferenceStrings";
import { IN_TUNE_CENTS, TunerMeter } from "@/components/tuner/TunerMeter";
import { TuningPicker } from "@/components/tuner/TuningPicker";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { PositionControl } from "@/components/fretboard/PositionControl";
import { useAutoListen, useDetection } from "@/hooks/useDetection";
import { useFretboardContext } from "@/hooks/useFretboard";
import { useHandPosition } from "@/hooks/useHandPosition";
import { useMounted } from "@/hooks/useMounted";
import { useReferenceTone } from "@/hooks/useReferenceTone";
import { detectionHub } from "@/lib/audio/detection-hub";
import { useSession } from "@/store/session";
import { cn } from "@/lib/ui/cn";

export default function TunerPage() {
  const mounted = useMounted();
  useAutoListen();

  const { board } = useFretboardContext();
  const instrumentId = useSession((s) => s.instrumentId);
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);
  const tunerChimeEnabled = useSession((s) => s.tunerChimeEnabled);
  const patch = useSession((s) => s.patch);
  const {
    reading,
    clarity,
    activeMidi,
    position,
    candidates,
    uiState,
    instrumentConfidence,
    rejectReason,
    noteEventId,
  } = useDetection();

  // The position estimator needs to know which neck it is reasoning about.
  useEffect(() => {
    detectionHub.setFretboard(board, instrumentId);
  }, [board, instrumentId]);

  const handFret = useHandPosition();

  /**
   * One marker for where the note was most likely played, plus the alternatives
   * shown faintly. Previously every matching position was lit equally, which
   * told the player nothing about what they had actually just done.
   */
  const markers = useMemo<FretMarker[]>(() => {
    if (!position) return [];
    return [
      ...candidates
        .filter((c) => c.string !== position.string || c.fret !== position.fret)
        .map((c) => ({
          string: c.string,
          fret: c.fret,
          label: c.name,
          tone: "ghost" as const,
        })),
      {
        string: position.string,
        fret: position.fret,
        label: position.name,
        tone: "live" as const,
        emphasis: true,
      },
    ];
  }, [position, candidates]);

  /** Which open string is closest — so the player knows which peg to turn. */
  const nearestString = useMemo(() => {
    if (!reading) return null;
    let best: { index: number; name: string; octave: number; distance: number } | null = null;
    for (let i = 0; i < board.stringCount; i++) {
      const open = noteAt(board, i, 0);
      if (!open) continue;
      const distance = Math.abs(open.midi - reading.midiFloat);
      if (!best || distance < best.distance) {
        best = { index: i, name: open.name, octave: open.octave, distance };
      }
    }
    return best;
  }, [board, reading]);

  const inTune = reading !== null && Math.abs(reading.cents) <= IN_TUNE_CENTS;

  // Confirm by ear the moment a string settles in tune — only on the
  // false→true edge, so a held note doesn't retrigger the chime every frame.
  const { playInTuneChime } = useReferenceTone();
  const wasInTune = useRef(false);
  useEffect(() => {
    if (inTune && !wasInTune.current && tunerChimeEnabled) {
      void playInTuneChime();
    }
    wasInTune.current = inTune;
  }, [inTune, tunerChimeEnabled, playInTuneChime]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Chromatic tuner</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
            {board.tuning.name} · {board.tuning.strings.join(" ")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={tunerChimeEnabled}
              onChange={(event) => patch({ tunerChimeEnabled: event.target.checked })}
              className="h-4 w-4 accent-[var(--color-signal)]"
            />
            <span className="text-xs text-[var(--color-ink-dim)]">Chime</span>
          </label>
          <Badge tone={inTune ? "correct" : "neutral"}>
            {inTune ? "in tune" : "±5¢ target"}
          </Badge>
        </div>
      </header>

      <Panel className={cn("transition-shadow duration-300", inTune && "glow-correct")}>
        <div className="flex flex-col items-center gap-7 py-4">
          <NoteReadout
            reading={mounted ? reading : null}
            state={mounted ? uiState : "no_signal"}
            clarity={clarity}
            instrumentConfidence={instrumentConfidence}
          />
          <TunerMeter cents={mounted ? (reading?.cents ?? null) : null} className="max-w-2xl" />

          <div className="flex flex-col items-center gap-2">
            <span className="hud-label">Reference notes · press and hold</span>
            <ReferenceStrings board={board} />
          </div>

          {nearestString && reading && (
            <p className="text-xs text-[var(--color-ink-faint)]">
              Closest open string:{" "}
              <span className="readout text-[var(--color-ink-dim)]">
                {nearestString.name}
                {nearestString.octave}
              </span>{" "}
              · string {nearestString.index + 1}
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Instrument & tuning" meta={<span className="hud-label">optional</span>}>
        <TuningPicker />
      </Panel>

      <Panel
        title="Where you played it"
        meta={
          <span className="hud-label">
            {position
              ? `string ${position.string + 1} · fret ${position.fret}`
              : rejectReason && rejectReason !== "silent"
                ? rejectLabel(rejectReason)
                : "waiting for a note"}
          </span>
        }
      >
        <PositionControl fretCount={board.fretCount} className="mb-3" />
        <Fretboard
          board={board}
          markers={markers}
          activeEventId={noteEventId}
          {...(handFret !== null ? { handWindow: { from: handFret, to: handFret + 4 } } : {})}
          lowStringOnTop={lowStringOnTop}
          onSelect={(position) => detectionHub.mock?.pluck(position.midi)}
        />
        <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          The bright marker is where the note was most likely played, chosen from the
          detected pitch, how playable each position is and where your hand was a moment
          ago. The faint markers are the other places that pitch exists. Tap any fret to
          sound it.
        </p>
      </Panel>

      <InputSourcePanel board={board} />
    </div>
  );
}

function rejectLabel(reason: string): string {
  switch (reason) {
    case "unstable_pitch":
      return "pitch not steady — speech?";
    case "noise_like":
      return "signal too noisy";
    case "aperiodic":
      return "no clear pitch";
    default:
      return "below detection threshold";
  }
}
