import type { CompanionStyle, Difficulty, Technique } from "./types";

/**
 * Compact, generic genre vocabularies. They steer *how* the engine chooses
 * notes and rhythms (density, leap size, register, which tones to land on); they
 * are not riffs, and nothing here imitates a particular song or artist.
 */
export type ScaleFlavor = "diatonic" | "pentatonic";

export interface StyleProfile {
  readonly id: CompanionStyle;
  readonly label: string;
  readonly blurb: string;
  /** Plain-language vocabulary shown to the learner. */
  readonly vocabulary: readonly string[];
  /** Pentatonic styles drop the 4th and 7th (major) so nothing clashes. */
  readonly scale: ScaleFlavor;
  /** Fill / melody notes per beat. */
  readonly density: Record<Difficulty, number>;
  /** 0..1: how cheap thirds and fourths are, so arpeggiated styles can leap by chord tones. */
  readonly arpeggio: number;
  /** Cost of repeating a note; low for driving eighth-note styles. */
  readonly repeatCost: number;
  /** Cost of an octave jump; low where octave lines are idiomatic. */
  readonly octaveCost: number;
  /** Semitones to shift the lead register: emo and math rock sit higher. */
  readonly registerShift: number;
  /** Which chord tone a fill aims for by default. */
  readonly target: "root" | "third";
  readonly techniques: readonly Technique[];
  /** Hold 2nds / 9ths on strong beats (suspended colour). */
  readonly extensions: boolean;
}

export const STYLE_PROFILES: Record<CompanionStyle, StyleProfile> = {
  popPunk: {
    id: "popPunk",
    label: "Pop Punk",
    blurb: "Driving eighth notes, octave lines and short chord-tone fills.",
    vocabulary: ["Power chords", "Octave melodies", "Chord-tone fills", "Palm-muted eighths", "Pentatonic fragments"],
    scale: "pentatonic",
    density: { beginner: 1, intermediate: 2, advanced: 2 },
    arpeggio: 0.4,
    repeatCost: 0.15,
    octaveCost: 0.3,
    registerShift: 0,
    target: "root",
    techniques: ["palmMute", "slide"],
    extensions: false,
  },
  rock: {
    id: "rock",
    label: "Rock",
    blurb: "Pentatonic lines that land on chord tones, with slides and bends.",
    vocabulary: ["Major / minor pentatonic", "Blues scale", "Bends and slides", "Hammer-ons and pull-offs", "Double stops"],
    scale: "pentatonic",
    density: { beginner: 1, intermediate: 1.5, advanced: 2 },
    arpeggio: 0.3,
    repeatCost: 0.6,
    octaveCost: 2,
    registerShift: 0,
    target: "root",
    techniques: ["slide", "hammer", "pull", "bend"],
    extensions: false,
  },
  rockAndRoll: {
    id: "rockAndRoll",
    label: "Rock & Roll",
    blurb: "Pentatonic and blues vocabulary, double stops and short call-and-response fills.",
    vocabulary: ["Major pentatonic", "Blues vocabulary", "Double stops", "Slides and bends", "Shuffle feel"],
    scale: "pentatonic",
    density: { beginner: 1, intermediate: 2, advanced: 2 },
    arpeggio: 0.3,
    repeatCost: 0.5,
    octaveCost: 2,
    registerShift: 0,
    target: "root",
    techniques: ["slide", "hammer", "pull", "bend"],
    extensions: false,
  },
  emo: {
    id: "emo",
    label: "Emo",
    blurb: "Upper-register melodies that move by small steps between chord tones.",
    vocabulary: ["Chord tones", "Upper-register melody", "Arpeggios", "Suspended colour (2nd / 9th)", "Voice leading", "Sustained notes"],
    scale: "diatonic",
    density: { beginner: 1, intermediate: 1, advanced: 2 },
    arpeggio: 0.8,
    repeatCost: 1,
    octaveCost: 2.5,
    registerShift: 7,
    target: "third",
    techniques: ["slide", "hammer", "pull"],
    extensions: true,
  },
  mathRock: {
    id: "mathRock",
    label: "Math Rock",
    blurb: "Triad fragments and arpeggios in repeating motifs with syncopated rhythm.",
    vocabulary: ["Triad fragments", "Arpeggios", "Syncopation", "Odd groupings (3+3+2)", "Repeated motifs", "Higher-register voicings"],
    scale: "diatonic",
    density: { beginner: 1, intermediate: 2, advanced: 2 },
    arpeggio: 1,
    repeatCost: 0.8,
    octaveCost: 1.5,
    registerShift: 5,
    target: "third",
    techniques: ["hammer", "pull", "slide"],
    extensions: true,
  },
  alternative: {
    id: "alternative",
    label: "Alternative",
    blurb: "Open, melodic lines built from chord tones and the key's own notes.",
    vocabulary: ["Chord tones", "Diatonic passing notes", "Sustained notes", "Simple arpeggios"],
    scale: "diatonic",
    density: { beginner: 1, intermediate: 1.5, advanced: 2 },
    arpeggio: 0.5,
    repeatCost: 0.8,
    octaveCost: 2,
    registerShift: 2,
    target: "root",
    techniques: ["slide", "hammer", "pull"],
    extensions: false,
  },
  acoustic: {
    id: "acoustic",
    label: "Acoustic",
    blurb: "Gentle stepwise lines and open-chord arpeggios in a warm register.",
    vocabulary: ["Open chords", "Arpeggios", "Stepwise melody", "Hammer-ons and pull-offs"],
    scale: "diatonic",
    density: { beginner: 1, intermediate: 1, advanced: 1.5 },
    arpeggio: 0.5,
    repeatCost: 0.9,
    octaveCost: 2.5,
    registerShift: 0,
    target: "root",
    techniques: ["hammer", "pull", "slide"],
    extensions: false,
  },
};

export const STYLE_IDS = Object.keys(STYLE_PROFILES) as CompanionStyle[];
export const DIFFICULTIES: readonly Difficulty[] = ["beginner", "intermediate", "advanced"];

/** What each difficulty level adds, for the UI. */
export const DIFFICULTY_INFO: Record<Difficulty, string> = {
  beginner: "Root, 3rd and 5th. Simple fills with few notes.",
  intermediate: "Adds passing notes, arpeggios, slides, hammer-ons and triad inversions.",
  advanced: "Adds chromatic approach notes, color tones, wider leaps and more notes.",
};
