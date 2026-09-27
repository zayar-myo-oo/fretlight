import type { ChordId } from "../theory/chords";
import { getArpeggio } from "../theory/arpeggio";
import type { Fretboard } from "../instrument/fretboard";
import { getFretPositions, nearestPosition } from "../instrument/fretboard";
import { mod } from "../theory/pitch";
import type { Scale } from "../theory/scales";
import type { PitchClass } from "../theory/types";

/** One note the player is expected to produce. */
export interface PracticeStep {
  readonly id: string;
  /** Exact pitch, when the exercise cares about octave. */
  readonly midi: number;
  readonly pitchClass: PitchClass;
  /** Display name, e.g. "A". */
  readonly label: string;
  /** Scale degree or chord degree, e.g. "b3". */
  readonly degree?: string;
  /** Suggested place to play it. Purely a hint — any octave/position can be accepted. */
  readonly position?: { readonly string: number; readonly fret: number };
  /** Seconds from sequence start. Only used by timed exercises. */
  readonly expectedTime?: number;
}

export interface PracticeSequence {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly PracticeStep[];
  readonly bpm: number;
  /** "free" waits for the player; "timed" grades against the click. */
  readonly mode: "free" | "timed";
}

export interface SequenceBuildOptions {
  readonly bpm?: number;
  readonly mode?: "free" | "timed";
  /** Beats between consecutive notes in a timed exercise. */
  readonly beatsPerStep?: number;
  /** Play the sequence back down again after reaching the top. */
  readonly ascendDescend?: boolean;
}

function withTiming(
  steps: Omit<PracticeStep, "expectedTime">[],
  options: SequenceBuildOptions,
): PracticeStep[] {
  const mode = options.mode ?? "free";
  if (mode !== "timed") return steps;
  const bpm = options.bpm ?? 80;
  const beatsPerStep = options.beatsPerStep ?? 1;
  const stepSeconds = (60 / bpm) * beatsPerStep;
  return steps.map((step, index) => ({ ...step, expectedTime: index * stepSeconds }));
}

/**
 * Turn a scale into a playable, position-aware exercise.
 * The fretboard is optional: without it the sequence still works, it just
 * cannot suggest where to put your fingers.
 */
export function sequenceFromScale(
  scale: Scale,
  options: SequenceBuildOptions & { board?: Fretboard; startOctave?: number; octaves?: number } = {},
): PracticeSequence {
  const startOctave = options.startOctave ?? 2;
  const octaves = Math.max(1, options.octaves ?? 1);
  const baseMidi = scale.root + (startOctave + 1) * 12;

  const raw: Omit<PracticeStep, "expectedTime">[] = [];
  let lastPosition: { string: number; fret: number } | undefined;

  for (let octave = 0; octave < octaves; octave++) {
    for (const note of scale.notes) {
      const midi = baseMidi + note.interval + octave * 12;
      raw.push({
        id: `${scale.rootName}-${scale.definition.id}-${raw.length}`,
        midi,
        pitchClass: mod(note.pitchClass, 12),
        label: note.name,
        degree: note.degree,
      });
    }
  }
  // Land back on the root — that is how the exercise resolves.
  const first = scale.notes[0];
  if (first) {
    raw.push({
      id: `${scale.rootName}-${scale.definition.id}-${raw.length}`,
      midi: baseMidi + octaves * 12,
      pitchClass: first.pitchClass,
      label: first.name,
      degree: first.degree,
    });
  }

  let steps: Omit<PracticeStep, "expectedTime">[] = raw;
  if (options.ascendDescend) {
    steps = [...raw, ...[...raw].reverse().slice(1).map((s, i) => ({ ...s, id: `${s.id}-d${i}` }))];
  }

  // Attach fingering hints that stay near the previous note rather than jumping
  // across the neck — the same greedy walk a teacher would suggest.
  const board = options.board;
  const positioned = steps.map((step) => {
    if (!board) return step;
    const candidates = getFretPositions(board, step.midi, { exactOctave: true });
    const pick = nearestPosition(candidates, lastPosition?.fret ?? 5, lastPosition?.string);
    if (!pick) return step;
    lastPosition = { string: pick.string, fret: pick.fret };
    return { ...step, position: { string: pick.string, fret: pick.fret } };
  });

  return {
    id: `scale-${scale.rootName}-${scale.definition.id}`,
    name: `${scale.rootName} ${scale.definition.name}`,
    steps: withTiming(positioned, options),
    bpm: options.bpm ?? 80,
    mode: options.mode ?? "free",
  };
}

/** Build an exercise from one of the generated fretboard shapes (e.g. pentatonic box 2). */
export function sequenceFromShape(
  shapeName: string,
  positions: readonly { midi: number; pitchClass: PitchClass; name: string; degree: string; string: number; fret: number }[],
  options: SequenceBuildOptions = {},
): PracticeSequence {
  const raw = positions.map((position, index) => ({
    id: `${shapeName}-${index}`,
    midi: position.midi,
    pitchClass: position.pitchClass,
    label: position.name,
    degree: position.degree,
    position: { string: position.string, fret: position.fret },
  }));

  const steps = options.ascendDescend
    ? [...raw, ...[...raw].reverse().slice(1).map((s, i) => ({ ...s, id: `${s.id}-d${i}` }))]
    : raw;

  return {
    id: `shape-${shapeName}`,
    name: shapeName,
    steps: withTiming(steps, options),
    bpm: options.bpm ?? 80,
    mode: options.mode ?? "free",
  };
}

/** Build an exercise from a chord's arpeggio. */
export function sequenceFromArpeggio(
  root: PitchClass | string,
  chordId: ChordId,
  options: SequenceBuildOptions & {
    board?: Fretboard;
    startOctave?: number;
    octaves?: number;
    direction?: "ascending" | "descending" | "up_down" | "down_up";
  } = {},
): PracticeSequence {
  const arpeggioOptions: Parameters<typeof getArpeggio>[2] = {
    startOctave: options.startOctave ?? 2,
    octaves: options.octaves ?? 1,
  };
  if (options.direction) arpeggioOptions.direction = options.direction;
  const tones = getArpeggio(root, chordId, arpeggioOptions);

  let lastPosition: { string: number; fret: number } | undefined;
  const steps = tones.map((tone, index) => {
    const step: PracticeStep = {
      id: `arp-${chordId}-${index}`,
      midi: tone.midi,
      pitchClass: tone.pitchClass,
      label: tone.name,
      degree: tone.degree,
    };
    if (!options.board) return step;
    const candidates = getFretPositions(options.board, tone.midi, { exactOctave: true });
    const pick = nearestPosition(candidates, lastPosition?.fret ?? 5, lastPosition?.string);
    if (!pick) return step;
    lastPosition = { string: pick.string, fret: pick.fret };
    return { ...step, position: { string: pick.string, fret: pick.fret } };
  });

  return {
    id: `arpeggio-${chordId}`,
    name: `${typeof root === "string" ? root : root} arpeggio`,
    steps: withTiming(steps, options),
    bpm: options.bpm ?? 80,
    mode: options.mode ?? "free",
  };
}
