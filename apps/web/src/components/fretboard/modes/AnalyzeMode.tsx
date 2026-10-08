"use client";

import {
  SHARP_NAMES,
  type DiatonicChord,
  type KeyMode,
  type MusicKey,
  detectChord,
  detectKey,
  getDiatonicChords,
  getDiatonicSevenths,
  getKey,
  mod,
} from "@fretlight/core";
import { useMemo, useRef, useState } from "react";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { NotePicker } from "@/components/ui/NotePicker";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useFretboardContext } from "@/hooks/useFretboard";
import { fretSynth } from "@/lib/audio/fret-synth";
import { playChord, playNote, playScale, stopTheory } from "@/lib/audio/theory-player";
import { cn } from "@/lib/ui/cn";
import { downloadAnalysisPng } from "@/lib/ui/export-analysis";
import { useSession } from "@/store/session";

interface ChordSel {
  readonly keyName: string;
  readonly seventh: boolean;
  readonly degree: number;
}

const posKey = (string: number, fret: number) => `${string}:${fret}`;

export function AnalyzeMode() {
  const { board } = useFretboardContext();
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);
  const boardRef = useRef<HTMLDivElement>(null);

  // All local: this tab never writes to the shared session store.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [chosenKey, setChosenKey] = useState<MusicKey | null>(null);
  const [chordSel, setChordSel] = useState<ChordSel | null>(null);
  const [manualMode, setManualMode] = useState<KeyMode>("major");
  const [saving, setSaving] = useState(false);
  // Off by default: the neck shows only what you tapped until you ask for a key overlay.
  const [showKey, setShowKey] = useState(false);

  // Selected positions that still exist on the current board (tuning/fret count can change).
  const selectedPositions = useMemo(
    () =>
      [...selected]
        .map((id) => {
          const [string, fret] = id.split(":").map(Number) as [number, number];
          const open = board.openMidi[string];
          return open === undefined || fret > board.fretCount ? null : { string, fret, midi: open + fret };
        })
        .filter((p): p is { string: number; fret: number; midi: number } => p !== null)
        .sort((a, b) => a.midi - b.midi),
    [selected, board],
  );

  const selectedPcs = useMemo(
    () => [...new Set(selectedPositions.map((p) => mod(p.midi, 12)))],
    [selectedPositions],
  );

  const detection = useMemo(() => detectKey(selectedPcs), [selectedPcs]);
  const activeKey: MusicKey | null = chosenKey ?? detection.best?.key ?? null;

  const triads = useMemo(() => (activeKey ? getDiatonicChords(activeKey) : []), [activeKey]);
  const sevenths = useMemo(() => (activeKey ? getDiatonicSevenths(activeKey) : []), [activeKey]);

  const chord: DiatonicChord | null =
    activeKey && chordSel && chordSel.keyName === activeKey.name
      ? ((chordSel.seventh ? sevenths : triads)[chordSel.degree] ?? null)
      : null;

  const detectedChord = useMemo(() => {
    if (selectedPcs.length < 3) return null;
    const top = detectChord(selectedPcs, 1)[0];
    return top && top.confidence >= 0.8 ? top : null;
  }, [selectedPcs]);

  const selectedNames = useMemo(() => {
    const names = new Map<number, string>();
    activeKey?.pitchClasses.forEach((pc, i) => names.set(pc, activeKey.notes[i]!));
    return selectedPcs.map((pc) => names.get(pc) ?? SHARP_NAMES[pc]!);
  }, [selectedPcs, activeKey]);

  const markers = useMemo<FretMarker[]>(() => {
    const names = new Map<number, string>();
    if (activeKey) activeKey.pitchClasses.forEach((pc, i) => names.set(pc, activeKey.notes[i]!));
    if (chord) chord.pitchClasses.forEach((pc, i) => names.set(pc, chord.notes[i]!));
    const nameOf = (pc: number) => names.get(pc) ?? SHARP_NAMES[pc]!;

    const highlight = chord
      ? new Set(chord.pitchClasses)
      : activeKey && showKey
        ? new Set(activeKey.pitchClasses)
        : null;
    const rootPc = chord ? chord.root : activeKey?.root;
    const out = new Map<string, FretMarker>();

    if (highlight) {
      for (let string = 0; string < board.stringCount; string++) {
        for (let fret = 0; fret <= board.fretCount; fret++) {
          const pc = mod(board.openMidi[string]! + fret, 12);
          if (!highlight.has(pc)) continue;
          out.set(posKey(string, fret), {
            string,
            fret,
            label: nameOf(pc),
            tone: pc === rootPc ? "root" : chord ? "chord" : "scale",
          });
        }
      }
    }
    // What the user picked sits on top in white, so it stays distinguishable from the key overlay.
    for (const p of selectedPositions) {
      out.set(posKey(p.string, p.fret), {
        string: p.string,
        fret: p.fret,
        label: nameOf(mod(p.midi, 12)),
        tone: "live",
      });
    }
    return [...out.values()];
  }, [board, activeKey, chord, showKey, selectedPositions]);

  const toggle = (string: number, fret: number, midi: number) => {
    const id = posKey(string, fret);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Selection changed: drop manual choices so the detected key follows the notes.
    setChosenKey(null);
    setChordSel(null);
    void fretSynth.pluck(midi);
  };

  const clear = () => {
    stopTheory();
    setSelected(new Set());
    setChosenKey(null);
    setChordSel(null);
    setShowKey(false);
  };

  const pickKey = (key: MusicKey) => {
    setChosenKey(key);
    setChordSel(null);
    setShowKey(true);
  };

  const keySymbols = triads.map((c) => c.symbol);

  const save = async () => {
    const svg = boardRef.current?.querySelector("svg");
    if (!svg) return;
    setSaving(true);
    try {
      const lines: { label: string; value: string }[] = [];
      if (selectedNames.length) lines.push({ label: "Selected notes", value: selectedNames.join(" ") });
      if (activeKey) {
        lines.push({ label: "Key", value: activeKey.name });
        lines.push({ label: "Scale", value: activeKey.notes.join(" ") });
        lines.push({ label: "Chords", value: keySymbols.join("  ") });
      }
      if (chord) {
        lines.push({
          label: chord.symbol,
          value: `${chord.notes.join(" ")} · formula ${chord.formula} · ${chord.roman} in ${activeKey!.name}`,
        });
      }
      const slug = (s: string) => s.toLowerCase().replace(/#/g, "sharp").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      await downloadAnalysisPng({
        svg,
        title: chord ? `${chord.symbol} · ${activeKey!.name}` : (activeKey?.name ?? "Selected notes"),
        lines,
        filename: `fretlight-${slug(activeKey?.name ?? "notes")}${chord ? `-${slug(chord.symbol)}` : ""}.png`,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="1 · Tap notes on the neck"
        meta={
          <div className="flex flex-wrap items-center gap-2">
            {activeKey && !chord && (
              <Button size="sm" variant="ghost" onClick={() => setShowKey((v) => !v)}>
                {showKey ? "Hide key notes" : "Show key notes"}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => stopTheory()}>
              ■ Stop sound
            </Button>
            <Button size="sm" onClick={clear} disabled={!selected.size && !chosenKey}>
              Clear
            </Button>
            <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving || !markers.length}>
              {saving ? "Saving…" : "Save image"}
            </Button>
          </div>
        }
      >
        <div ref={boardRef}>
          <Fretboard
            board={board}
            markers={markers}
            lowStringOnTop={lowStringOnTop}
            onSelect={(p) => toggle(p.string, p.fret, p.midi)}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-[var(--color-ink-faint)]">
          <LegendDot className="bg-white" label="Selected" />
          {(chord || showKey) && (
            <>
              <LegendDot className="bg-[rgba(255,92,138,0.92)]" label={chord ? "Chord root" : "Key root"} />
              <LegendDot
                className={chord ? "bg-[rgba(34,224,214,0.5)]" : "bg-[rgba(139,124,255,0.5)]"}
                label={chord ? "Chord tone" : "Scale note"}
              />
            </>
          )}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Panel title="Analysis">
            <div className="flex flex-col gap-4">
              <Row label="Selected notes">
                {selectedNames.length ? (
                  <span className="readout text-lg font-semibold">{selectedNames.join(" ")}</span>
                ) : (
                  <span className="text-sm text-[var(--color-ink-faint)]">None yet</span>
                )}
              </Row>

              {selectedPcs.length >= 2 && (
                <Row label="Chord">
                  {detectedChord ? (
                    <span className="readout text-sm">
                      {detectedChord.symbol} <span className="text-[var(--color-ink-faint)]">· {Math.round(detectedChord.confidence * 100)}%</span>
                    </span>
                  ) : (
                    <span className="text-sm text-[var(--color-ink-faint)]">No single chord fits these notes</span>
                  )}
                </Row>
              )}

              {detection.best && !chosenKey && (
                <Row label="Detected key">
                  <span className="readout text-lg font-semibold text-[var(--color-signal)]">
                    {detection.best.key.name}
                  </span>
                  <span className="text-xs text-[var(--color-ink-dim)]">
                    Confidence: {detection.level} · {Math.round(detection.best.confidence * 100)}%
                  </span>
                </Row>
              )}

              {detection.message && (
                <p className="text-sm text-[var(--color-ink-dim)]">{detection.message}</p>
              )}

              {!detection.determined && detection.candidates.length > 0 && (
                <Row label="Possible keys">
                  <ChipList>
                    {detection.candidates.map((c) => (
                      <Chip key={c.key.name} onClick={() => pickKey(c.key)}>
                        {c.key.name}
                      </Chip>
                    ))}
                  </ChipList>
                  <p className="text-[11px] text-[var(--color-ink-faint)]">
                    A single note can sit in many keys (and modes, like G Mixolydian for C). Tap
                    one to explore it.
                  </p>
                </Row>
              )}

              {detection.determined && detection.candidates.length > 1 && (
                <Row label="Other candidates">
                  <ChipList>
                    {detection.candidates.map((c) => (
                      <Chip key={c.key.name} active={c.key.name === activeKey?.name} onClick={() => pickKey(c.key)}>
                        {c.key.name} · {Math.round(c.confidence * 100)}%
                      </Chip>
                    ))}
                  </ChipList>
                  <p className="text-[11px] text-[var(--color-ink-faint)]">
                    A ranked guess, not a verdict. Relative major/minor pairs share the same notes.
                  </p>
                </Row>
              )}

              {selectedPcs.length > 0 && (
                <Row label="Play selected">
                  <ChipList>
                    {selectedPcs.map((pc, i) => (
                      <Chip key={pc} onClick={() => playNote(pc)}>
                        ▶ {selectedNames[i]}
                      </Chip>
                    ))}
                    {selectedPcs.length > 1 && (
                      <Chip onClick={() => playChord(selectedPcs)}>▶ Together</Chip>
                    )}
                  </ChipList>
                </Row>
              )}
            </div>
          </Panel>

          <Panel title="Or choose a key">
            <SegmentedControl
              size="sm"
              options={[
                { value: "major", label: "Major" },
                { value: "minor", label: "Minor" },
              ]}
              value={manualMode}
              onChange={setManualMode}
            />
            <NotePicker
              className="mt-3"
              value={chosenKey && chosenKey.mode === manualMode ? chosenKey.root : -1}
              onChange={(pc) => pickKey(getKey(pc, manualMode))}
            />
          </Panel>

        </div>

        <div className="flex flex-col gap-6">
          {activeKey ? (
            <>
              <Panel title="Key" meta={<Badge tone="theory">{activeKey.name}</Badge>}>
                <p className="hud-label mb-2">Scale</p>
                <div className="flex flex-wrap gap-2">
                  {activeKey.notes.map((note, i) => (
                    <span
                      key={note}
                      className={cn(
                        "readout rounded-lg border px-3 py-1.5 text-sm font-semibold",
                        i === 0
                          ? "border-[rgba(255,92,138,0.4)] bg-[rgba(255,92,138,0.1)]"
                          : "border-[var(--color-hairline)] bg-[var(--color-void)]",
                      )}
                    >
                      {note}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => playScale(activeKey.pitchClasses)}>
                    ▶ Play {activeKey.name} Scale
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => playNote(activeKey.root)}>
                    ▶ Play {activeKey.rootName}
                  </Button>
                </div>
              </Panel>

              <ChordTable
                title="Diatonic chords"
                chords={triads}
                activeDegree={chord && !chordSel?.seventh ? chord.degree : null}
                onSelect={(d) => setChordSel({ keyName: activeKey.name, seventh: false, degree: d })}
                showLong
              />
              <ChordTable
                title="7th chords"
                chords={sevenths}
                activeDegree={chord && chordSel?.seventh ? chord.degree : null}
                onSelect={(d) => setChordSel({ keyName: activeKey.name, seventh: true, degree: d })}
              />

              {chord && (
                <Panel
                  title="Chord detail"
                  meta={
                    <Button size="sm" variant="ghost" onClick={() => setChordSel(null)}>
                      Show key instead
                    </Button>
                  }
                >
                  <h3 className="readout text-2xl font-semibold">{chord.symbol}</h3>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                    <dt className="hud-label">Notes</dt>
                    <dd className="readout">{chord.notes.join(" ")}</dd>
                    <dt className="hud-label">Formula</dt>
                    <dd className="readout">{chord.formula}</dd>
                    <dt className="hud-label">Roman numeral</dt>
                    <dd className="readout">{chord.roman}</dd>
                    <dt className="hud-label">Key</dt>
                    <dd className="readout">{activeKey.name}</dd>
                  </dl>
                  <Button className="mt-4" size="sm" variant="primary" onClick={() => playChord(chord.pitchClasses)}>
                    ▶ Play {chord.symbol}
                  </Button>
                </Panel>
              )}
            </>
          ) : (
            <Panel title="Key">
              <p className="text-sm text-[var(--color-ink-dim)]">
                Select at least three notes on the fretboard, or choose a key, to see its scale
                and chords here.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function ChordTable({
  title,
  chords,
  activeDegree,
  onSelect,
  showLong,
}: {
  title: string;
  chords: readonly DiatonicChord[];
  activeDegree: number | null;
  onSelect: (degree: number) => void;
  showLong?: boolean;
}) {
  return (
    <Panel title={title} bodyClassName="!p-2">
      <ul>
        {chords.map((c) => (
          <li key={c.degree}>
            <button
              onClick={() => {
                onSelect(c.degree);
                playChord(c.pitchClasses);
              }}
              className={cn(
                "flex w-full items-center gap-4 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                activeDegree === c.degree
                  ? "bg-[rgba(34,224,214,0.1)] text-[var(--color-ink)]"
                  : "text-[var(--color-ink-dim)] hover:bg-[rgba(255,255,255,0.04)]",
              )}
            >
              <span className="readout w-16 shrink-0 text-[var(--color-theory-bright)]">{c.roman}</span>
              <span className="readout w-20 shrink-0 font-semibold text-[var(--color-ink)]">{c.symbol}</span>
              <span className="text-xs text-[var(--color-ink-faint)]">
                {showLong ? c.longName : c.notes.join(" ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="hud-label">{label}</span>
      {children}
    </div>
  );
}

function ChipList({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "readout rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
        active
          ? "border-[var(--color-theory)] bg-[rgba(139,124,255,0.14)] text-[var(--color-theory-bright)]"
          : "border-[var(--color-hairline)] bg-[var(--color-void)] text-[var(--color-ink-dim)] hover:border-[var(--color-theory)] hover:text-[var(--color-theory-bright)]",
      )}
    >
      {children}
    </button>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-full", className)} />
      {label}
    </span>
  );
}
