import type { MusicKey } from "../theory/key-detection";
import { mod } from "../theory/pitch";
import { chordSymbol } from "./chord-templates";
import type { ChordDetection, ChordQuality, SongAnalysis, AnalysisSection } from "./types";

/** One cell of the chord chart: a bar (or one chord when the tempo is unknown). */
export interface ChartBar {
  readonly start: number;
  readonly end: number;
  /** Indexes into the analysis' `chords`, in playing order. Empty = no clear chord. */
  readonly chordIndexes: readonly number[];
}

export interface ChartSection {
  readonly section: AnalysisSection;
  /** Rows of up to four bars, as on a lead sheet. */
  readonly rows: readonly (readonly ChartBar[])[];
}

const BARS_PER_ROW = 4;

function rowsOf(bars: ChartBar[]): ChartBar[][] {
  const rows: ChartBar[][] = [];
  for (let i = 0; i < bars.length; i += BARS_PER_ROW) rows.push(bars.slice(i, i + BARS_PER_ROW));
  return rows;
}

/** Group the chords of each section into bars. */
export function buildChart(
  chords: readonly ChordDetection[],
  sections: readonly AnalysisSection[],
  bpm: number | null,
  beats: readonly number[],
): ChartSection[] {
  const barSeconds = bpm && beats.length >= 4 ? (60 / bpm) * 4 : null;
  const origin = beats[0] ?? 0;

  return sections.map((section) => {
    const inside = chords
      .map((chord, index) => ({ chord, index }))
      .filter(({ chord }) => chord.end > section.start + 0.05 && chord.start < section.end - 0.05);

    if (!barSeconds) {
      // No tempo: one cell per chord.
      const bars = inside.map(({ chord, index }) => ({
        start: Math.max(chord.start, section.start),
        end: Math.min(chord.end, section.end),
        chordIndexes: chord.chord ? [index] : [],
      }));
      return { section, rows: rowsOf(bars) };
    }

    // Bars are laid on the beat grid, then clipped to the section.
    const bars: ChartBar[] = [];
    let barStart = origin + Math.floor((section.start - origin) / barSeconds + 0.25) * barSeconds;
    if (barStart < section.start - barSeconds * 0.25) barStart += barSeconds;
    for (let start = Math.max(section.start, barStart); start < section.end - barSeconds * 0.4; start += barSeconds) {
      const end = Math.min(section.end, start + barSeconds);
      const indexes = inside
        .filter(({ chord }) => chord.chord && chord.end > start + barSeconds * 0.2 && chord.start < end - barSeconds * 0.2)
        .map(({ index }) => index);
      bars.push({ start, end, chordIndexes: indexes });
    }
    return { section, rows: rowsOf(bars) };
  });
}

export function chordAt(chords: readonly ChordDetection[], time: number): number {
  for (let i = 0; i < chords.length; i++) if (time >= chords[i]!.start && time < chords[i]!.end) return i;
  return chords.length ? chords.length - 1 : -1;
}

export function sectionAt(sections: readonly AnalysisSection[], time: number): number {
  for (let i = 0; i < sections.length; i++) if (time >= sections[i]!.start && time < sections[i]!.end) return i;
  return sections.length ? sections.length - 1 : -1;
}

const FLAT_ROOTS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const SHARP_ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Spell a chord's root the way a player would write it: as the key spells it
 * when it belongs to the key, otherwise with flats (Bb, Eb, not A#, D#) unless
 * the key itself is a sharp key.
 */
export function spellChord(chord: ChordDetection, key: MusicKey | null): string | null {
  if (chord.root === null || chord.quality === null) return null;
  const inKey = key ? key.pitchClasses.indexOf(chord.root) : -1;
  const sharpKey = key?.notes.some((n) => n.includes("#")) ?? false;
  const root = key && inKey >= 0 ? key.notes[inKey]! : (sharpKey ? SHARP_ROOTS : FLAT_ROOTS)[chord.root]!;
  return chordSymbol(chord.root, chord.quality, root);
}

/** Replace one chord by hand. `root === null` clears it. Timing and neighbours are untouched. */
export function editChord(
  chords: readonly ChordDetection[],
  index: number,
  root: number | null,
  quality: ChordQuality | null,
): ChordDetection[] {
  return chords.map((chord, i) => {
    if (i !== index) return chord;
    if (root === null || quality === null) {
      return { ...chord, chord: null, root: null, quality: null, confidence: 0, edited: true };
    }
    return { ...chord, chord: chordSymbol(mod(root, 12), quality), root: mod(root, 12), quality, confidence: 1, edited: true };
  });
}

const stamp = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export { stamp as formatTimestamp };

/** Plain-text chord sheet. */
export function exportText(name: string, analysis: SongAnalysis, chords: readonly ChordDetection[]): string {
  const chart = buildChart(chords, analysis.sections, analysis.bpm, analysis.beats);
  const lines = [
    `Song: ${name}`,
    `Key: ${analysis.key ?? "uncertain"}`,
    `BPM: ${analysis.bpm ? (analysis.bpmConfidence < 0.35 ? `~${analysis.bpm}` : analysis.bpm) : "unknown"}`,
    "",
  ];
  for (const { section, rows } of chart) {
    lines.push(section.label.toUpperCase());
    lines.push(`${stamp(section.start)} - ${stamp(section.end)}`);
    for (const row of rows) {
      lines.push(
        "| " +
          row
            .map((bar) => (bar.chordIndexes.map((i) => spellChord(chords[i]!, analysis.keyInfo)).join(" ") || "-").padEnd(4))
            .join(" | ") +
          " |",
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
