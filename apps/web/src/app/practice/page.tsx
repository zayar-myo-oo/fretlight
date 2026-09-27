"use client";

import {
  type Drill,
  PracticeEngine,
  describeTarget,
  generateDrill,
  type EvaluationEvent,
  type StepVerdict,
  type PracticeSequence,
  formatNote,
  getScaleShapes,
  sequenceFromArpeggio,
  sequenceFromScale,
  sequenceFromShape,
} from "@fretlight/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InputSourcePanel } from "@/components/audio/InputSourcePanel";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { NoteStrip } from "@/components/practice/NoteStrip";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Stat } from "@/components/ui/Stat";
import {
  useAutoListen,
  useDetection,
  useFretPositionState,
  useSignalState,
} from "@/hooks/useDetection";
import { useFretboardContext } from "@/hooks/useFretboard";
import { useKeyboard } from "@/hooks/useKeyboard";
import { useMetronome } from "@/hooks/useMetronome";
import { useMounted } from "@/hooks/useMounted";
import { detectionHub } from "@/lib/audio/detection-hub";
import { useProgress } from "@/store/progress";
import { useSession } from "@/store/session";
import { cn } from "@/lib/ui/cn";

/**
 * Drills first, because they are the ones that teach the neck:
 *  - note     — "play an A anywhere"
 *  - fret     — "play the A on the D string, 7th fret"
 *  - interval — "from A, play the 5th"
 * Then the longer sequence exercises that build on them.
 */
type ExerciseKind = "note" | "fret" | "interval" | "scale" | "position" | "arpeggio";

const DRILL_KINDS: ReadonlySet<ExerciseKind> = new Set(["note", "fret", "interval"]);

/** One clock for the whole exercise. Phase 2 moves this to the AudioContext clock. */
const now = () => performance.now() / 1000;

export default function PracticePage() {
  const mounted = useMounted();
  useAutoListen();

  const { board, scale, chord } = useFretboardContext();
  const instrumentId = useSession((s) => s.instrumentId);
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);
  const bpm = useSession((s) => s.bpm);
  const matchOctave = useSession((s) => s.matchOctave);
  const patch = useSession((s) => s.patch);
  const addRecord = useProgress((s) => s.addRecord);

  const { activeMidi, noteEventId, reading, uiState } = useDetection();
  const positionState = useFretPositionState();
  const signal = useSignalState();
  const metronome = useMetronome();

  const [kind, setKind] = useState<ExerciseKind>("note");
  const [drillSeed, setDrillSeed] = useState(1);
  const [drillLength, setDrillLength] = useState(10);
  const [positionIndex, setPositionIndex] = useState(0);
  const [ascendDescend, setAscendDescend] = useState(true);

  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [lastEvent, setLastEvent] = useState<EvaluationEvent | null>(null);
  const [verdicts, setVerdicts] = useState<Map<number, StepVerdict>>(new Map());
  const [summary, setSummary] = useState({ correct: 0, wrong: 0, pitchAccuracy: 0, overall: 0 });
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);
  const [streak, setStreak] = useState(0);
  const [reactions, setReactions] = useState<number[]>([]);

  const engineRef = useRef<PracticeEngine | null>(null);
  const startedAtRef = useRef(0);

  const shapes = useMemo(() => getScaleShapes(board, scale, { startFret: 1 }), [board, scale]);

  useEffect(() => {
    detectionHub.setFretboard(board, instrumentId);
  }, [board, instrumentId]);

  /** Drill metadata, when the selected exercise is one. */
  const drill: Drill | null = useMemo(() => {
    if (!DRILL_KINDS.has(kind)) return null;
    return generateDrill({
      kind: kind as "note" | "fret" | "interval",
      board,
      length: drillLength,
      seed: drillSeed,
      root: scale.root,
      ...(kind === "fret" ? { fretRange: [0, Math.min(12, board.fretCount)] as const } : {}),
    });
  }, [kind, board, drillLength, drillSeed, scale.root]);

  const sequence: PracticeSequence = useMemo(() => {
    if (drill) return drill.sequence;
    if (kind === "position") {
      const shape = shapes[positionIndex] ?? shapes[0];
      if (shape) {
        return sequenceFromShape(
          `${scale.rootName} ${scale.definition.name} · position ${shape.index}`,
          shape.positions,
          { bpm, ascendDescend },
        );
      }
    }
    if (kind === "arpeggio") {
      return sequenceFromArpeggio(chord.root, chord.definition.id, {
        board,
        bpm,
        startOctave: board.stringCount > 4 || board.openMidi[0]! < 40 ? 1 : 2,
        ...(ascendDescend ? { direction: "up_down" as const } : {}),
      });
    }
    return sequenceFromScale(scale, {
      board,
      bpm,
      ascendDescend,
      startOctave: board.openMidi[0]! < 40 ? 1 : 2,
    });
  }, [drill, kind, shapes, positionIndex, scale, chord, board, bpm, ascendDescend]);

  const requirePosition = drill?.requirePosition ?? false;

  /** Rebuild the engine whenever the exercise changes; never mid-run. */
  useEffect(() => {
    engineRef.current = new PracticeEngine(sequence, { matchOctave, requirePosition });
    setRunning(false);
    setIndex(0);
    setVerdicts(new Map());
    setLastEvent(null);
    setSummary({ correct: 0, wrong: 0, pitchAccuracy: 0, overall: 0 });
    setStreak(0);
    setReactions([]);
  }, [sequence, matchOctave, requirePosition]);

  const stop = useCallback(
    (completed: boolean) => {
      const engine = engineRef.current;
      setRunning(false);
      if (!engine) return;
      engine.stop();

      const result = engine.summary;
      // Only record a run the player actually got through — a two-note false
      // start would otherwise pollute the accuracy history.
      if (completed || result.correct >= Math.max(4, sequence.steps.length / 2)) {
        addRecord({
          exercise: sequence.name,
          instrumentId,
          bpm,
          durationSeconds: Math.max(1, Math.round(now() - startedAtRef.current)),
          pitchAccuracy: result.pitchAccuracy,
          timingAccuracy: result.timingAccuracy,
          overall: result.overall,
          notesCorrect: result.correct,
          notesTotal: sequence.steps.length,
        });
      }
    },
    [addRecord, bpm, instrumentId, sequence],
  );

  const start = useCallback(() => {
    const engine = new PracticeEngine(sequence, { matchOctave, requirePosition });
    engineRef.current = engine;
    startedAtRef.current = now();
    engine.start(startedAtRef.current);
    setRunning(true);
    setIndex(0);
    setVerdicts(new Map());
    setLastEvent(null);
    setSummary({ correct: 0, wrong: 0, pitchAccuracy: 0, overall: 0 });
    setStreak(0);
    setReactions([]);
  }, [sequence, matchOctave, requirePosition]);

  /**
   * The feedback loop. A confirmed note goes straight into the engine and the
   * result updates the UI in the same tick — no network hop anywhere in here.
   */
  useEffect(() => {
    if (!running || noteEventId === 0 || activeMidi === null) return;
    const engine = engineRef.current;
    if (!engine) return;

    const event = engine.submitNote({
      midi: activeMidi,
      time: now(),
      // Fret practice grades *where* it was played, so the estimator's answer
      // is part of the input rather than just a display detail.
      ...(positionState.string !== null && positionState.fret !== null
        ? { position: { string: positionState.string, fret: positionState.fret } }
        : {}),
    });
    if (!event) return;

    setLastEvent(event);
    setIndex(engine.currentIndex);
    setVerdicts((previous) => {
      const next = new Map(previous);
      const heldPosition = event.verdict === "wrong" || event.verdict === "wrong_position";
      next.set(engine.currentIndex - (heldPosition ? 0 : 1), event.verdict);
      return next;
    });

    const engineSummary = engine.summary;
    setSummary({
      correct: engineSummary.correct,
      wrong: engineSummary.wrong,
      pitchAccuracy: engineSummary.pitchAccuracy,
      overall: engineSummary.overall,
    });

    setFlash(event.verdict === "correct" ? "correct" : event.verdict === "skipped" ? null : "wrong");
    if (event.verdict === "correct") setStreak((value) => value + 1);
    else if (event.verdict !== "skipped") setStreak(0);
    if (event.reactionSeconds !== null && event.verdict === "correct") {
      setReactions((previous) => [...previous.slice(-19), event.reactionSeconds!]);
    }
    if (event.completed) stop(true);
    // Keyed on noteEventId so replaying the same pitch still counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteEventId]);

  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), 260);
    return () => clearTimeout(timer);
  }, [flash]);

  useKeyboard({
    " ": () => (running ? stop(false) : start()),
    Space: () => (running ? stop(false) : start()),
    m: () => void metronome.toggle(),
    s: () => {
      const engine = engineRef.current;
      if (!engine || !running) return;
      engine.skip();
      setIndex(engine.currentIndex);
    },
  });

  const currentStep = sequence.steps[index] ?? null;
  const nextStep = sequence.steps[index + 1] ?? null;

  /**
   * During a *sequence* exercise, the expected position is good evidence about
   * where the hand is, and telling the estimator sharpens an ambiguous pitch.
   *
   * During a *fret drill* it must not be passed. Grading "did you play it in the
   * right place?" against an estimate that was itself biased toward the right
   * place is circular — it would mark everything correct regardless of what the
   * player did. The drill only targets positions whose pitch is unique on the
   * neck, so the estimator can resolve them on the audio alone.
   */
  useEffect(() => {
    const useExpected = running && !requirePosition && currentStep?.position;
    detectionHub.setPositionContext(useExpected ? { expected: currentStep.position! } : {});
  }, [running, currentStep, requirePosition]);

  const markers = useMemo<FretMarker[]>(() => {
    // An up-and-back exercise passes through the same position twice, so markers
    // are collapsed per string/fret. Insertion order sets precedence: the target
    // and the next note are written last and therefore win.
    const byPosition = new Map<string, FretMarker>();
    const put = (marker: FretMarker) => byPosition.set(`${marker.string}:${marker.fret}`, marker);

    sequence.steps.forEach((step, stepIndex) => {
      if (!step.position) return;
      if (stepIndex === index || stepIndex === index + 1) return;
      put({
        string: step.position.string,
        fret: step.position.fret,
        label: step.label,
        tone: stepIndex < index ? "ghost" : "next",
      });
    });
    if (nextStep?.position) {
      put({
        string: nextStep.position.string,
        fret: nextStep.position.fret,
        label: nextStep.label,
        tone: "next",
        order: 2,
      });
    }
    if (currentStep?.position) {
      put({
        string: currentStep.position.string,
        fret: currentStep.position.fret,
        label: currentStep.label,
        tone: flash === "wrong" ? "wrong" : "target",
        emphasis: true,
        order: 1,
      });
    }
    return [...byPosition.values()];
  }, [sequence, index, currentStep, nextStep, flash]);

  const progress = sequence.steps.length === 0 ? 0 : index / sequence.steps.length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{sequence.name}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
            {sequence.steps.length} notes · {board.tuning.strings.join(" ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={metronome.isRunning ? "primary" : "secondary"} size="sm" onClick={() => void metronome.toggle()}>
            {metronome.isRunning ? `Click ${bpm}` : "Metronome"}
          </Button>
          <Button variant={running ? "danger" : "primary"} onClick={() => (running ? stop(false) : start())}>
            {running ? "Stop" : "Start practice"}
          </Button>
        </div>
      </header>

      {/* --- The three questions: what am I playing, is it right, what's next --- */}
      <Panel
        className={cn(
          "transition-shadow duration-200",
          flash === "correct" && "glow-correct",
          flash === "wrong" && "glow-error",
        )}
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="flex flex-col items-center gap-1">
            <span className="hud-label">Detected</span>
            <span
              className={cn(
                "readout text-6xl leading-none font-semibold transition-colors",
                !mounted || !reading
                  ? "text-[var(--color-hairline-bright)]"
                  : flash === "wrong"
                    ? "text-[var(--color-error)]"
                    : "text-[var(--color-ink)]",
              )}
            >
              {mounted && reading && uiState !== "no_signal" ? reading.note.name : "—"}
              {mounted && reading && uiState !== "no_signal" && (
                <span className="text-2xl text-[var(--color-ink-faint)]">{reading.note.octave}</span>
              )}
            </span>
            <span className="readout text-xs text-[var(--color-ink-faint)]">
              {mounted && reading && uiState !== "no_signal"
                ? `${reading.cents > 0 ? "+" : ""}${reading.cents.toFixed(1)}¢${
                    positionState.string !== null
                      ? ` · str ${positionState.string + 1} fret ${positionState.fret}`
                      : ""
                  }`
                : signal.message || "listening"}
            </span>
          </div>

          <div className="flex items-center justify-center">
            <span
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-full border text-2xl transition-all duration-200",
                flash === "correct"
                  ? "scale-110 border-[var(--color-correct)] bg-[rgba(57,224,139,0.18)] text-[var(--color-correct)]"
                  : flash === "wrong"
                    ? "scale-110 border-[var(--color-error)] bg-[rgba(255,84,112,0.16)] text-[var(--color-error)]"
                    : "border-[var(--color-hairline)] text-[var(--color-hairline-bright)]",
              )}
            >
              {flash === "correct" ? "✓" : flash === "wrong" ? "✕" : "·"}
            </span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <span className="hud-label">Play next</span>
            <span className="readout text-6xl leading-none font-semibold text-[var(--color-signal)]">
              {currentStep?.label ?? "✓"}
            </span>
            <span className="readout text-xs text-[var(--color-ink-faint)]">
              {currentStep
                ? requirePosition
                  ? describeTarget(currentStep, board)
                  : `${currentStep.degree ?? ""}${
                      currentStep.position
                        ? ` · string ${currentStep.position.string + 1}, fret ${currentStep.position.fret}`
                        : ""
                    }`
                : "sequence complete"}
            </span>
          </div>
        </div>

        <div className="mt-6">
          <NoteStrip steps={sequence.steps} index={index} verdicts={verdicts} />
        </div>

        <div className="mt-5 h-1 overflow-hidden rounded-full bg-[var(--color-hairline)]">
          <div
            className="h-full rounded-full bg-[var(--color-signal)] transition-[width] duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </Panel>

      <Panel title="Path on the neck">
        <Fretboard
          board={board}
          markers={markers}
          path={sequence.steps
            .map((step) => step.position)
            .filter((position): position is { string: number; fret: number } => position !== undefined)}
          lowStringOnTop={lowStringOnTop}
          onSelect={(position) => detectionHub.mock?.pluck(position.midi)}
        />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Exercise">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              options={[
                { value: "note", label: "Note", hint: "Play the target note anywhere" },
                { value: "fret", label: "Fret", hint: "Play it at an exact string and fret" },
                { value: "interval", label: "Interval", hint: "Play an interval from the root" },
              ]}
              value={kind}
              onChange={(value) => setKind(value as ExerciseKind)}
            />
            <SegmentedControl
              options={[
                { value: "scale", label: "Scale run" },
                { value: "position", label: "Position box" },
                { value: "arpeggio", label: "Arpeggio" },
              ]}
              value={kind}
              onChange={(value) => setKind(value as ExerciseKind)}
            />
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={ascendDescend}
                onChange={(event) => setAscendDescend(event.target.checked)}
                className="h-4 w-4 accent-[var(--color-signal)]"
              />
              <span className="text-xs text-[var(--color-ink-dim)]">Up and back down</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={matchOctave}
                onChange={(event) => patch({ matchOctave: event.target.checked })}
                className="h-4 w-4 accent-[var(--color-signal)]"
              />
              <span className="text-xs text-[var(--color-ink-dim)]">Exact octave</span>
            </label>
          </div>

          {drill && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-[var(--color-ink-dim)]">
                Targets
                <select
                  value={drillLength}
                  onChange={(event) => setDrillLength(Number(event.target.value))}
                  className="h-8 rounded-lg border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-2 text-xs"
                >
                  {[5, 10, 20, 40].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <Button size="sm" onClick={() => setDrillSeed((value) => value + 1)}>
                New drill
              </Button>
              <span className="text-[11px] text-[var(--color-ink-faint)]">{drill.instruction}</span>
            </div>
          )}

          {kind === "position" && shapes.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="hud-label mr-1">Box</span>
              {shapes.map((shape, shapeIndex) => (
                <button
                  key={shape.index}
                  onClick={() => setPositionIndex(shapeIndex)}
                  className={cn(
                    "readout rounded-lg border px-2.5 py-1 text-xs transition-colors",
                    shapeIndex === positionIndex
                      ? "border-[var(--color-signal)] text-[var(--color-signal)]"
                      : "border-[var(--color-hairline)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]",
                  )}
                >
                  {shape.index}
                  <span className="ml-1.5 text-[9px] text-[var(--color-ink-faint)]">
                    {shape.minFret}–{shape.maxFret}
                  </span>
                </button>
              ))}
            </div>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            Change the root or scale on the Fretboard screen. Wrong notes hold position so
            you can correct yourself; press S to skip a note you cannot reach.
          </p>
        </Panel>

        <Panel title="This run" meta={<Badge tone={running ? "signal" : "neutral"}>{running ? "live" : "idle"}</Badge>}>
          <div className="grid grid-cols-2 gap-5">
            <Stat label="Correct" value={summary.correct} tone="correct" />
            <Stat label="Wrong" value={summary.wrong} tone={summary.wrong > 0 ? "error" : "default"} />
            <Stat
              label="Pitch accuracy"
              value={`${Math.round(summary.pitchAccuracy * 100)}%`}
              tone="signal"
            />
            <Stat label="Progress" value={`${index}/${sequence.steps.length}`} />
            <Stat label="Streak" value={streak} tone={streak >= 5 ? "correct" : "default"} />
            <Stat
              label="Avg reaction"
              value={
                reactions.length === 0
                  ? "—"
                  : (reactions.reduce((sum, r) => sum + r, 0) / reactions.length).toFixed(2)
              }
              unit={reactions.length === 0 ? undefined : "s"}
            />
          </div>
          {lastEvent?.verdict === "wrong" && (
            <p className="mt-4 rounded-xl border border-[rgba(255,84,112,0.3)] bg-[rgba(255,84,112,0.07)] p-3 text-xs leading-relaxed text-[var(--color-ink-dim)]">
              Heard <span className="readout">{formatNote(lastEvent.playedMidi)}</span> — the
              exercise wants <span className="readout text-[var(--color-signal)]">{lastEvent.step.label}</span>.
            </p>
          )}
          {lastEvent?.verdict === "wrong_position" && (
            <p className="mt-4 rounded-xl border border-[rgba(255,194,71,0.35)] bg-[rgba(255,194,71,0.08)] p-3 text-xs leading-relaxed text-[var(--color-ink-dim)]">
              Right note — wrong place. That was{" "}
              <span className="readout">
                {lastEvent.playedPosition
                  ? `string ${lastEvent.playedPosition.string + 1}, fret ${lastEvent.playedPosition.fret}`
                  : "somewhere else"}
              </span>
              ; the target is{" "}
              <span className="readout text-[var(--color-signal)]">
                {describeTarget(lastEvent.step, board)}
              </span>
              .
            </p>
          )}
        </Panel>
      </div>

      <InputSourcePanel board={board} />
    </div>
  );
}
