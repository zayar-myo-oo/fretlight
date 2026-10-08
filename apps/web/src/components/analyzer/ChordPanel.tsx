"use client";

import {
  type ChordDetection,
  type ChordQuality,
  type MusicKey,
  QUALITIES,
  SHARP_NAMES,
  chordPitchClasses,
  findDiatonicChord,
  getChord,
  getDiatonicChords,
  getDiatonicSevenths,
  mod,
  qualityInfo,
  spellChord,
} from "@fretlight/core";
import { useMemo } from "react";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { useFretboardContext } from "@/hooks/useFretboard";
import { playChord } from "@/lib/audio/theory-player";
import { cn } from "@/lib/ui/cn";
import { useSession } from "@/store/session";

const QUALITY_BY_CHORD_ID = new Map(QUALITIES.map((q) => [q.chordId, q.quality]));

export function ChordPanel({
  chord,
  keyInfo,
  showOnBoard,
  onShowOnBoard,
  onEdit,
  live,
}: {
  chord: ChordDetection | null;
  keyInfo: MusicKey | null;
  showOnBoard: boolean;
  onShowOnBoard: (value: boolean) => void;
  onEdit: (root: number | null, quality: ChordQuality | null) => void;
  live: boolean;
}) {
  const { board } = useFretboardContext();
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);

  const theory = chord?.root != null && chord.quality ? getChord(chord.root, qualityInfo(chord.quality).chordId) : null;
  const pcs = chord?.root != null && chord.quality ? chordPitchClasses(chord.root, chord.quality) : [];
  const names = useMemo(() => {
    const map = new Map<number, string>();
    theory?.tones.forEach((t) => map.set(t.pitchClass, t.name));
    keyInfo?.pitchClasses.forEach((pc, i) => map.has(pc) && map.set(pc, keyInfo.notes[i]!));
    return map;
  }, [theory, keyInfo]);
  const roman = keyInfo && pcs.length ? findDiatonicChord(keyInfo, pcs)?.roman : null;

  const markers = useMemo<FretMarker[]>(() => {
    if (!showOnBoard || !theory) return [];
    const out: FretMarker[] = [];
    for (let string = 0; string < board.stringCount; string++) {
      for (let fret = 0; fret <= board.fretCount; fret++) {
        const pc = mod(board.openMidi[string]! + fret, 12);
        if (!pcs.includes(pc)) continue;
        out.push({
          string,
          fret,
          label: names.get(pc) ?? SHARP_NAMES[pc]!,
          tone: pc === chord!.root ? "root" : "chord",
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOnBoard, theory, board, chord?.root, chord?.quality, names]);

  const suggestions = useMemo(() => {
    if (!keyInfo) return [];
    return [...getDiatonicChords(keyInfo), ...getDiatonicSevenths(keyInfo)]
      .map((c) => ({ symbol: c.symbol, root: c.root, quality: QUALITY_BY_CHORD_ID.get(c.chordId) }))
      .filter((c): c is { symbol: string; root: number; quality: ChordQuality } => c.quality !== undefined);
  }, [keyInfo]);

  return (
    <Panel
      title={live ? "Now playing" : "Chord"}
      meta={
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-dim)]">
          <input
            type="checkbox"
            checked={showOnBoard}
            onChange={(e) => onShowOnBoard(e.target.checked)}
            className="accent-[var(--color-signal)]"
          />
          Show chord on fretboard
        </label>
      }
    >
      <div className="flex flex-col gap-5">
        {chord && theory ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="readout text-3xl font-semibold text-[var(--color-signal)]">{spellChord(chord, keyInfo)}</h3>
              <p className="mt-0.5 text-sm text-[var(--color-ink-dim)]">
                {names.get(chord.root!) ?? SHARP_NAMES[chord.root!]} {qualityInfo(chord.quality!).name}
                {chord.edited ? " · edited by you" : ` · ${Math.round(chord.confidence * 100)}% sure`}
              </p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-sm">
              <dt className="hud-label">Notes</dt>
              <dd className="readout">{pcs.map((pc) => names.get(pc) ?? SHARP_NAMES[pc]).join(" ")}</dd>
              <dt className="hud-label">Formula</dt>
              <dd className="readout">{theory.definition.degrees.join(" ")}</dd>
              <dt className="hud-label">Key</dt>
              <dd className="readout">{keyInfo ? `${keyInfo.name}${roman ? ` · ${roman}` : " · outside the key"}` : "uncertain"}</dd>
            </dl>
            <Button size="sm" variant="primary" onClick={() => playChord(pcs)}>
              ▶ Play chord
            </Button>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-ink-dim)]">
            {chord ? "No clear chord here. You can set one below." : "Pick a chord in the chart, or press play."}
          </p>
        )}

        {showOnBoard && (
          <Fretboard board={board} markers={markers} lowStringOnTop={lowStringOnTop} />
        )}

        {chord && (
          <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3">
            <p className="hud-label mb-2">Not right? Fix this chord</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Root"
                value={chord.root ?? ""}
                onChange={(e) => {
                  const root = e.target.value === "" ? null : Number(e.target.value);
                  onEdit(root, root === null ? null : (chord.quality ?? "maj"));
                }}
                className="h-9 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-xs"
              >
                <option value="">No chord</option>
                {SHARP_NAMES.map((n, pc) => (
                  <option key={n} value={pc}>
                    {n}
                  </option>
                ))}
              </select>
              <select
                aria-label="Quality"
                value={chord.quality ?? "maj"}
                disabled={chord.root === null}
                onChange={(e) => onEdit(chord.root, e.target.value as ChordQuality)}
                className="h-9 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-xs disabled:opacity-40"
              >
                {QUALITIES.map((q) => (
                  <option key={q.quality} value={q.quality}>
                    {q.name}
                  </option>
                ))}
              </select>
            </div>
            {suggestions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.symbol}
                    onClick={() => onEdit(s.root, s.quality)}
                    className={cn(
                      "readout rounded-lg border px-2 py-1 text-xs transition-colors",
                      s.root === chord.root && s.quality === chord.quality
                        ? "border-[var(--color-theory)] text-[var(--color-theory-bright)]"
                        : "border-[var(--color-hairline)] text-[var(--color-ink-dim)] hover:border-[var(--color-theory)]",
                    )}
                  >
                    {s.symbol}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
