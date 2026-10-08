"use client";

import {
  type Fretboard as Board,
  type Idea,
  type Progression,
  chordPitchClasses,
  coreTriad,
  mod,
  spellPitchClass,
} from "@fretlight/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { ProgressionLoop } from "@/lib/audio/progression-loop";
import { pitchClassMarkers } from "@/lib/companion/markers";
import { cn } from "@/lib/ui/cn";
import { useSession } from "@/store/session";

type Layer = "triad" | "scale" | "tones" | "fill";

/** Plays the progression on a loop and shows what to aim for over each chord. */
export function PracticePanel({
  progression,
  board,
  fills,
  lowStringOnTop,
  instrument,
}: {
  progression: Progression;
  board: Board;
  fills: readonly Idea[];
  lowStringOnTop: boolean;
  instrument: "guitar" | "bass";
}) {
  const loop = useRef<ProgressionLoop | null>(null);
  const [playing, setPlaying] = useState(false);
  // Starts at the app-wide tempo, so a progression sent from the Analyzer plays at its own speed.
  const sessionBpm = useSession((s) => s.bpm);
  const [bpm, setBpm] = useState(() => Math.min(160, Math.max(50, sessionBpm)));
  const [current, setCurrent] = useState(0);
  const [layers, setLayers] = useState<ReadonlySet<Layer>>(new Set(["triad", "tones"]));

  useEffect(() => {
    loop.current = new ProgressionLoop();
    return () => loop.current?.stop();
  }, []);

  // A different progression or instrument means the loop playing is out of date.
  useEffect(() => {
    loop.current?.stop();
    setPlaying(false);
  }, [progression, board]);

  const chord = progression.chords[Math.min(current, progression.chords.length - 1)];
  const next = progression.chords[(Math.min(current, progression.chords.length - 1) + 1) % progression.chords.length];

  const start = async (tempo: number, active: ReadonlySet<Layer>) => {
    setPlaying(true);
    await loop.current?.start({
      progression,
      board,
      bpm: tempo,
      ideas: active.has("fill") ? fills : [],
      onChord: setCurrent,
    });
  };
  const stop = () => {
    loop.current?.stop();
    setPlaying(false);
  };

  // Changing the chords, the instrument or the tempo while playing restarts cleanly.
  const toggle = (layer: Layer) => {
    const updated = new Set(layers);
    if (updated.has(layer)) updated.delete(layer);
    else updated.add(layer);
    setLayers(updated);
    if (playing && layer === "fill") void start(bpm, updated);
  };

  const markers = useMemo<FretMarker[]>(() => {
    if (!chord) return [];
    const key = progression.key.key;
    const pcsFor = (pcs: readonly number[]) => new Map(pcs.map((pc) => [mod(pc, 12), spellPitchClass(pc, key)]));
    const layersOut = new Map<string, FretMarker>();
    const add = (list: FretMarker[]) => list.forEach((m) => layersOut.set(`${m.string}:${m.fret}`, m));

    if (layers.has("scale") && key) add(pitchClassMarkers(board, key.pitchClasses, pcsFor(key.pitchClasses), () => "ghost"));
    if (layers.has("tones")) {
      add(pitchClassMarkers(board, chord.pitchClasses, pcsFor(chord.pitchClasses), (pc) => (pc === mod(chord.root, 12) ? "root" : "chord")));
    }
    const quality = coreTriad(chord.quality);
    if (layers.has("triad") && quality) {
      const pcs = chordPitchClasses(chord.root, quality);
      add(pitchClassMarkers(board, pcs, pcsFor(pcs), (pc) => (pc === mod(chord.root, 12) ? "root" : pc === pcs[1] ? "target" : "scale")));
    }
    return [...layersOut.values()];
  }, [chord, next, layers, board, progression]);

  if (!chord) return null;
  const fill = fills.find((f) => f.fromChord === chord.index);

  return (
    <Panel title="Practice progression" meta={<span className="text-[11px] text-[var(--color-ink-faint)]">Loops until you stop it</span>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--color-ink-dim)]">
          The progression loops. Improvise over it, aiming for the triad notes of whichever chord is playing, then reach
          for the target note as the next chord arrives.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {playing ? (
            <Button onClick={stop}>■ Stop</Button>
          ) : (
            <Button variant="primary" onClick={() => void start(bpm, layers)} disabled={progression.chords.length === 0}>
              ▶ Play progression
            </Button>
          )}
          <label className="flex items-center gap-2 text-xs text-[var(--color-ink-dim)]">
            Tempo
            <input
              type="range"
              min={50}
              max={160}
              step={5}
              value={bpm}
              onChange={(e) => {
                const value = Number(e.target.value);
                setBpm(value);
                if (playing) void start(value, layers);
              }}
              className="w-36 accent-[var(--color-signal)]"
            />
            <span className="readout w-16">{bpm} BPM</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <LayerButton on={layers.has("triad")} onClick={() => toggle("triad")}>
            Show triad
          </LayerButton>
          <LayerButton on={layers.has("scale")} onClick={() => toggle("scale")}>
            Show scale
          </LayerButton>
          <LayerButton on={layers.has("tones")} onClick={() => toggle("tones")}>
            Show chord tones
          </LayerButton>
          <LayerButton on={layers.has("fill")} onClick={() => toggle("fill")}>
            {instrument === "bass" ? "Play bass fill" : "Play fill"}
          </LayerButton>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <p className="hud-label">Now</p>
            <p className="readout text-4xl font-semibold text-[var(--color-signal)]">{chord.symbol}</p>
          </div>
          <div>
            <p className="hud-label">Next</p>
            <p className="readout text-2xl text-[var(--color-ink-dim)]">{next?.symbol}</p>
          </div>
          {layers.has("fill") && fill && (
            <div>
              <p className="hud-label">Fill</p>
              <p className="readout text-sm text-[var(--color-ink-dim)]">{fill.what}</p>
            </div>
          )}
        </div>

        <Fretboard board={board} markers={markers} lowStringOnTop={lowStringOnTop} />
        <p className="text-[11px] text-[var(--color-ink-faint)]">
          Pink = root · cyan = 3rd · purple = 5th. Faint dots are the rest of the key.
        </p>
      </div>
    </Panel>
  );
}

function LayerButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-xs transition-colors",
        on ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.12)] text-[var(--color-ink)]" : "border-[var(--color-hairline)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]",
      )}
    >
      {children}
    </button>
  );
}
