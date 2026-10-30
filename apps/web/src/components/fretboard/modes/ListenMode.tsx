"use client";

import { CHORDS, type ChordMatch, type Fretboard as FretboardModel, SHARP_NAMES, getChord, noteAt } from "@fretlight/core";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { RecordingPanel } from "@/components/audio/RecordingPanel";
import { InputBar } from "@/components/audio/InputBar";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useAudioState } from "@/hooks/useDetection";
import { useFretboardContext } from "@/hooks/useFretboard";
import { ChordListener, type ChordFrame } from "@/lib/audio/chord-listener";
import { chordShapes } from "@/lib/audio/chord-shapes";
import { detectionHub } from "@/lib/audio/detection-hub";
import { detectionMarkers } from "@/lib/audio/detection-markers";
import {
  LiveHistory,
  LiveInterpreter,
  type LiveDecision,
  type LiveMode,
  decisionLabel,
  formatEventTime,
} from "@/lib/audio/live-interpreter";
import { sharedInput } from "@/lib/audio/shared-input";
import { useSession } from "@/store/session";

const STANDARD_GUITAR = "40,45,50,55,59,64";
const history = new LiveHistory();

/**
 * Live fretboard: one input, the existing note detector (detectionHub) and,
 * when needed, the existing chord detector attached to the same stream.
 */
export function ListenMode() {
  const { board } = useFretboardContext();
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);
  const audio = useAudioState();
  const micOn = audio.sourceKind === "microphone" && audio.listening;

  const [mode, setMode] = useState<LiveMode>("auto");
  const [showLabels, setShowLabels] = useState(true);
  const [showShape, setShowShape] = useState(true);
  const [showConfidence, setShowConfidence] = useState(true);
  const decision = useLiveDecision(micOn, mode, audio.deviceLabel);

  useEffect(() => () => { void detectionHub.disable(); }, []);

  return (
    <div className="flex flex-col gap-6">
      <InputBar />

      <Panel
        title="Live fretboard"
        meta={
          <SegmentedControl
            size="sm"
            options={[
              { value: "note", label: "Note", hint: "Single notes: name, octave, Hz, possible positions" },
              { value: "chord", label: "Chord", hint: "Chord name and a suggested shape" },
              { value: "auto", label: "Auto", hint: "Choose note or chord from the evidence" },
            ]}
            value={mode}
            onChange={setMode}
          />
        }
      >
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--color-ink-dim)]">
          <Check label="Note labels" value={showLabels} onChange={setShowLabels} />
          <Check label="Suggested chord shape" value={showShape} onChange={setShowShape} />
          <Check label="Confidence" value={showConfidence} onChange={setShowConfidence} />
        </div>
        <LiveView
          board={board}
          decision={micOn ? decision : { kind: "silent" }}
          micOn={micOn}
          showLabels={showLabels}
          showShape={showShape}
          showConfidence={showConfidence}
          lowStringOnTop={lowStringOnTop}
        />
      </Panel>

      <HistoryPanel />
      <RecordingPanel />
    </div>
  );
}

/** Runs the interpreter off the React render path; re-renders only when what's shown changes. */
function useLiveDecision(micOn: boolean, mode: LiveMode, deviceLabel: string): LiveDecision {
  const [decision, setDecision] = useState<LiveDecision>({ kind: "silent" });
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const needChords = micOn && mode !== "note";

  // The chord detector only runs when its output is wanted, on the note detector's stream.
  const frame = useRef<ChordFrame | null>(null);
  useEffect(() => {
    const input = sharedInput.current;
    if (!needChords || !input) return;
    const listener = new ChordListener();
    listener.attach(input, deviceLabel, (f) => { frame.current = f; });
    return () => { frame.current = null; void listener.stop(); };
  }, [needChords, deviceLabel]);

  useEffect(() => {
    if (!micOn) { setDecision({ kind: "silent" }); return; }
    const interpreter = new LiveInterpreter();
    const origin = performance.now();
    history.clear();
    let lastKey = "";
    const tick = () => {
      const now = performance.now();
      const next = interpreter.update(now, modeRef.current, detectionHub.getPitchState(), frame.current);
      history.observe(next, now, origin);
      const key = next.kind === "note"
        ? `${decisionLabel(next)}:${next.frequency.toFixed(1)}:${Math.round(next.cents ?? 0)}:${Math.round(next.confidence * 20)}`
        : next.kind === "chord" ? `${decisionLabel(next)}:${next.heard.join()}:${Math.round(next.chord.confidence * 20)}` : next.kind;
      if (key !== lastKey) { lastKey = key; setDecision(next); }
    };
    const timer = setInterval(tick, 50);
    // Safari suspends audio when backgrounded; resume on return.
    const onVisible = () => { if (document.visibilityState === "visible") void sharedInput.resume().catch(() => {}); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [micOn]);

  return decision;
}

function LiveView({ board, decision, micOn, showLabels, showShape, showConfidence, lowStringOnTop }: {
  board: FretboardModel; decision: LiveDecision; micOn: boolean; showLabels: boolean; showShape: boolean; showConfidence: boolean; lowStringOnTop: boolean;
}) {
  const chord = decision.kind === "chord" ? decision.chord : null;
  const shapes = useMemo(
    () => (chord && board.openMidi.join() === STANDARD_GUITAR ? chordShapes(chord.root, chord.chordId) : []),
    [chord?.root, chord?.chordId, board], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [shapeIndex, setShapeIndex] = useState(0);
  useEffect(() => setShapeIndex(0), [chord?.symbol]);
  const shape = showShape ? shapes[shapeIndex] ?? null : null;

  const markers = useMemo<FretMarker[]>(() => {
    let list: FretMarker[] = [];
    if (decision.kind === "note") {
      list = detectionMarkers(board, { kind: "note", midi: decision.midi, frequency: decision.frequency, confidence: decision.confidence });
    } else if (chord && shape) {
      list = shapeMarkers(board, chord, shape.frets);
    } else if (chord) {
      list = detectionMarkers(board, { kind: "chord", chord, notes: [] });
    }
    return showLabels ? list : list.map((m) => ({ ...m, label: "" }));
  }, [board, decision, chord, shape, showLabels]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-[72px] flex-wrap items-end gap-x-6 gap-y-2" aria-live="polite">
        {decision.kind === "note" && (
          <>
            <span className="readout text-4xl font-semibold text-[var(--color-signal)]">{decision.name}<sub className="text-xl">{decision.octave}</sub></span>
            <span className="readout text-sm">{decision.frequency.toFixed(2)} Hz</span>
            {decision.cents !== null && <span className="readout text-sm">{decision.cents > 0 ? "+" : ""}{decision.cents.toFixed(0)} cents</span>}
            {showConfidence && <Badge tone="neutral">{Math.round(decision.confidence * 100)}% confidence</Badge>}
          </>
        )}
        {decision.kind === "chord" && chord && (
          <>
            <span className="readout text-4xl font-semibold text-[var(--color-signal)]">{chord.symbol || chord.rootName}</span>
            <span className="text-sm text-[var(--color-ink-dim)]">{CHORDS[chord.chordId].name}</span>
            {showConfidence && <Badge tone={chord.confidence >= 0.85 ? "theory" : "neutral"}>{chord.confidence >= 0.85 ? "" : "Uncertain · "}{Math.round(chord.confidence * 100)}%</Badge>}
          </>
        )}
        {decision.kind === "uncertain" && <span className="text-lg text-[var(--color-warn)]">Uncertain — keep playing, or let the note ring</span>}
        {decision.kind === "silent" && <span className="text-sm text-[var(--color-ink-faint)]">{micOn ? "Listening… play a note or chord" : "Turn the input on to start listening"}</span>}
      </div>

      {chord && decision.kind === "chord" && (
        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="hud-label">Chord tones (theory)</dt>
            <dd className="readout mt-1">{getChord(chord.root, chord.chordId)?.tones.map((t) => t.name).join(" ")}</dd>
          </div>
          <div>
            <dt className="hud-label">Heard in audio (may include harmonics)</dt>
            <dd className="readout mt-1">{decision.heard.map((pc) => SHARP_NAMES[pc]).join(" ") || "—"}</dd>
          </div>
        </dl>
      )}

      {showShape && shapes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="hud-label">Suggested shape</span>
          {shapes.map((s, i) => (
            <Button key={s.name} size="sm" variant={i === shapeIndex ? "primary" : "secondary"} onClick={() => setShapeIndex(i)}>{s.name}</Button>
          ))}
        </div>
      )}

      <Fretboard board={board} toFret={12} markers={markers} lowStringOnTop={lowStringOnTop} className="transition-opacity" />
      <p className="text-xs text-[var(--color-ink-faint)]">
        {decision.kind === "chord" && shape
          ? "Showing a recommended fingering — audio cannot tell which voicing you played."
          : "Audio identifies pitch and octave, not the string. Every highlighted spot is a possible position."}
      </p>
    </div>
  );
}

function shapeMarkers(board: FretboardModel, chord: ChordMatch, frets: readonly number[]): FretMarker[] {
  return frets.flatMap((fret, string) => {
    const p = fret < 0 ? null : noteAt(board, string, fret);
    return p ? [{ string, fret, label: `${p.name}${p.octave}`, tone: p.pitchClass === chord.root ? "root" : "chord", emphasis: true } as FretMarker] : [];
  });
}

function HistoryPanel() {
  const events = useSyncExternalStore(history.subscribe, history.getSnapshot, () => []);
  const recent = events.slice(-12).reverse();
  return (
    <Panel title="Recent detections" meta={events.length ? <Button size="sm" onClick={() => history.clear()}>Clear</Button> : undefined}>
      {recent.length === 0 ? (
        <p className="text-xs text-[var(--color-ink-faint)]">Stable notes and chords appear here with a timestamp.</p>
      ) : (
        <ol className="readout max-h-56 overflow-y-auto text-sm">
          {recent.map((e) => (
            <li key={e.id} className="flex gap-3 py-0.5">
              <span className="text-[var(--color-ink-faint)]">{formatEventTime(e.at)}</span>
              <span>{e.kind === "chord" && e.chord ? `${e.label} (${CHORDS[e.chord.chordId].name})` : e.label}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
