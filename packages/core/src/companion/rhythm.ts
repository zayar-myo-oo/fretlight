import { mod } from "../theory/pitch";
import { cowboyNotes, findCowboyChord, supportsCowboyChords } from "./cowboy";
import { type GenContext, makeNote, nearestMidi, profileOf } from "./melody-engine";
import { placeVoicing } from "./placement";
import { coreTriad, triadShapes } from "./triads";
import type { CompanionStyle, FretSpot, Idea, IdeaNote, NoteRole, ProgressionChord, Technique } from "./types";

type HitKind = "D" | "U" | "M" | "S" | "A";
type VoicingKind = "power" | "chord" | "stab" | "arpeggio";

interface Hit {
  readonly slot: number;
  readonly kind: HitKind;
}

interface RhythmPattern {
  readonly id: string;
  readonly name: string;
  /** Grid slots per bar: 8 = eighths, 12 = triplets, 16 = sixteenths. */
  readonly slots: 8 | 12 | 16;
  readonly hits: readonly Hit[];
  readonly voicing: VoicingKind;
  /** 0 beginner, 1 intermediate, 2 advanced. */
  readonly level: 0 | 1 | 2;
  readonly note: string;
}

const hits = (kind: HitKind, ...slots: number[]): Hit[] => slots.map((slot) => ({ slot, kind }));
const mix = (...parts: Hit[][]): Hit[] => parts.flat().sort((a, b) => a.slot - b.slot);

const PATTERNS: Record<CompanionStyle, readonly RhythmPattern[]> = {
  popPunk: [
    { id: "pp-quarters", name: "Power-chord quarters", slots: 8, level: 0, voicing: "power", hits: hits("D", 0, 2, 4, 6), note: "One downstroke on every beat. Keep it tight and even." },
    { id: "pp-eighths", name: "Palm-muted eighths", slots: 8, level: 1, voicing: "power", hits: mix(hits("D", 0, 4), hits("M", 1, 2, 3, 5, 6, 7)), note: "Rest the side of your picking hand on the strings for the muted hits and let beats 1 and 3 ring." },
    { id: "pp-drive", name: "Driving eighths with an upstroke", slots: 8, level: 2, voicing: "power", hits: mix(hits("D", 0, 4, 6), hits("M", 1, 2, 3, 5), hits("U", 7)), note: "Fast alternate picking: down on the beat, up on the 'and' before the chord change." },
  ],
  rock: [
    { id: "rk-quarters", name: "Steady chord quarters", slots: 8, level: 0, voicing: "chord", hits: hits("D", 0, 2, 4, 6), note: "Strum once per beat." },
    { id: "rk-strum", name: "Down-down-up strum", slots: 8, level: 1, voicing: "chord", hits: mix(hits("D", 0, 2, 6), hits("U", 3, 5, 7)), note: "The classic pattern. Keep your hand moving down-up all the way through and miss the strings on the rests." },
    { id: "rk-ghost", name: "Strum with ghost hits", slots: 8, level: 2, voicing: "chord", hits: mix(hits("D", 0, 2, 6), hits("U", 3, 5, 7), hits("M", 1)), note: "Add a muted scratch on the second 'and' for extra drive." },
  ],
  rockAndRoll: [
    { id: "rr-quarters", name: "Power-chord quarters", slots: 8, level: 0, voicing: "power", hits: hits("D", 0, 2, 4, 6), note: "One hit per beat; get the changes smooth first." },
    { id: "rr-shuffle", name: "Shuffle", slots: 12, level: 1, voicing: "power", hits: hits("D", 0, 2, 3, 5, 6, 8, 9, 11), note: "Swing the eighths: long-short, long-short. Think 'one-a, two-a, three-a, four-a'." },
    { id: "rr-shuffle-stab", name: "Shuffle with stabs", slots: 12, level: 2, voicing: "power", hits: mix(hits("D", 0, 3, 6, 9), hits("M", 2, 5, 8, 11)), note: "Let the chord ring on the beat and chop it short on the swung note." },
  ],
  emo: [
    { id: "em-hold", name: "Held chords", slots: 8, level: 0, voicing: "chord", hits: hits("D", 0, 4), note: "Strum on beats 1 and 3 and let every note ring." },
    { id: "em-arp", name: "Eighth-note arpeggio", slots: 8, level: 1, voicing: "arpeggio", hits: hits("A", 0, 1, 2, 3, 4, 5, 6, 7), note: "Pick the strings one at a time, low to high and back, and let them sustain." },
    { id: "em-arp-skip", name: "Skipping arpeggio", slots: 8, level: 2, voicing: "arpeggio", hits: hits("A", 0, 1, 3, 4, 6, 7), note: "Leave gaps so the arpeggio sounds lighter and more open." },
  ],
  mathRock: [
    { id: "mr-quarters", name: "Four-on-the-floor stabs", slots: 16, level: 0, voicing: "stab", hits: hits("S", 0, 4, 8, 12), note: "Short chord stabs on every beat, using the top three strings." },
    { id: "mr-332", name: "3 + 3 + 2 stabs", slots: 16, level: 1, voicing: "stab", hits: hits("S", 0, 3, 6, 8, 11, 14), note: "Count 1-2-3, 1-2-3, 1-2 and accent each group's first stab: it repeats across the bar line." },
    { id: "mr-syncopated", name: "Syncopated arpeggio", slots: 16, level: 2, voicing: "arpeggio", hits: hits("A", 0, 3, 6, 8, 11, 14), note: "Play the triad one string at a time on the same 3+3+2 accents." },
  ],
  alternative: [
    { id: "al-quarters", name: "Open chord quarters", slots: 8, level: 0, voicing: "chord", hits: hits("D", 0, 2, 4, 6), note: "Strum once per beat." },
    { id: "al-strum", name: "Down-down-up strum", slots: 8, level: 1, voicing: "chord", hits: mix(hits("D", 0, 2, 6), hits("U", 3, 5, 7)), note: "Keep the strumming hand moving constantly." },
    { id: "al-arp", name: "Picked chords", slots: 8, level: 2, voicing: "arpeggio", hits: hits("A", 0, 1, 2, 3, 4, 5, 6, 7), note: "Pick low to high and back and let the notes blend." },
  ],
  acoustic: [
    { id: "ac-quarters", name: "Open chord quarters", slots: 8, level: 0, voicing: "chord", hits: hits("D", 0, 2, 4, 6), note: "Strum once per beat with relaxed wrist." },
    { id: "ac-strum", name: "Folk strum", slots: 8, level: 1, voicing: "chord", hits: mix(hits("D", 0, 2, 6), hits("U", 3, 5, 7)), note: "Down, down-up, up-down-up: let your hand keep swinging and skip some strings." },
    { id: "ac-picking", name: "Fingerpicked arpeggio", slots: 8, level: 2, voicing: "arpeggio", hits: hits("A", 0, 1, 2, 3, 4, 5, 6, 7), note: "Thumb on the bass notes, fingers on the higher strings." },
  ],
};

const LEVEL = { beginner: 0, intermediate: 1, advanced: 2 } as const;

const COUNT_LINES: Record<8 | 12 | 16, string> = {
  8: "1 & 2 & 3 & 4 &",
  12: "1 . a 2 . a 3 . a 4 . a",
  16: "1 e & a 2 e & a 3 e & a 4 e & a",
};

function gridLines(pattern: RhythmPattern): string[] {
  const row = Array.from({ length: pattern.slots }, (_, slot) => pattern.hits.find((h) => h.slot === slot)?.kind ?? ".");
  const counts = COUNT_LINES[pattern.slots].split(" ");
  const width = Math.max(...counts.map((c) => c.length), 1);
  return [counts.map((c) => c.padEnd(width)).join(" "), row.map((c) => c.padEnd(width)).join(" ")];
}

interface Voicing {
  readonly notes: { midi: number; spot: FretSpot }[];
}

function powerVoicing(ctx: GenContext, chord: ProgressionChord): Voicing | null {
  const root = nearestMidi(chord.root, 46, { low: 40, high: 52 });
  const spots = placeVoicing(ctx.board, [root, root + 7, root + 12], 4, 1.5);
  return spots ? { notes: spots.map((spot) => ({ spot, midi: ctx.board.openMidi[spot.string]! + spot.fret })) } : null;
}

function triadVoicing(ctx: GenContext, chord: ProgressionChord, top: boolean): Voicing | null {
  const quality = coreTriad(chord.quality);
  if (!quality) return powerVoicing(ctx, chord);
  const topSet = ctx.board.stringCount - 3;
  const shapes = triadShapes(ctx.board, chord.root, quality, top ? "all" : 0).filter((s) => (top ? s.spots[0]!.string === topSet : true));
  const shape = shapes.find((s) => s.minFret >= (top ? 2 : 0)) ?? shapes[0];
  if (!shape) return powerVoicing(ctx, chord);
  return { notes: shape.spots.map((s) => ({ spot: { string: s.string, fret: s.fret }, midi: ctx.board.openMidi[s.string]! + s.fret })) };
}

function chordVoicing(ctx: GenContext, chord: ProgressionChord): Voicing | null {
  if (supportsCowboyChords(ctx.board)) {
    const open = findCowboyChord(chord.root, chord.quality);
    if (open) return { notes: cowboyNotes(ctx.board, open).map((n) => ({ midi: n.midi, spot: { string: n.string, fret: n.fret } })) };
  }
  return triadVoicing(ctx, chord, false);
}

function voicingFor(ctx: GenContext, chord: ProgressionChord, kind: VoicingKind): Voicing | null {
  if (kind === "power") return powerVoicing(ctx, chord);
  if (kind === "stab") return triadVoicing(ctx, chord, true);
  return chordVoicing(ctx, chord); // "chord" and "arpeggio"
}

const roleFor = (chord: ProgressionChord, midi: number): NoteRole => {
  const index = chord.pitchClasses.findIndex((p) => mod(p, 12) === mod(midi, 12));
  return index === 0 ? "root" : "chordTone";
};

/** Rhythm-guitar ideas: a strum / stab pattern, voiced for each chord and repeated every bar. */
export function generateRhythm(ctx: GenContext): Idea[] {
  const profile = profileOf(ctx);
  const level = LEVEL[ctx.difficulty];
  const choices = PATTERNS[ctx.style].filter((p) => p.level <= level);
  const pattern = choices[Math.max(0, choices.length - 1 - (ctx.variant % choices.length))]!;
  const { chords } = ctx.progression;

  const notes: IdeaNote[] = [];
  for (const chord of chords) {
    const voicing = voicingFor(ctx, chord, pattern.voicing);
    if (!voicing) continue;
    const byPitch = [...voicing.notes].sort((a, b) => a.midi - b.midi);
    const slotBeats = chord.beats / pattern.slots;

    for (const hit of pattern.hits) {
      const start = chord.startBeat + hit.slot * slotBeats;
      const duration = hit.kind === "M" || hit.kind === "S" ? slotBeats * 0.6 : slotBeats * (hit.kind === "A" ? 1.5 : 1);
      const technique: Technique | undefined =
        hit.kind === "M" ? (profile.techniques.includes("palmMute") ? "palmMute" : "mute") : undefined;
      const chosen = hit.kind === "A" ? [byPitch[hit.slot % byPitch.length]!] : byPitch;
      for (const tone of chosen) {
        notes.push({
          ...makeNote(ctx, tone.midi, start, duration, chord, roleFor(chord, tone.midi)),
          position: tone.spot,
          ...(technique ? { technique } : {}),
        });
      }
    }
  }

  const lines = gridLines(pattern);
  const legend = "D = down, U = up, M = muted, S = short stab, A = picked note, . = rest";
  const description: Record<VoicingKind, string> = {
    power: "root + 5th power chords",
    chord: "open or compact chord shapes",
    stab: "short triads on the top strings",
    arpeggio: "the chord's strings picked one at a time",
  };
  return [
    {
      id: `rhythm-${pattern.id}`,
      category: "rhythm",
      title: pattern.name,
      notes,
      fromChord: 0,
      toChord: chords.length - 1,
      what: `${pattern.name}: ${description[pattern.voicing]}.`,
      why: `${profile.label} rhythm leans on this feel. ${pattern.note}`,
      where: "Change chord on beat 1 of every bar; the pattern restarts there.",
      pattern: [...lines, legend],
      tip: pattern.level < 2 && level > pattern.level ? "Switch to the next difficulty for a busier pattern." : undefined,
    },
  ];
}
