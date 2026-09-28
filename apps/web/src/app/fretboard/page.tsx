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
import { useEffect, useMemo, useState } from "react";
import { InputBar } from "@/components/audio/InputBar";
import { PositionReadout } from "@/components/fretboard/PositionReadout";
import { CameraStage } from "@/components/vision/CameraStage";
import { defaultCalibration } from "@/lib/vision/calibration";
import { openCamera } from "@/lib/vision/camera";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { Badge } from "@/components/ui/Badge";
import { NotePicker } from "@/components/ui/NotePicker";
import { PositionControl } from "@/components/fretboard/PositionControl";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useDetection } from "@/hooks/useDetection";
import { useFretboardContext } from "@/hooks/useFretboard";
import { useHandPosition } from "@/hooks/useHandPosition";
import { useMounted } from "@/hooks/useMounted";
import { detectionHub } from "@/lib/audio/detection-hub";
import { fretSynth } from "@/lib/audio/fret-synth";
import { useSession } from "@/store/session";
import { cn } from "@/lib/ui/cn";

type Mode = "scale" | "chord";

// Three.js (~140 kB) has no business being in every /fretboard page load when
// most sessions never touch the 3D toggle — loaded only once it's asked for,
// and never on the server, since it needs a real WebGL canvas.
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

export default function FretboardPage() {
  const mounted = useMounted();

  const { board, scale, chord } = useFretboardContext();
  const root = useSession((s) => s.root);
  const setRoot = useSession((s) => s.setRoot);
  const scaleId = useSession((s) => s.scaleId);
  const setScale = useSession((s) => s.setScale);
  const chordId = useSession((s) => s.chordId);
  const setChord = useSession((s) => s.setChord);
  const labelMode = useSession((s) => s.labelMode);
  const setLabelMode = useSession((s) => s.setLabelMode);

  const [mode, setMode] = useState<Mode>("scale");
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [cameraOn, setCameraOn] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [shapeIndex, setShapeIndex] = useState<number | "all">("all");
  const { position, noteEventId } = useDetection();
  const instrumentId = useSession((s) => s.instrumentId);
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);
  const patch = useSession((s) => s.patch);

  useEffect(() => {
    detectionHub.setFretboard(board, instrumentId);
  }, [board, instrumentId]);

  // Tell the estimator where the hand is; without it, mid-neck playing is drawn
  // at the nut because audio cannot distinguish equivalent positions.
  const handFret = useHandPosition();

  /**
   * Camera lifecycle, kept entirely separate from the microphone: turning one
   * off must never affect the other. Audio says *what* was played; the camera
   * only helps with *where*.
   */
  useEffect(() => {
    let cancelled = false;
    if (!cameraOn) {
      setStream((previous) => {
        for (const track of previous?.getTracks() ?? []) track.stop();
        return null;
      });
      return;
    }
    void openCamera({ facingMode: "environment" })
      .then((next) => {
        if (cancelled) {
          for (const track of next.getTracks()) track.stop();
          return;
        }
        setStream(next);
      })
      .catch(() => setCameraOn(false));
    return () => {
      cancelled = true;
    };
  }, [cameraOn]);

  // Release the camera when leaving the screen — a capture indicator that stays
  // lit after you navigate away is alarming, and rightly so.
  useEffect(
    () => () => {
      setStream((previous) => {
        for (const track of previous?.getTracks() ?? []) track.stop();
        return null;
      });
    },
    [],
  );

  const shapes = useMemo(() => getScaleShapes(board, scale, { startFret: 1 }), [board, scale]);

  const selectedShape = shapeIndex === "all" ? null : (shapes[shapeIndex] ?? null);

  const markers = useMemo<FretMarker[]>(() => {
    const label = (degree: string, interval: number, name: string) =>
      labelMode === "degree" ? degree : labelMode === "interval" ? intervalName(interval).slice(0, 3) : name;

    if (mode === "chord") {
      return getChordPositions(board, chord).map((position) => ({
        string: position.string,
        fret: position.fret,
        label: label(position.degree, position.interval, position.name),
        tone: position.isRoot ? "root" : "chord",
      }));
    }

    const source = selectedShape ? selectedShape.positions : getScalePositions(board, scale);
    return source.map((position) => ({
      string: position.string,
      fret: position.fret,
      label: label(position.degree, position.interval, position.name),
      tone: position.isRoot ? "root" : "scale",
    }));
  }, [mode, board, chord, scale, selectedShape, labelMode]);

  /**
   * Overlay the note being played — at the one position it was most likely
   * played, not at every place on the neck that pitch happens to exist.
   */
  const withLive = useMemo<FretMarker[]>(() => {
    if (!position) return markers;
    const key = `${position.string}:${position.fret}`;
    // The interval of what was actually played against the current root —
    // "show interval when available", right on the note that just sounded,
    // not only on the static scale/chord diagram underneath it.
    const interval = intervalName(mod(position.midi - root, 12)).slice(0, 3);
    return [
      ...markers.filter((marker) => `${marker.string}:${marker.fret}` !== key),
      { string: position.string, fret: position.fret, label: interval, tone: "live", emphasis: true },
    ];
  }, [markers, position, root]);

  const path = selectedShape?.positions.map((p) => ({ string: p.string, fret: p.fret }));

  const diatonicChords = useMemo(
    () => chordsWithin(scale.pitchClasses, ["major", "minor", "dim", "dom7", "maj7", "min7", "power"]),
    [scale],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {mode === "scale" ? `${scale.rootName} ${scale.definition.name}` : chord.symbol}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-dim)]">
            {mode === "scale" ? scale.definition.description : `${chord.definition.name} chord`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            options={[
              { value: "scale", label: "Scale" },
              { value: "chord", label: "Chord" },
            ]}
            value={mode}
            onChange={setMode}
          />
          <SegmentedControl
            size="sm"
            options={[
              { value: "note", label: "Notes" },
              { value: "degree", label: "Degrees" },
              { value: "interval", label: "Intervals" },
            ]}
            value={labelMode}
            onChange={setLabelMode}
          />
          <SegmentedControl
            size="sm"
            options={[
              { value: "tab", label: "Tab view", hint: "High E on top, as written tab and chord charts show it" },
              { value: "player", label: "Player view", hint: "Low E on top, as you see it looking down at the instrument" },
            ]}
            value={lowStringOnTop ? "player" : "tab"}
            onChange={(value) => patch({ lowStringOnTop: value === "player" })}
          />
        </div>
      </header>

      <InputBar cameraOn={cameraOn} onCameraChange={setCameraOn} />

      {cameraOn && (
        <Panel title="Camera" tight>
          <CameraStage
            stream={stream}
            board={board}
            scale={scale}
            activeMidi={null}
            playedPosition={
              position ? { string: position.string, fret: position.fret } : null
            }
            calibration={defaultCalibration()}
            calibrating={false}
            mode="auto"
            onCalibrationChange={() => {}}
            showScaleOverlay={false}
          />
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            The camera helps decide <em>where</em> a note was played. What pitch it was is
            always decided by audio.
          </p>
        </Panel>
      )}

      <Panel title="Detected">
        <PositionReadout board={board} />
      </Panel>

      <Panel
        title={mode === "scale" ? "Scale on the neck" : "Chord tones on the neck"}
        meta={
          mode === "scale" && shapes.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="hud-label mr-1">Position</span>
              <button
                onClick={() => setShapeIndex("all")}
                className={cn(
                  "readout rounded-lg border px-2 py-1 text-[10px] transition-colors",
                  shapeIndex === "all"
                    ? "border-[var(--color-signal)] text-[var(--color-signal)]"
                    : "border-[var(--color-hairline)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]",
                )}
              >
                ALL
              </button>
              {shapes.map((shape, index) => (
                <button
                  key={shape.index}
                  onClick={() => setShapeIndex(index)}
                  title={`Anchored on the ${shape.anchorDegree} · frets ${shape.minFret}–${shape.maxFret}`}
                  className={cn(
                    "readout rounded-lg border px-2 py-1 text-[10px] transition-colors",
                    shapeIndex === index
                      ? "border-[var(--color-signal)] text-[var(--color-signal)]"
                      : "border-[var(--color-hairline)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]",
                  )}
                >
                  {shape.index}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <PositionControl fretCount={board.fretCount} />
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[var(--color-ink-faint)]">
              {handFret === null
                ? "Assuming open position — set where your hand is for an exact match"
                : `Matching notes around fret ${handFret}`}
            </span>
            <SegmentedControl
              size="sm"
              options={[
                { value: "2d", label: "2D" },
                { value: "3d", label: "3D" },
              ]}
              value={view}
              onChange={(value) => setView(value as "2d" | "3d")}
            />
          </div>
        </div>
        {view === "3d" ? (
          <Fretboard3D
            board={board}
            markers={mounted ? withLive : markers}
            lowStringOnTop={lowStringOnTop}
            className="h-[420px] w-full overflow-hidden rounded-2xl border border-[var(--color-hairline)] bg-black/40"
            onSelect={(position) => {
              detectionHub.mock?.pluck(position.midi);
              void fretSynth.pluck(position.midi);
            }}
          />
        ) : (
          <Fretboard
            board={board}
            markers={mounted ? withLive : markers}
            activeEventId={noteEventId}
            {...(path ? { path } : {})}
            {...(handFret !== null ? { handWindow: { from: handFret, to: handFret + 4 } } : {})}
            lowStringOnTop={lowStringOnTop}
            onSelect={(position) => {
              detectionHub.mock?.pluck(position.midi);
              void fretSynth.pluck(position.midi);
            }}
          />
        )}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-[var(--color-ink-faint)]">
          <Legend tone="root" label="Root" />
          <Legend tone={mode === "scale" ? "scale" : "chord"} label={mode === "scale" ? "Scale tone" : "Chord tone"} />
          <Legend tone="live" label="Playing now" />
          {selectedShape && (
            <span>
              Position {selectedShape.index} · frets {selectedShape.minFret}–{selectedShape.maxFret} ·
              anchored on the {selectedShape.anchorDegree}
            </span>
          )}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <Panel title="Root">
          <NotePicker value={root} onChange={setRoot} />

          <div className="mt-5">
            <h3 className="hud-label mb-2.5">{mode === "scale" ? "Scale" : "Chord type"}</h3>
            <div className="flex flex-wrap gap-1.5">
              {mode === "scale"
                ? SCALE_IDS.map((id) => (
                    <TypeChip
                      key={id}
                      active={id === scaleId}
                      label={SCALES[id].name}
                      onClick={() => setScale(id as ScaleId)}
                    />
                  ))
                : CHORD_IDS.map((id) => (
                    <TypeChip
                      key={id}
                      active={id === chordId}
                      label={CHORDS[id].name}
                      onClick={() => setChord(id as ChordId)}
                    />
                  ))}
            </div>
          </div>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title={mode === "scale" ? "Notes and degrees" : "Chord tones"}>
            <p className="mb-3 text-xs leading-relaxed text-[var(--color-ink-dim)]">
              {mode === "scale" ? (
                <>
                  In <span className="readout text-[var(--color-signal)]">{scale.rootName} {scale.definition.name}</span>,{" "}
                  {scale.rootName} is the <span className="text-[var(--color-ink)]">Root</span>
                  {scale.notes.length === 7 ? " (Tonic)" : ""}. Useful chord tones sit at the
                  1st, 3rd and 5th degrees.
                </>
              ) : (
                <>
                  <span className="readout text-[var(--color-signal)]">{chord.symbol}</span> is built from{" "}
                  {chord.rootName}'s {chord.tones.map((t, i) => (
                    <span key={t.degree}>
                      {i > 0 && (i === chord.tones.length - 1 ? " and " : ", ")}
                      {t.interval === 0 ? "root" : intervalName(t.interval).toLowerCase()}
                    </span>
                  ))}.
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {(mode === "scale" ? scale.notes : chord.tones).map((note) => {
                const harmonicFunction = mode === "scale" ? harmonicFunctionOf(note, scale.notes.length) : null;
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
                    {harmonicFunction && (
                      <span className="text-[8px] tracking-wide text-[var(--color-theory)] uppercase">
                        {harmonicFunction}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>

          {mode === "scale" && (
            <Panel
              title="Chords that fit"
              meta={<Badge tone="theory">computed, not looked up</Badge>}
            >
              <div className="flex flex-wrap gap-1.5">
                {diatonicChords.map((option) => (
                  <button
                    key={option.symbol}
                    onClick={() => {
                      setRoot(option.root);
                      setChord(option.definition.id);
                      setMode("chord");
                    }}
                    className="readout rounded-lg border border-[var(--color-hairline)] bg-[var(--color-void)] px-2.5 py-1.5 text-xs text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-theory)] hover:text-[var(--color-theory-bright)]"
                  >
                    {option.symbol}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
                Every chord whose tones all fall inside {scale.rootName}{" "}
                {scale.definition.name}. Derived from the interval sets — no table, no
                model call.
              </p>
            </Panel>
          )}
        </div>
      </div>

    </div>
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
