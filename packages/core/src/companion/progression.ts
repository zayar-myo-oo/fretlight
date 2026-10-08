import { CHORDS } from "../theory/chords";
import { type MusicKey, findDiatonicChord } from "../theory/key-detection";
import { mod } from "../theory/pitch";
import { analyzeKey, type SongKey } from "../song-analysis/key-analyzer";
import { chordPitchClasses, chordSymbol, qualityInfo } from "../song-analysis/chord-templates";
import { spellPitchClass } from "../song-analysis/timeline-builder";
import { type ParsedChord, parseProgressionText } from "./chord-parser";
import type { ProgressionChord } from "./types";

export interface Progression {
  readonly chords: readonly ProgressionChord[];
  readonly key: SongKey;
  readonly totalBeats: number;
  /** Anything in the text that was not a chord. */
  readonly errors: readonly string[];
}

/**
 * Turn typed chords into a progression the generators can reason about: chord
 * tones, the likely key (an ambiguous result is reported as such, never forced),
 * each chord's Roman numeral, and note names spelled for that key.
 */
export function buildProgression(chords: readonly ParsedChord[], beatsPerChord = 4, errors: readonly string[] = []): Progression {
  // Reuse the song analyser's key estimate: each chord counts as one even stretch.
  const key = analyzeKey(
    chords.map((c, i) => ({
      chord: c.text,
      root: c.root,
      quality: c.quality,
      start: i,
      end: i + 1,
      confidence: 1,
    })),
  );
  const musicKey: MusicKey | null = key.key;

  const built = chords.map<ProgressionChord>((c, index) => {
    const pcs = chordPitchClasses(c.root, c.quality);
    const chordId = qualityInfo(c.quality).chordId;
    // Keep the spelling the user typed for the root (Bb stays Bb); other tones follow the key.
    const rootName = c.rootName;
    return {
      index,
      symbol: chordSymbol(c.root, c.quality, rootName),
      root: c.root,
      quality: c.quality,
      chordId,
      pitchClasses: pcs,
      names: pcs.map((pc, i) => (i === 0 ? rootName : spellPitchClass(pc, musicKey))),
      roman: musicKey ? (findDiatonicChord(musicKey, pcs)?.roman ?? null) : null,
      beats: beatsPerChord,
      startBeat: index * beatsPerChord,
    };
  });

  return { chords: built, key, totalBeats: built.length * beatsPerChord, errors };
}

/** Parse text and build the progression in one go. */
export function progressionFromText(text: string, beatsPerChord = 4): Progression {
  const parsed = parseProgressionText(text);
  return buildProgression(parsed.chords, beatsPerChord, parsed.errors);
}

/** The chord names of a progression joined as "C → G → Am → F". */
export function describeProgression(progression: Progression): string {
  return progression.chords.map((c) => c.symbol).join(" → ");
}

/** Pitch classes that belong to the key, or all twelve when the key is uncertain. */
export function keyPitchClasses(progression: Progression): Set<number> {
  const key = progression.key.key;
  if (key) return new Set(key.pitchClasses);
  // No clear key: fall back to the union of the chords, which is always safe to play.
  const set = new Set<number>();
  for (const chord of progression.chords) for (const pc of chord.pitchClasses) set.add(mod(pc, 12));
  return set;
}

/** Chord tones with their degree labels: [["C","1"],["E","3"],["G","5"]]. */
export function chordToneLabels(chord: ProgressionChord): [string, string][] {
  const degrees = CHORDS[chord.chordId].degrees;
  return chord.names.map((name, i) => [name, degrees[i] ?? String(i + 1)]);
}

export interface TargetSummary {
  readonly from: ProgressionChord;
  readonly to: ProgressionChord;
  readonly currentTones: readonly string[];
  readonly nextTones: readonly string[];
  /** Notes both chords share: keep them ringing and the change sounds smooth. */
  readonly commonTones: readonly string[];
  readonly target: { readonly name: string; readonly degree: string; readonly reason: string };
}

/**
 * For every chord change, which note to aim for. The root of the next chord is
 * the strongest landing (it is what the bass is about to play); shared notes
 * are listed too, since holding one across the change sounds smooth.
 */
export function targetNotes(progression: Progression): TargetSummary[] {
  const { chords } = progression;
  return chords.map((from, i) => {
    const to = chords[(i + 1) % chords.length]!;
    const common = from.pitchClasses
      .map((pc, k) => ({ pc: mod(pc, 12), name: from.names[k]! }))
      .filter((n) => to.pitchClasses.some((p) => mod(p, 12) === n.pc))
      .map((n) => n.name);
    const name = to.names[0]!;
    return {
      from,
      to,
      currentTones: from.names,
      nextTones: to.names,
      commonTones: common,
      target: {
        name,
        degree: "root",
        reason: `${name} is the root of the next chord (${to.symbol}), so ending there makes the change sound resolved.`,
      },
    };
  });
}
