"use client";

import {
  type EvaluationEvent,
  type PracticeSequence,
  type StepVerdict,
  type TimingResult,
  PRACTICE_SPEEDS,
  PracticeEngine,
  SONGS,
  buildSlowPracticePlan,
  createFretboard,
  formatNote,
  getInstrument,
  getTuning,
  phraseToSequence,
  phrasesForTrack,
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
import { useAutoListen, useDetection, useFretPositionState } from "@/hooks/useDetection";
import { useKeyboard } from "@/hooks/useKeyboard";
import { useMetronome } from "@/hooks/useMetronome";
import { useMounted } from "@/hooks/useMounted";
import { useProgress } from "@/store/progress";
import { useSession } from "@/store/session";
import { useWeakAreas } from "@/store/weak-areas";
import { detectionHub } from "@/lib/audio/detection-hub";
import { fretSynth } from "@/lib/audio/fret-synth";
import { cn } from "@/lib/ui/cn";

const now = () => performance.now() / 1000;

/**
 * Song Practice: pick a piece, work through it one learnable phrase at a
 * time, at whatever fraction of tempo the phrase currently needs.
 *
 * Deliberately built on the same `PracticeEngine` the drill/scale trainer
 * uses — `phraseToSequence` exists precisely so this screen does not need a
 * second grading implementation. What's actually new here is the material
 * (a song broken into phrases instead of a generated drill) and the tempo
 * ladder, not the grading.
 */
export default function SongPage() {
  const mounted = useMounted();
  useAutoListen();
  const metronome = useMetronome();
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);

  const [trackId, setTrackId] = useState(SONGS[0]!.id);
  const track = useMemo(() => SONGS.find((t) => t.id === trackId) ?? SONGS[0]!, [trackId]);

  const board = useMemo(() => {
    const tuning = getTuning(track.tuningId)!;
    const instrument = getInstrument(track.instrumentId)!;
    return createFretboard(tuning, instrument.fretCount);
  }, [track]);

  const phrases = useMemo(() => phrasesForTrack(track), [track]);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const phrase = phrases[phraseIndex] ?? phrases[0]!;

  useEffect(() => {
    // A different song has a different number of phrases; land back on the first.
    setPhraseIndex(0);
  }, [trackId]);

  const [speedIndex, setSpeedIndex] = useState(PRACTICE_SPEEDS.length - 1);
  const speed = PRACTICE_SPEEDS[speedIndex]!;
  const bpm = Math.max(20, Math.round(track.bpm * speed));

  const [timed, setTimed] = useState(true);

  const sequence: PracticeSequence = useMemo(
    () => phraseToSequence(phrase, board, { bpm, timed }),
    [phrase, board, bpm, timed],
  );

  const plan = useMemo(() => buildSlowPracticePlan(track.bpm, phrase.difficulty), [track.bpm, phrase.difficulty]);

  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [lastEvent, setLastEvent] = useState<EvaluationEvent | null>(null);
  const [verdicts, setVerdicts] = useState<Map<number, StepVerdict>>(new Map());
  const [timings, setTimings] = useState<Map<number, TimingResult>>(new Map());
  const [summary, setSummary] = useState({ correct: 0, wrong: 0, pitchAccuracy: 0, timingAccuracy: 1, overall: 0 });
  const [flash, setFlash] = useState<"correct" | "wrong" | null>(null);

  const { activeMidi, reading, uiState, noteEventId } = useDetection();
  const positionState = useFretPositionState();

  useEffect(() => {
    detectionHub.setFretboard(board, track.instrumentId);
  }, [board, track.instrumentId]);

  const [engine, setEngine] = useState<PracticeEngine | null>(null);
  const attemptStartRef = useRef(0);
  const addRecord = useProgress((s) => s.addRecord);
  const recordResults = useWeakAreas((s) => s.recordResults);

  const resetDisplay = useCallback(() => {
    setIndex(0);
    setVerdicts(new Map());
    setTimings(new Map());
    setLastEvent(null);
    setFlash(null);
    setSummary({ correct: 0, wrong: 0, pitchAccuracy: 0, timingAccuracy: 1, overall: 0 });
  }, []);

  /** Rebuild whenever the phrase, tempo or timed choice changes; never mid-run. */
  useEffect(() => {
    setEngine(new PracticeEngine(sequence));
    setRunning(false);
    resetDisplay();
  }, [sequence, resetDisplay]);

  const stop = useCallback(
    (completed = false) => {
      if (engine) {
        const result = engine.summary;
        // Same threshold the drill trainer uses: only a run the player
        // actually got most of the way through pollutes the history less
        // than a two-note false start would.
        if (completed || result.correct >= Math.max(2, sequence.steps.length / 2)) {
          addRecord({
            exercise: `${track.title} — ${phrase.label}`,
            instrumentId: track.instrumentId,
            bpm,
            durationSeconds: Math.max(1, Math.round(now() - attemptStartRef.current)),
            pitchAccuracy: result.pitchAccuracy,
            timingAccuracy: result.timingAccuracy,
            overall: result.overall,
            notesCorrect: result.correct,
            notesTotal: sequence.steps.length,
          });
          recordResults(engine.history);
        }
      }
      engine?.stop();
      setRunning(false);
    },
    [engine, addRecord, recordResults, track, phrase, bpm, sequence],
  );

  const start = useCallback(async () => {
    if (timed && !metronome.isRunning) await metronome.start();
    const fresh = new PracticeEngine(sequence);
    setEngine(fresh);
    const startTime = timed ? metronome.startedAt() : now();
    attemptStartRef.current = now();
    fresh.start(startTime);
    setRunning(true);
    resetDisplay();
  }, [sequence, timed, metronome, resetDisplay]);

  useKeyboard({
    " ": () => (running ? stop() : void start()),
    Space: () => (running ? stop() : void start()),
  });

  /** The feedback loop — identical shape to the drill trainer's. */
  useEffect(() => {
    if (!running || !engine || noteEventId === 0 || activeMidi === null) return;

    const event = engine.submitNote({
      midi: activeMidi,
      time: timed ? metronome.now() : now(),
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
    if (event.timing) {
      const timing = event.timing;
      setTimings((previous) => {
        const next = new Map(previous);
        next.set(engine.currentIndex - 1, timing);
        return next;
      });
    }

    const result = engine.summary;
    setSummary({
      correct: result.correct,
      wrong: result.wrong,
      pitchAccuracy: result.pitchAccuracy,
      timingAccuracy: result.timingAccuracy,
      overall: result.overall,
    });
    setFlash(event.verdict === "correct" ? "correct" : event.verdict === "skipped" ? null : "wrong");
    if (event.completed) stop(true);
    // Keyed on noteEventId so replaying the same pitch still counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteEventId]);

  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), 260);
    return () => clearTimeout(timer);
  }, [flash]);

  const currentStep = sequence.steps[index] ?? null;
  const nextStep = sequence.steps[index + 1] ?? null;

  /**
   * The song already knows exactly where each note lives on the neck — a real
   * phrase is not restricted to positions that are unique on the fretboard the
   * way a fret drill's targets are. Without this hint the position estimator
   * has to guess among every place the detected pitch could be played, and its
   * guess is not always the one the phrase actually intends, which shows up as
   * a wrong-looking highlight for a correctly played note. Position is never
   * graded on this screen (only pitch is), so telling the estimator the answer
   * sharpens the display without making anything easier to pass.
   */
  useEffect(() => {
    detectionHub.setPositionContext(running && currentStep?.position ? { expected: currentStep.position } : {});
  }, [running, currentStep]);

  const markers = useMemo<FretMarker[]>(() => {
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
      put({ string: nextStep.position.string, fret: nextStep.position.fret, label: nextStep.label, tone: "next", order: 2 });
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
  const difficultyLabel = phrase.difficulty > 0.66 ? "Hard" : phrase.difficulty > 0.33 ? "Medium" : "Easy";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{track.title}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
            {phrase.label} · {board.tuning.name} · {bpm} BPM
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={metronome.isRunning ? "primary" : "secondary"} size="sm" onClick={() => void metronome.toggle()}>
            {metronome.isRunning ? `Click ${bpm}` : "Metronome"}
          </Button>
          <Button variant={running ? "danger" : "primary"} onClick={() => (running ? stop() : void start())}>
            {running ? "Stop" : "Play phrase"}
          </Button>
        </div>
      </header>

      <Panel title="Songs">
        <div className="flex flex-wrap gap-2">
          {SONGS.map((song) => (
            <button
              key={song.id}
              onClick={() => setTrackId(song.id)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2 text-left transition-all",
                song.id === trackId
                  ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)]"
                  : "border-[var(--color-hairline)] hover:border-[var(--color-hairline-bright)]",
              )}
            >
              <span className="text-xs font-medium">{song.title}</span>
              <span className="readout text-[10px] text-[var(--color-ink-faint)]">
                {getInstrument(song.instrumentId)?.name} · {song.bpm} BPM
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="hud-label mr-1">Phrase</span>
          {phrases.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setPhraseIndex(i)}
              className={cn(
                "readout rounded-lg border px-2.5 py-1 text-xs transition-colors",
                i === phraseIndex
                  ? "border-[var(--color-signal)] text-[var(--color-signal)]"
                  : "border-[var(--color-hairline)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Panel>

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
                flash === "wrong" ? "text-[var(--color-error)]" : "text-[var(--color-ink)]",
              )}
            >
              {mounted && reading && uiState !== "no_signal" ? formatNote(reading.note.midi) : "—"}
            </span>
            <span className="readout text-xs text-[var(--color-ink-faint)]">
              {mounted && reading && uiState !== "no_signal" && positionState.string !== null
                ? `str ${positionState.string + 1} fret ${positionState.fret}`
                : "listening"}
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
              {currentStep?.position
                ? `string ${currentStep.position.string + 1}, fret ${currentStep.position.fret}`
                : currentStep
                  ? "any position"
                  : "phrase complete"}
            </span>
          </div>
        </div>

        <div className="mt-6">
          <NoteStrip steps={sequence.steps} index={index} verdicts={verdicts} timings={timed ? timings : undefined} />
        </div>

        <div className="mt-5 h-1 overflow-hidden rounded-full bg-[var(--color-hairline)]">
          <div
            className="h-full rounded-full bg-[var(--color-signal)] transition-[width] duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </Panel>

      <Panel title="On the neck">
        <Fretboard
          board={board}
          markers={markers}
          activeEventId={noteEventId}
          lowStringOnTop={lowStringOnTop}
          onSelect={(position) => {
            detectionHub.mock?.pluck(position.midi);
            void fretSynth.pluck(position.midi);
          }}
        />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Tempo">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              size="sm"
              options={PRACTICE_SPEEDS.map((s) => ({ value: String(s), label: `${Math.round(s * 100)}%` }))}
              value={String(speed)}
              onChange={(value) => setSpeedIndex(PRACTICE_SPEEDS.indexOf(Number(value) as (typeof PRACTICE_SPEEDS)[number]))}
            />
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={timed}
                onChange={(event) => setTimed(event.target.checked)}
                className="h-4 w-4 accent-[var(--color-signal)]"
              />
              <span className="text-xs text-[var(--color-ink-dim)]">Grade to the click</span>
            </label>
            <Badge tone={difficultyLabel === "Hard" ? "warn" : difficultyLabel === "Medium" ? "signal" : "correct"}>
              {difficultyLabel} phrase
            </Badge>
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            Suggested ramp for this phrase:{" "}
            {plan.map((step, i) => (
              <span key={step.speed}>
                {i > 0 && " → "}
                <span className="readout text-[var(--color-ink-dim)]">
                  {Math.round(step.speed * 100)}% ({step.bpm} BPM) ×{step.repetitions}
                </span>
              </span>
            ))}
            . Get each step clean before moving to the next.
          </p>

          <p className="mt-4 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            Space starts and stops the phrase. Change instrument and tuning on the Fretboard screen.
          </p>
        </Panel>

        <Panel title="This phrase" meta={<Badge tone={running ? "signal" : "neutral"}>{running ? "live" : "idle"}</Badge>}>
          <div className="grid grid-cols-2 gap-5">
            <Stat label="Correct" value={summary.correct} tone="correct" />
            <Stat label="Wrong" value={summary.wrong} tone={summary.wrong > 0 ? "error" : "default"} />
            <Stat label="Pitch accuracy" value={`${Math.round(summary.pitchAccuracy * 100)}%`} tone="signal" />
            <Stat
              label="Timing accuracy"
              value={timed ? `${Math.round(summary.timingAccuracy * 100)}%` : "—"}
              tone="signal"
            />
            <Stat label="Progress" value={`${index}/${sequence.steps.length}`} />
          </div>
          {lastEvent?.verdict === "wrong" && (
            <p className="mt-4 rounded-xl border border-[rgba(255,84,112,0.3)] bg-[rgba(255,84,112,0.07)] p-3 text-xs leading-relaxed text-[var(--color-ink-dim)]">
              Heard something else — the phrase wants{" "}
              <span className="readout text-[var(--color-signal)]">{lastEvent.step.label}</span>.
            </p>
          )}
        </Panel>
      </div>

      <InputSourcePanel board={board} />
    </div>
  );
}
