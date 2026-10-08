"use client";

import {
  type CompanionStyle,
  type Difficulty,
  type Fretboard as Board,
  type IdeaCategory,
  type Progression,
  type TabEvent,
  chordPitchClasses,
  coreTriad,
  cowboyNotes,
  findCowboyChord,
  generateIdeas,
  ideaTab,
  mod,
  renderTab,
  spellPitchClass,
  supportsCowboyChords,
  targetNotes,
  triadOrder,
} from "@fretlight/core";
import { useMemo, useState } from "react";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useCompanionBoard } from "@/hooks/useCompanionBoard";
import { buildIdeaEvents, playEvents, stopCompanion } from "@/lib/audio/companion-player";
import { ideaMarkers, pitchClassMarkers } from "@/lib/companion/markers";
import type { TrackKind } from "@/lib/looper/looper-engine";
import { cn } from "@/lib/ui/cn";

type Layer = "tones" | "triad" | "cowboy" | "target" | "fill";

const MODES_MAJOR = ["Ionian", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian", "Locrian"];
const MODES_MINOR = ["Aeolian", "Locrian", "Ionian", "Dorian", "Phrygian", "Lydian", "Mixolydian"];

const BASS_IDEAS: { category: IdeaCategory; label: string }[] = [
  { category: "bass-root", label: "Root" },
  { category: "bass-rootfifth", label: "Root + 5th" },
  { category: "bass-octave", label: "Octave" },
  { category: "bass-approach", label: "Approach" },
  { category: "bass-walking", label: "Walking" },
  { category: "bass-melodic", label: "Melodic" },
];

/**
 * "What can I play right now?" for the chord the loop is on: its notes, the
 * triad, the cowboy shape, the target for the next change, and a fill into it.
 */
export function NowPanel({
  progression,
  chordIndex,
  running,
  style,
  difficulty,
  instrument,
  board,
  lowStringOnTop,
  bpm,
  focusKind,
}: {
  progression: Progression;
  chordIndex: number;
  running: boolean;
  style: CompanionStyle;
  difficulty: Difficulty;
  instrument: "guitar" | "bass";
  board: Board;
  lowStringOnTop: boolean;
  bpm: number;
  focusKind: TrackKind;
}) {
  const [layer, setLayer] = useState<Layer>("triad");
  const [showTab, setShowTab] = useState(false);
  const bassBoard = useCompanionBoard("bass");

  const index = Math.max(0, Math.min(chordIndex, progression.chords.length - 1));
  const chord = progression.chords[index]!;
  const next = progression.chords[(index + 1) % progression.chords.length]!;
  const summary = targetNotes(progression)[index]!;
  const key = progression.key.key;
  const bass = instrument === "bass" || focusKind === "bass";

  const nameMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of [chord, next]) c.pitchClasses.forEach((pc, i) => map.set(mod(pc, 12), c.names[i]!));
    key?.pitchClasses.forEach((pc, i) => map.has(mod(pc, 12)) || map.set(mod(pc, 12), key.notes[i]!));
    return map;
  }, [chord, next, key]);

  const triadQuality = coreTriad(chord.quality);
  const triad = triadQuality ? triadOrder(chord.root, triadQuality, 0) : null;
  const degree = key ? key.pitchClasses.indexOf(mod(chord.root, 12)) : -1;
  const modeName = degree >= 0 && key ? (key.mode === "major" ? MODES_MAJOR : MODES_MINOR)[degree] : null;

  // Short triad motifs to try over this chord.
  const motifs = useMemo(() => {
    if (!triad) return [];
    const n = triad.map((t) => nameMap.get(t.pitchClass) ?? spellPitchClass(t.pitchClass, key));
    return [`${n[0]} ${n[1]} ${n[2]}`, `${n[1]} ${n[2]} ${n[0]}`, `${n[2]} ${n[1]} ${n[0]}`, `${n[1]} ${n[0]} ${n[1]}`];
  }, [triad, nameMap, key]);

  const fill = useMemo(
    () =>
      instrument === "bass"
        ? null
        : generateIdeas({ board, progression, instrument, style, difficulty, category: "fills", fillBeats: 2 }).find((i) => i.fromChord === index) ?? null,
    [board, progression, instrument, style, difficulty, index],
  );

  const cowboy = supportsCowboyChords(board) ? findCowboyChord(chord.root, chord.quality) : null;

  const markers = useMemo<FretMarker[]>(() => {
    const rootPc = mod(chord.root, 12);
    if (layer === "fill" && fill) return ideaMarkers(fill, { numbered: true });
    if (layer === "cowboy" && cowboy) {
      return cowboyNotes(board, cowboy).map((n) => ({
        string: n.string,
        fret: n.fret,
        label: nameMap.get(n.pitchClass) ?? "",
        tone: n.role === "R" ? "root" : n.role === "5" ? "scale" : "chord",
      }));
    }
    if (layer === "triad" && triadQuality) {
      const pcs = chordPitchClasses(chord.root, triadQuality);
      return pitchClassMarkers(board, pcs, nameMap, (pc) => (pc === rootPc ? "root" : pc === pcs[1] ? "chord" : "scale"));
    }
    if (layer === "target") {
      const current = pitchClassMarkers(board, chord.pitchClasses, nameMap, () => "ghost");
      const upcoming = pitchClassMarkers(board, next.pitchClasses, nameMap, (pc) => (pc === mod(next.root, 12) ? "target" : "chord"));
      const byKey = new Map<string, FretMarker>();
      for (const m of [...current, ...upcoming]) byKey.set(`${m.string}:${m.fret}`, m);
      return [...byKey.values()];
    }
    return pitchClassMarkers(board, chord.pitchClasses, nameMap, (pc) => (pc === rootPc ? "root" : "chord"));
  }, [layer, fill, cowboy, triadQuality, chord, next, board, nameMap]);

  const bassIdeas = useMemo(() => {
    if (!bass) return [];
    return BASS_IDEAS.map(({ category, label }) => {
      const idea = generateIdeas({ board: bassBoard, progression, instrument: "bass", style, difficulty, category })[0];
      if (!idea) return null;
      const notes = idea.notes.filter((n) => n.startBeat >= chord.startBeat - 1e-6 && n.startBeat < chord.startBeat + chord.beats - 1e-6);
      const events: TabEvent[] = notes.flatMap((n) => (n.position ? [{ startBeat: n.startBeat, spots: [n.position] }] : []));
      return { label, names: notes.map((n) => n.name).join(" "), tab: renderTab(bassBoard, events) };
    }).filter((x): x is { label: string; names: string; tab: string[] } => x !== null);
  }, [bass, bassBoard, progression, style, difficulty, chord]);

  const playFill = () => {
    if (!fill) return;
    const { events, seconds } = buildIdeaEvents(fill, progression, bpm, true, board);
    void playEvents(events, seconds);
  };

  return (
    <Panel
      title="What can I play now?"
      meta={<span className={cn("readout rounded-full border px-2.5 py-0.5 text-[11px]", running ? "border-[var(--color-signal)] text-[var(--color-signal)]" : "border-[var(--color-hairline)] text-[var(--color-ink-faint)]")}>{running ? "following the loop" : "pick a chord below, or press play"}</span>}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-stretch gap-3">
          <Big label="Now playing" value={chord.symbol} accent />
          <Big label="Next" value={next.symbol} />
          <Big label="Aim for" value={summary.target.name} hint={`root of ${next.symbol}`} />
          <div className="min-w-[200px] flex-1 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3">
            <p className="hud-label">Try these notes</p>
            <p className="readout mt-1 text-lg">{chord.names.join("  ")}</p>
            <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
              Scale: {key ? `${key.name} (${key.notes.join(" ")})` : "use the chord tones"}
              {modeName ? ` · ${chord.names[0]} ${modeName} over this chord` : ""}
            </p>
          </div>
        </div>

        {motifs.length > 0 && (
          <div>
            <p className="hud-label mb-1.5">Triad ideas ({triad!.map((t) => nameMap.get(t.pitchClass)).join(" ")})</p>
            <div className="flex flex-wrap gap-1.5">
              {motifs.map((m) => (
                <span key={m} className="readout rounded-lg border border-[var(--color-hairline)] bg-[var(--color-void)] px-2.5 py-1 text-sm">
                  {m.split(" ").join(" → ")}
                </span>
              ))}
            </div>
          </div>
        )}

        {summary.commonTones.length > 0 && (
          <p className="text-xs text-[var(--color-ink-dim)]">
            {summary.commonTones.join(" and ")} {summary.commonTones.length === 1 ? "is" : "are"} in both {chord.symbol} and {next.symbol}: hold {summary.commonTones.length === 1 ? "it" : "one"} across the change for a smooth sound.
          </p>
        )}

        {bass ? (
          <div>
            <p className="hud-label mb-2">Bass over {chord.symbol}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {bassIdeas.map((b) => (
                <div key={b.label} className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3">
                  <p className="text-sm font-medium">{b.label}</p>
                  <p className="readout text-base text-[var(--color-signal)]">{b.names || "–"}</p>
                  {showTab && <pre className="readout mt-1 overflow-x-auto text-[11px] leading-snug">{b.tab.join("\n")}</pre>}
                </div>
              ))}
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-dim)]">
              <input type="checkbox" checked={showTab} onChange={(e) => setShowTab(e.target.checked)} className="accent-[var(--color-signal)]" />
              Show tab
            </label>
          </div>
        ) : (
          fill && (
            <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3">
              <p className="hud-label">Fill into {next.symbol}</p>
              <p className="readout mt-1 text-xl text-[var(--color-signal)]">{fill.what}</p>
              <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
                <span className="font-medium text-[var(--color-ink)]">Why? </span>
                {fill.why}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" onClick={playFill}>
                  ▶ Play
                </Button>
                <Button size="sm" onClick={() => setLayer("fill")}>
                  Show fretboard
                </Button>
                <Button size="sm" onClick={() => setShowTab((v) => !v)}>
                  {showTab ? "Hide tab" : "Show tab"}
                </Button>
                <Button size="sm" variant="ghost" onClick={stopCompanion}>
                  ■ Stop
                </Button>
              </div>
              {showTab && <pre className="readout mt-2 overflow-x-auto text-xs leading-relaxed">{ideaTab(board, fill).join("\n")}</pre>}
            </div>
          )
        )}

        <div className="flex flex-col gap-3">
          <SegmentedControl
            size="sm"
            options={[
              { value: "triad", label: "Triad" },
              { value: "tones", label: "Chord tones" },
              { value: "target", label: "Target" },
              { value: "cowboy", label: "Cowboy shape" },
              ...(fill ? [{ value: "fill", label: "Fill" }] : []),
            ]}
            value={layer}
            onChange={(v) => setLayer(v as Layer)}
          />
          {layer === "cowboy" && !cowboy && (
            <p className="text-xs text-[var(--color-ink-dim)]">
              {supportsCowboyChords(board) ? `No open cowboy shape for ${chord.symbol}. Try the triad.` : "Cowboy shapes are for six-string guitar in standard tuning."}
            </p>
          )}
          <Fretboard board={board} markers={markers} lowStringOnTop={lowStringOnTop} {...(layer === "cowboy" && cowboy ? { toFret: 5 } : {})} />
          <p className="text-[11px] text-[var(--color-ink-faint)]">
            {layer === "triad" && "Pink = root, cyan = 3rd, purple = 5th."}
            {layer === "tones" && "Pink = root, cyan = other chord tones."}
            {layer === "target" && `Bright cyan = ${summary.target.name}, the note to land on in ${next.symbol}. Cyan = other ${next.symbol} tones. Faint = ${chord.symbol} tones.`}
            {layer === "cowboy" && "The open shape. Pink = root, cyan = 3rd, purple = 5th."}
            {layer === "fill" && "Numbers show the order to play; the last note is the target."}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function Big({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={cn("min-w-[110px] rounded-xl border p-3", accent ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.08)]" : "border-[var(--color-hairline)] bg-[var(--color-void)]")}>
      <p className="hud-label">{label}</p>
      <p className={cn("readout text-3xl font-semibold", accent && "text-[var(--color-signal)]")}>{value}</p>
      {hint && <p className="text-[11px] text-[var(--color-ink-faint)]">{hint}</p>}
    </div>
  );
}
