"use client";

import {
  CHORDS,
  CHORD_IDS,
  SCALES,
  SCALE_IDS,
  type ChordId,
  type ScaleId,
  chordsWithin,
  getChordPositions,
  getScalePositions,
  getScaleShapes,
  harmonicFunctionOf,
  intervalName,
  mod,
} from "@fretlight/core";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { DisplayMenu } from "@/components/fretboard/DisplayMenu";
import { SoundMenu } from "@/components/fretboard/SoundMenu";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { PositionControl } from "@/components/fretboard/PositionControl";
import { type InspectedNote, NoteInspector } from "@/components/fretboard/NoteInspector";
import { Badge } from "@/components/ui/Badge";
import { NotePicker } from "@/components/ui/NotePicker";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useDetection } from "@/hooks/useDetection";
import { useFretboardContext } from "@/hooks/useFretboard";
import { useHandPosition } from "@/hooks/useHandPosition";
import { useMounted } from "@/hooks/useMounted";
import { detectionHub } from "@/lib/audio/detection-hub";
import { fretSynth } from "@/lib/audio/fret-synth";
import { cn } from "@/lib/ui/cn";
import { useSession } from "@/store/session";

type Kind = "scale" | "chord";

// Three.js (~140 kB) is only loaded once the 3D view is asked for, and never on
// the server, since it needs a real WebGL canvas.
const Fretboard3D = dynamic(
  () => import("@/components/fretboard/Fretboard3D").then((m) => m.Fretboard3D),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] w-full items-center justify-center rounded-2xl border border-[var(--color-hairline)] bg-black/40 text-xs text-[var(--color-ink-faint)]">
        Loading 3D view…
      </div>
    ),
  },
);

/** Pick a scale or chord, see it on the neck. */
export function ExploreMode() {
  const mounted = useMounted();

  const { board, scale, chord } = useFretboardContext();
  const root = useSession((s) => s.root);
  const setRoot = useSession((s) => s.setRoot);
  const scaleId = useSession((s) => s.scaleId);
  const setScale = useSession((s) => s.setScale);
  const chordId = useSession((s) => s.chordId);
  const setChord = useSession((s) => s.setChord);
  const labelMode = useSession((s) => s.labelMode);
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);

  const [kind, setKind] = useState<Kind>("scale");
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [shapeIndex, setShapeIndex] = useState<number | "all">("all");
  const { position, noteEventId } = useDetection();

  // Tell the estimator where the hand is; without it, mid-neck playing is drawn
  // at the nut because audio cannot distinguish equivalent positions.
  const handFret = useHandPosition();

  const shapes = useMemo(() => getScaleShapes(board, scale, { startFret: 1 }), [board, scale]);
  const selectedShape = shapeIndex === "all" ? null : (shapes[shapeIndex] ?? null);

  const markers = useMemo<FretMarker[]>(() => {
    const label = (degree: string, interval: number, name: string) =>
      labelMode === "degree" ? degree : labelMode === "interval" ? intervalName(interval).slice(0, 3) : name;

    if (kind === "chord") {
      return getChordPositions(board, chord).map((p) => ({
        string: p.string,
        fret: p.fret,
        label: label(p.degree, p.interval, p.name),
        tone: p.isRoot ? "root" : "chord",
      }));
    }

    const source = selectedShape ? selectedShape.positions : getScalePositions(board, scale);
    return source.map((p) => ({
      string: p.string,
      fret: p.fret,
      label: label(p.degree, p.interval, p.name),
      tone: p.isRoot ? "root" : "scale",
    }));
  }, [kind, board, chord, scale, selectedShape, labelMode]);

  // The note currently being played, drawn where it most likely was played.
  // Only appears when the Listen tab has switched an input on.
  const withLive = useMemo<FretMarker[]>(() => {
    if (!position) return markers;
    const key = `${position.string}:${position.fret}`;
    const interval = intervalName(mod(position.midi - root, 12)).slice(0, 3);
    return [
      ...markers.filter((m) => `${m.string}:${m.fret}` !== key),
      { string: position.string, fret: position.fret, label: interval, tone: "live", emphasis: true },
    ];
  }, [markers, position, root]);

  const path = selectedShape?.positions.map((p) => ({ string: p.string, fret: p.fret }));

  const diatonicChords = useMemo(
    () => chordsWithin(scale.pitchClasses, ["major", "minor", "dim", "dom7", "maj7", "min7", "power"]),
    [scale],
  );

  const [inspected, setInspected] = useState<InspectedNote | null>(null);
  const onSelect = (p: { string: number; fret: number; midi: number }) => {
    detectionHub.mock?.pluck(p.midi);
    void fretSynth.pluck(p.midi);
    setInspected({ string: p.string, fret: p.fret, midi: p.midi });
  };

  const title = kind === "scale" ? `${scale.rootName} ${scale.definition.name}` : chord.symbol;
  const subtitle = kind === "scale" ? scale.definition.description : `${chord.definition.name} chord`;

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="1 · Choose what to see"
        meta={
          <SegmentedControl
            size="sm"
            options={[
              { value: "scale", label: "Scale" },
              { value: "chord", label: "Chord" },
            ]}
            value={kind}
            onChange={setKind}
          />
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="hud-label mb-2.5">Root note</h3>
            <NotePicker value={root} onChange={setRoot} />
          </div>
          <div>
            <h3 className="hud-label mb-2.5">{kind === "scale" ? "Scale" : "Chord type"}</h3>
            <div className="flex flex-wrap gap-1.5">
              {kind === "scale"
                ? SCALE_IDS.map((id) => (
                    <TypeChip key={id} active={id === scaleId} label={SCALES[id].name} onClick={() => setScale(id as ScaleId)} />
                  ))
                : CHORD_IDS.map((id) => (
                    <TypeChip key={id} active={id === chordId} label={CHORDS[id].name} onClick={() => setChord(id as ChordId)} />
                  ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="2 · See it on the neck" meta={
          <div className="flex flex-wrap items-start justify-end gap-2">
            <SoundMenu />
            <DisplayMenu view={view} onViewChange={setView} />
          </div>
        }>
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-sm text-[var(--color-ink-dim)]">{subtitle}</p>
        </div>

        {kind === "scale" && shapes.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="hud-label mr-1">Position</span>
            <ShapeButton active={shapeIndex === "all"} onClick={() => setShapeIndex("all")}>
              ALL
            </ShapeButton>
            {shapes.map((shape, index) => (
              <ShapeButton
                key={shape.index}
                active={shapeIndex === index}
                title={`Anchored on the ${shape.anchorDegree} · frets ${shape.minFret}–${shape.maxFret}`}
                onClick={() => setShapeIndex(index)}
              >
                {shape.index}
              </ShapeButton>
            ))}
          </div>
        )}

        {view === "3d" ? (
          <Fretboard3D
            board={board}
            markers={mounted ? withLive : markers}
            lowStringOnTop={lowStringOnTop}
            className="h-[420px] w-full overflow-hidden rounded-2xl border border-[var(--color-hairline)] bg-black/40"
            onSelect={onSelect}
          />
        ) : (
          <Fretboard
            board={board}
            markers={mounted ? withLive : markers}
            activeEventId={noteEventId}
            {...(path ? { path } : {})}
            {...(handFret !== null ? { handWindow: { from: handFret, to: handFret + 4 } } : {})}
            lowStringOnTop={lowStringOnTop}
            onSelect={onSelect}
          />
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-[var(--color-ink-faint)]">
          <Legend tone="root" label="Root" />
          <Legend tone={kind === "scale" ? "scale" : "chord"} label={kind === "scale" ? "Scale tone" : "Chord tone"} />
          <Legend tone="live" label="Playing now" />
          {selectedShape && (
            <span>
              Position {selectedShape.index} · frets {selectedShape.minFret}–{selectedShape.maxFret} · anchored on the{" "}
              {selectedShape.anchorDegree}
            </span>
          )}
          <span className="ml-auto">Tap any note to hear it and see what it does</span>
        </div>

        {inspected && (
          <div className="mt-4">
            <NoteInspector
              note={inspected}
              scale={scale}
              chord={chord}
              kind={kind}
              stringName={board.tuning.strings[inspected.string]?.replace(/[0-9]+/, "") ?? ""}
              onClose={() => setInspected(null)}
            />
          </div>
        )}

        <details className="mt-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] px-3 py-2">
          <summary className="cursor-pointer text-xs text-[var(--color-ink-dim)]">
            Match where my hand is
            <span className="ml-2 text-[var(--color-ink-faint)]">
              {handFret === null ? "(assuming open position)" : `(around fret ${handFret})`}
            </span>
          </summary>
          <div className="mt-3">
            <PositionControl fretCount={board.fretCount} />
          </div>
        </details>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={kind === "scale" ? "Notes and degrees" : "Chord tones"}>
          <p className="mb-3 text-xs leading-relaxed text-[var(--color-ink-dim)]">
            {kind === "scale" ? (
              <>
                In <span className="readout text-[var(--color-signal)]">{scale.rootName} {scale.definition.name}</span>,{" "}
                {scale.rootName} is the root. Useful chord tones sit at the 1st, 3rd and 5th degrees.
              </>
            ) : (
              <>
                <span className="readout text-[var(--color-signal)]">{chord.symbol}</span> is built from {chord.rootName}&apos;s{" "}
                {chord.tones.map((t, i) => (
                  <span key={t.degree}>
                    {i > 0 && (i === chord.tones.length - 1 ? " and " : ", ")}
                    {t.interval === 0 ? "root" : intervalName(t.interval).toLowerCase()}
                  </span>
                ))}
                .
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {(kind === "scale" ? scale.notes : chord.tones).map((note) => {
              const fn = kind === "scale" ? harmonicFunctionOf(note, scale.notes.length) : null;
              return (
                <div
                  key={`${note.degree}-${note.pitchClass}`}
                  className={cn(
                    "flex min-w-[68px] flex-col items-center gap-1 rounded-xl border px-3 py-2.5",
                    note.interval === 0
                      ? "border-[rgba(255,92,138,0.4)] bg-[rgba(255,92,138,0.1)]"
                      : "border-[var(--color-hairline)] bg-[var(--color-void)]",
                  )}
                >
                  <span className="readout text-lg font-semibold">{note.name}</span>
                  <span className="readout text-[10px] text-[var(--color-ink-faint)]">{note.degree}</span>
                  <span className="text-[9px] text-[var(--color-ink-faint)]">
                    {note.interval === 0 ? "Root" : intervalName(note.interval)}
                  </span>
                  {fn && <span className="text-[8px] tracking-wide text-[var(--color-theory)] uppercase">{fn}</span>}
                </div>
              );
            })}
          </div>
        </Panel>

        {kind === "scale" && (
          <Panel title="Chords that fit" meta={<Badge tone="theory">tap to view</Badge>}>
            <div className="flex flex-wrap gap-1.5">
              {diatonicChords.map((option) => (
                <button
                  key={option.symbol}
                  onClick={() => {
                    setRoot(option.root);
                    setChord(option.definition.id);
                    setKind("chord");
                  }}
                  className="readout rounded-lg border border-[var(--color-hairline)] bg-[var(--color-void)] px-2.5 py-1.5 text-xs text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-theory)] hover:text-[var(--color-theory-bright)]"
                >
                  {option.symbol}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
              Every chord whose notes all fall inside {scale.rootName} {scale.definition.name}.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function ShapeButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "readout rounded-lg border px-2 py-1 text-[10px] transition-colors",
        active
          ? "border-[var(--color-signal)] text-[var(--color-signal)]"
          : "border-[var(--color-hairline)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]",
      )}
    >
      {children}
    </button>
  );
}

function TypeChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-xs transition-all",
        active
          ? "border-[var(--color-theory)] bg-[rgba(139,124,255,0.14)] text-[var(--color-theory-bright)]"
          : "border-[var(--color-hairline)] text-[var(--color-ink-faint)] hover:border-[var(--color-hairline-bright)] hover:text-[var(--color-ink-dim)]",
      )}
    >
      {label}
    </button>
  );
}

function Legend({ tone, label }: { tone: "root" | "scale" | "chord" | "live"; label: string }) {
  const colors = {
    root: "bg-[rgba(255,92,138,0.92)]",
    scale: "bg-[rgba(139,124,255,0.5)]",
    chord: "bg-[rgba(34,224,214,0.5)]",
    live: "bg-white",
  } as const;
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-full", colors[tone])} />
      {label}
    </span>
  );
}
