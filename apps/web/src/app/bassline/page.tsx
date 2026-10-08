"use client";

import {
  type BasslineDifficulty,
  type ChordId,
  type ChordSlot,
  type EvaluationEvent,
  type PitchClass,
  type PracticeSequence,
  type StepVerdict,
  type TimingResult,
  CHORDS,
  PracticeEngine,
  SHARP_NAMES,
  createFretboard,
  formatNote,
  generateBassline,
  getChord,
  getInstrument,
  getTuning,
  phraseToSequence,
  progressionLengthBeats,
} from "@fretlight/core";
import Link from "next/link";
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
import { detectionHub } from "@/lib/audio/detection-hub";
import { fretSynth } from "@/lib/audio/fret-synth";
import { useProgress } from "@/store/progress";
import { useWeakAreas } from "@/store/weak-areas";
import { cn } from "@/lib/ui/cn";

const now = () => performance.now() / 1000;

/** A short, curated set — the full 16-chord library is overkill for building a progression by ear. */
const CHORD_CHOICES: readonly ChordId[] = ["major", "minor", "dom7", "maj7", "min7", "sus4"];

/** E -> C#m -> B -> A — the exact progression used as the spec's own example. */
const DEFAULT_PROGRESSION: ChordSlot[] = [
  { root: 4, chord: "major", beats: 4 },
  { root: 1, chord: "minor", beats: 4 },
  { root: 11, chord: "major", beats: 4 },
  { root: 9, chord: "major", beats: 4 },
];

const DIFFICULTY_INFO: Record<BasslineDifficulty, string> = {
  beginner: "Root only, held for the whole chord — the line you have to play before anything else.",
  intermediate: "Root, the chord's own colour tone and the 5th, as a simple root-led cell.",
  advanced: "The intermediate cell plus a chromatic note leading into the next chord's root.",
};

function chordLabel(slot: ChordSlot): string {
  return getChord(slot.root, slot.chord)?.symbol ?? "?";
}

/**
 * Chord -> Bassline: build a progression, generate a bassline at one of
 * three difficulty tiers, and practice it through the same engine every
 * other practice screen uses. Nothing here is invented — `generateBassline`
 * only ever picks tones that belong to the chord actually sounding (see its
 * own doc comment), so changing the progression genuinely changes what gets
 * generated rather than reshuffling a fixed shape.
 */
export default function BasslinePage() {
  const mounted = useMounted();
  useAutoListen();
  const metronome = useMetronome();

  const instrument = getInstrument("bass-4")!;
  const board = useMemo(() => createFretboard(getTuning("bass-4-standard")!, instrument.fretCount), [instrument]);

  const [progression, setProgression] = useState<ChordSlot[]>(DEFAULT_PROGRESSION);
  const [newRoot, setNewRoot] = useState<PitchClass>(0);
  const [newChord, setNewChord] = useState<ChordId>("major");
  const [difficulty, setDifficulty] = useState<BasslineDifficulty>("beginner");
  const [bpm, setBpm] = useState(80);
  const [timed, setTimed] = useState(false);

  const notes = useMemo(() => generateBassline(progression, difficulty, { octave: 1 }), [progression, difficulty]);
  const sequence: PracticeSequence = useMemo(() => {
    const lengthBeats = progressionLengthBeats(progression);
    return phraseToSequence(
      { id: "bassline", label: "Generated bassline", notes, startBeat: 0, lengthBeats, difficulty: 0.5 },
      board,
      { bpm, timed },
    );
  }, [notes, progression, board, bpm, timed]);

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
    detectionHub.setFretboard(board, "bass-4");
  }, [board]);

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

  useEffect(() => {
    setEngine(new PracticeEngine(sequence));
    setRunning(false);
    resetDisplay();
  }, [sequence, resetDisplay]);

  const stop = useCallback(
    (completed = false) => {
      if (engine) {
        const result = engine.summary;
        if (completed || result.correct >= Math.max(2, sequence.steps.length / 2)) {
          addRecord({
            exercise: `Bassline · ${progression.map(chordLabel).join(" ")}`,
            instrumentId: "bass-4",
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
    [engine, addRecord, recordResults, progression, bpm, sequence],
  );

  const start = useCallback(async () => {
    if (timed && !metronome.isRunning) await metronome.start();
    const fresh = new PracticeEngine(sequence);
    setEngine(fresh);
    attemptStartRef.current = now();
    fresh.start(timed ? metronome.startedAt() : now());
    setRunning(true);
    resetDisplay();
  }, [sequence, timed, metronome, resetDisplay]);

  useKeyboard({
    " ": () => (running ? stop() : void start()),
    Space: () => (running ? stop() : void start()),
  });

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
   * Same reasoning as Song: the generated line already fixes exactly which
   * string and fret each note is, so telling the estimator sharpens the
   * highlight instead of leaving it to guess among every place the detected
   * pitch could live. Position is never graded here — only pitch is — so
   * this changes the display, not what counts as correct.
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
      put({ string: step.position.string, fret: step.position.fret, label: step.label, tone: stepIndex < index ? "ghost" : "next" });
    });
    if (nextStep?.position) put({ string: nextStep.position.string, fret: nextStep.position.fret, label: nextStep.label, tone: "next", order: 2 });
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

  const addChord = () => setProgression((previous) => [...previous, { root: newRoot, chord: newChord, beats: 4 }]);
  const removeChord = (i: number) => setProgression((previous) => previous.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Chord → Bassline</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
            {progression.map(chordLabel).join(" → ") || "empty progression"} · {bpm} BPM
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={metronome.isRunning ? "primary" : "secondary"} size="sm" onClick={() => void metronome.toggle()}>
            {metronome.isRunning ? `Click ${bpm}` : "Metronome"}
          </Button>
          <Button
            variant={running ? "danger" : "primary"}
            onClick={() => (running ? stop() : void start())}
            disabled={sequence.steps.length === 0}
          >
            {running ? "Stop" : "Play line"}
          </Button>
        </div>
      </header>

      <Panel title="Progression">
        <div className="flex flex-wrap items-center gap-2">
          {progression.map((slot, i) => (
            <button
              key={i}
              onClick={() => removeChord(i)}
              title="Remove"
              className="readout flex items-center gap-1.5 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 py-1.5 text-xs text-[var(--color-ink-dim)] transition-colors hover:border-[rgba(255,84,112,0.4)] hover:text-[var(--color-error)]"
            >
              {chordLabel(slot)}
              <span className="text-[var(--color-ink-faint)]">×</span>
            </button>
          ))}
          {progression.length === 0 && (
            <span className="text-xs text-[var(--color-ink-faint)]">No chords yet — add one below.</span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={newRoot}
            onChange={(event) => setNewRoot(Number(event.target.value) as PitchClass)}
            className="h-9 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-2.5 text-xs text-[var(--color-ink-dim)]"
          >
            {SHARP_NAMES.map((name, pc) => (
              <option key={name} value={pc}>{name}</option>
            ))}
          </select>
          <select
            value={newChord}
            onChange={(event) => setNewChord(event.target.value as ChordId)}
            className="h-9 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-2.5 text-xs text-[var(--color-ink-dim)]"
          >
            {CHORD_CHOICES.map((id) => (
              <option key={id} value={id}>{CHORDS[id].name}</option>
            ))}
          </select>
          <Button size="sm" onClick={addChord}>Add chord</Button>
          <Button size="sm" variant="ghost" onClick={() => setProgression(DEFAULT_PROGRESSION)}>
            Reset to example
          </Button>
        </div>

        {progression.length >= 2 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-dim)]">
            <span>Take this progression further:</span>
            <Link
              href={`/companion?tab=ideas&instrument=bass&prog=${encodeURIComponent(progression.map(chordLabel).join(" "))}`}
              className="rounded-lg border border-[var(--color-hairline-bright)] px-2.5 py-1.5 hover:border-[var(--color-signal)]"
            >
              More bass ideas in Companion →
            </Link>
            <Link
              href={`/companion?tab=loop&instrument=bass&prog=${encodeURIComponent(progression.map(chordLabel).join(" "))}`}
              className="rounded-lg border border-[var(--color-hairline-bright)] px-2.5 py-1.5 hover:border-[var(--color-signal)]"
            >
              Record it in the Looper →
            </Link>
          </div>
        )}

        <div className="mt-5 border-t border-[var(--color-hairline)] pt-4">
          <span className="hud-label mb-2 block">Difficulty</span>
          <SegmentedControl
            options={[
              { value: "beginner", label: "Beginner" },
              { value: "intermediate", label: "Intermediate" },
              { value: "advanced", label: "Advanced" },
            ]}
            value={difficulty}
            onChange={(value) => setDifficulty(value as BasslineDifficulty)}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">{DIFFICULTY_INFO[difficulty]}</p>
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
            <span className={cn("readout text-6xl leading-none font-semibold transition-colors", flash === "wrong" ? "text-[var(--color-error)]" : "text-[var(--color-ink)]")}>
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
                  : "line complete"}
            </span>
          </div>
        </div>

        <div className="mt-6">
          <NoteStrip steps={sequence.steps} index={index} verdicts={verdicts} timings={timed ? timings : undefined} />
        </div>

        <div className="mt-5 h-1 overflow-hidden rounded-full bg-[var(--color-hairline)]">
          <div className="h-full rounded-full bg-[var(--color-signal)] transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
      </Panel>

      <Panel title="On the neck">
        <Fretboard
          board={board}
          markers={markers}
          activeEventId={noteEventId}
          onSelect={(position) => {
            detectionHub.mock?.pluck(position.midi);
            void fretSynth.pluck(position.midi);
          }}
        />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Tempo">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-[var(--color-ink-dim)]">
              BPM
              <input
                type="number"
                min={40}
                max={220}
                value={bpm}
                onChange={(event) => setBpm(Math.max(40, Math.min(220, Number(event.target.value) || 80)))}
                className="h-8 w-16 rounded-lg border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-2 text-xs"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={timed}
                onChange={(event) => setTimed(event.target.checked)}
                className="h-4 w-4 accent-[var(--color-signal)]"
              />
              <span className="text-xs text-[var(--color-ink-dim)]">Grade to the click</span>
            </label>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            Space starts and stops the line. Every note above comes from the chord actually
            playing at that point — change the progression and the bassline changes with it.
          </p>
        </Panel>

        <Panel title="This line" meta={<Badge tone={running ? "signal" : "neutral"}>{running ? "live" : "idle"}</Badge>}>
          <div className="grid grid-cols-2 gap-5">
            <Stat label="Correct" value={summary.correct} tone="correct" />
            <Stat label="Wrong" value={summary.wrong} tone={summary.wrong > 0 ? "error" : "default"} />
            <Stat label="Pitch accuracy" value={`${Math.round(summary.pitchAccuracy * 100)}%`} tone="signal" />
            <Stat label="Timing accuracy" value={timed ? `${Math.round(summary.timingAccuracy * 100)}%` : "—"} tone="signal" />
            <Stat label="Progress" value={`${index}/${sequence.steps.length}`} />
          </div>
        </Panel>
      </div>

      <InputSourcePanel board={board} />
    </div>
  );
}
