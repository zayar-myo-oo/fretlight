import { mod } from "../theory/pitch";
import {
  type GenContext,
  type Slot,
  bassRange,
  degreeWord,
  makeNote,
  nameOf,
  nearestMidi,
  profileOf,
  scalePitchClasses,
  solveSegment,
} from "./melody-engine";
import type { Idea, IdeaCategory, IdeaNote, NoteRole, ProgressionChord } from "./types";

/** Root of a chord in the bass's own low register (the lowest matching note). */
function rootMidi(ctx: GenContext, chord: ProgressionChord): number {
  const { low } = bassRange(ctx);
  return nearestMidi(chord.root, low, { low, high: low + 11 });
}

const fifthOf = (chord: ProgressionChord) => mod(chord.pitchClasses[2] ?? chord.root + 7, 12);
const thirdOf = (chord: ProgressionChord) => mod(chord.pitchClasses[1] ?? chord.root + 4, 12);

/** Notes from the key's scale between two pitches, used for walking and passing lines. */
function nextScaleStepUp(ctx: GenContext, midi: number): number {
  const scale = scalePitchClasses(ctx);
  for (let m = midi + 1; m <= midi + 3; m++) if (scale.has(mod(m, 12))) return m;
  return midi + 2;
}

function build(ctx: GenContext, category: IdeaCategory, title: string, notes: IdeaNote[], what: string, why: string, where: string, tip?: string): Idea {
  const { chords } = ctx.progression;
  const first = notes[0]!;
  return {
    id: `${category}-${ctx.variant}`,
    category,
    title,
    notes,
    fromChord: 0,
    toChord: chords.length - 1,
    target: { name: first.name, midi: first.midi, chordIndex: 0 },
    what,
    why,
    where,
    tip,
  };
}

const rolePick = (chord: ProgressionChord, midi: number, fallback: NoteRole): NoteRole => {
  const index = chord.pitchClasses.findIndex((p) => mod(p, 12) === mod(midi, 12));
  return index === 0 ? "root" : index > 0 ? "chordTone" : fallback;
};

/** Approach note a half step toward the next chord's root, from whichever side is nearer. */
function approachTo(current: number, nextRoot: number): number {
  return nextRoot >= current ? nextRoot - 1 : nextRoot + 1;
}

export function generateBass(ctx: GenContext, category: IdeaCategory): Idea[] {
  const { chords } = ctx.progression;
  const roots = chords.map((c) => rootMidi(ctx, c));
  const range = bassRange(ctx);
  const profile = profileOf(ctx);
  const lastTarget = (i: number) => roots[(i + 1) % chords.length]!;
  const note = (chord: ProgressionChord, midi: number, beat: number, dur: number, role?: NoteRole) =>
    makeNote(ctx, midi, chord.startBeat + beat, dur, chord, role ?? rolePick(chord, midi, "passing"));

  const each = (fn: (chord: ProgressionChord, i: number) => IdeaNote[]) => chords.flatMap((c, i) => fn(c, i));

  switch (category) {
    case "bass-root": {
      const notes = each((c, i) => [note(c, roots[i]!, 0, c.beats, "root")]);
      return [
        build(ctx, category, "Root notes", notes, notes.map((n) => n.name).join(" | "),
          "The root is the note the chord is named after. Bass that plays it holds the harmony together.",
          "Play the root on the first beat of each chord and let it ring.", "Start here before anything busier."),
      ];
    }
    case "bass-rootfifth": {
      const notes = each((c, i) => {
        const fifth = nearestMidi(fifthOf(c), roots[i]! + 7, range);
        return [note(c, roots[i]!, 0, c.beats / 2, "root"), note(c, fifth, c.beats / 2, c.beats / 2, "chordTone")];
      });
      return [
        build(ctx, category, "Root + 5th", notes, chords.map((c, i) => `${notes[i * 2]!.name} ${notes[i * 2 + 1]!.name}`).join(" | "),
          "The 5th sounds strong against the root and works in major and minor chords alike.",
          "Root on beats 1-2, 5th on beats 3-4.", "Keep the fifth above the root; the hand stays in one position."),
      ];
    }
    case "bass-octave": {
      const notes = each((c, i) => {
        const up = Math.min(range.high + 12, roots[i]! + 12);
        const q = c.beats / 4;
        return [0, 1, 2, 3].map((k) => note(c, k % 2 === 0 ? roots[i]! : up, k * q, q, k % 2 === 0 ? "root" : "chordTone"));
      });
      return [
        build(ctx, category, "Octaves", notes, chords.map((c, i) => `${notes[i * 4]!.name} ${notes[i * 4 + 1]!.name}`).join(" | "),
          "An octave repeats the root higher up, so the chord stays clear with more movement.",
          "Alternate the root and the same note an octave higher, a string over and two frets up.", "Mute the strings you are not playing."),
      ];
    }
    case "bass-passing": {
      const notes = each((c, i) => {
        const r = roots[i]!;
        const third = nearestMidi(thirdOf(c), r + 4, range);
        const step = Math.min(third - 1, Math.max(r + 1, nextScaleStepUp(ctx, r)));
        const fifth = nearestMidi(fifthOf(c), r + 7, range);
        const q = c.beats / 4;
        return [note(c, r, 0, q, "root"), note(c, step, q, q, "passing"), note(c, third, 2 * q, q, "chordTone"), note(c, fifth, 3 * q, q, "chordTone")];
      });
      return [
        build(ctx, category, "Passing notes", notes, chords.map((c, i) => notes.slice(i * 4, i * 4 + 4).map((n) => n.name).join(" ")).join(" | "),
          "Chord tones sit on the strong beats; the note between the root and 3rd is a passing note that connects them.",
          "Climb root → step → 3rd → 5th, one note per beat.", "Passing notes are never held; keep them short."),
      ];
    }
    case "bass-approach": {
      const notes = each((c, i) => {
        const approach = approachTo(roots[i]!, lastTarget(i));
        return [note(c, roots[i]!, 0, c.beats - 1, "root"), note(c, approach, c.beats - 1, 1, "approach")];
      });
      return [
        build(ctx, category, "Approach notes", notes, chords.map((c, i) => `${notes[i * 2]!.name} → ${notes[i * 2 + 1]!.name}`).join(" | "),
          "A note a half step away from the next root pulls the ear toward it.",
          "On beat 4 play the note one fret below (or above) the next chord's root, then land on it.", "Play the approach note a little shorter."),
      ];
    }
    case "bass-walking": {
      const notes = each((c, i) => {
        const r = roots[i]!;
        const next = lastTarget(i);
        const q = c.beats / 4;
        // Walk toward the next root: climb the chord when it is above, step down through it when it is below.
        const down = next < r && r - 8 >= range.low;
        const third = down ? nearestMidi(thirdOf(c), r - 8, { low: range.low, high: r - 1 }) : nearestMidi(thirdOf(c), r + 4, range);
        const fifth = down ? nearestMidi(fifthOf(c), r - 5, { low: range.low, high: r - 1 }) : nearestMidi(fifthOf(c), r + 7, range);
        const [second, third2] = down ? [fifth, third] : [third, fifth];
        const lead = approachTo(third2, next);
        return [note(c, r, 0, q, "root"), note(c, second, q, q, "chordTone"), note(c, third2, 2 * q, q, "chordTone"), note(c, lead, 3 * q, q, "approach")];
      });
      return [
        build(ctx, category, "Walking bass", notes, chords.map((c, i) => notes.slice(i * 4, i * 4 + 4).map((n) => n.name).join(" ")).join(" | "),
          "Four even notes a bar: the chord's own tones, then a lead-in to the next root.",
          "Quarter notes through the chord (root, 3rd and 5th), then a note leading into the next chord.", "Keep the notes even and the time steady."),
      ];
    }
    case "bass-melodic":
    case "bass-fills": {
      return [melodicBass(ctx, category, category === "bass-fills")];
    }
    case "bass-style":
      return [styleBass(ctx)];
    default:
      return [];
  }

  function melodicBass(context: GenContext, cat: IdeaCategory, fillsOnly: boolean): Idea {
    const kind = profile.target;
    const pcOf = (c: ProgressionChord, i: number) => (kind === "third" && (context.variant + i) % 2 === 1 ? thirdOf(c) : mod(c.root, 12));
    const notes: IdeaNote[] = [];
    const landings = chords.map((c, i) => nearestMidi(pcOf(c, i), roots[i]!, range));
    chords.forEach((c, i) => {
      const nextLanding = landings[(i + 1) % chords.length]!;
      const count = fillsOnly ? 2 : 4;
      const span = fillsOnly ? 2 : c.beats;
      const begin = c.startBeat + (c.beats - span);
      const step = span / count;
      if (fillsOnly) notes.push(note(c, landings[i]!, 0, c.beats - span, rolePick(c, landings[i]!, "root")));
      else notes.push(makeNote(context, landings[i]!, begin, step, c, rolePick(c, landings[i]!, "root")));
      const slots: Slot[] = Array.from({ length: fillsOnly ? count : count - 1 }, (_, k) => ({
        beat: begin + (fillsOnly ? k : k + 1) * step,
        chord: c,
      }));
      const path = solveSegment(context, { start: fillsOnly ? landings[i]! : landings[i]!, anchor: landings[i]!, slots, goal: nextLanding, range });
      path.forEach((midi, k) => notes.push(makeNote(context, midi, slots[k]!.beat, step, c)));
    });
    return build(
      context,
      cat,
      fillsOnly ? "Bass fills" : "Melodic bass",
      notes,
      notes.map((n) => n.name).join(" "),
      fillsOnly
        ? "Hold the root, then use the last two beats of each chord to walk into the next one."
        : "Every chord change lands on a chord tone, and the notes between connect by step.",
      "Aim each line at the first note of the next chord.",
      "Let the last note of a fill ring into the next bar.",
    );
  }

  function styleBass(context: GenContext): Idea {
    const simple = context.difficulty === "beginner";
    const eighth = (c: ProgressionChord, seq: number[], dur = 0.5, roles?: NoteRole[]) =>
      seq.map((midi, k) => note(c, midi, k * dur, dur, roles?.[k] ?? rolePick(c, midi, "passing")));
    const notes: IdeaNote[] = [];
    chords.forEach((c, i) => {
      const r = roots[i]!;
      const fifth = nearestMidi(fifthOf(c), r + 7, range);
      const octave = Math.min(range.high + 12, r + 12);
      const third = nearestMidi(thirdOf(c), r + 4, range);
      switch (context.style) {
        case "popPunk": {
          // Driving eighths: root root fifth fifth, repeated. Advanced adds an octave in the first half.
          const top = context.difficulty === "advanced" ? octave : fifth;
          notes.push(...eighth(c, context.difficulty === "advanced" ? [r, r, top, top, r, r, fifth, fifth] : [r, r, fifth, fifth, r, r, fifth, fifth]));
          break;
        }
        case "rock": {
          const lead = approachTo(fifth, lastTarget(i));
          notes.push(...eighth(c, simple ? [r, r, fifth, fifth, r, r, fifth, fifth] : [r, r, fifth, octave, fifth, r, fifth, lead]));
          break;
        }
        case "rockAndRoll": {
          // Classic shuffle figure: 1 3 5 6 5 3.
          const six = nearestMidi(mod(c.root + 9, 12), r + 9, range);
          const seq = c.quality === "min" || c.quality === "m7" ? [r, third, fifth, six, fifth, third] : [r, third, fifth, six, fifth, third];
          const triplet = c.beats / 6;
          seq.forEach((midi, k) => notes.push(note(c, midi, k * triplet, triplet, rolePick(c, midi, "passing"))));
          break;
        }
        case "emo": {
          // Independent of the guitar: start on the 5th or 3rd, then move by step to the next root.
          const start = (context.variant + i) % 2 === 0 ? fifth : third;
          const next = lastTarget(i);
          const slots: Slot[] = [{ beat: c.startBeat + 2, chord: c }];
          const mid = solveSegment(context, { start, anchor: start, slots, goal: next, range })[0]!;
          notes.push(note(c, start, 0, 2, rolePick(c, start, "chordTone")), makeNote(context, mid, c.startBeat + 2, 1.5, c), note(c, approachTo(mid, next), 3.5, 0.5, "approach"));
          break;
        }
        case "mathRock": {
          // Syncopated 3 + 3 + 2 grouping with displaced chord tones.
          const seq: [number, number][] = [[0, r], [0.75, fifth], [1.5, third], [2, r], [2.75, fifth], [3.5, octave]];
          seq.forEach(([beat, midi]) => notes.push(note(c, midi, beat, 0.5, rolePick(c, midi, "chordTone"))));
          break;
        }
        default: {
          notes.push(note(c, r, 0, 2, "root"), note(c, fifth, 2, 1, "chordTone"), note(c, third, 3, 1, "chordTone"));
        }
      }
    });
    const label = profile.label;
    const why: Record<string, string> = {
      popPunk: "Fast repeated eighths on the root and 5th keep the energy up, and they are easy to play with a pick.",
      rock: "Root, 5th and octave are the backbone of rock bass; the last note leads into the next root.",
      rockAndRoll: "The 1-3-5-6-5-3 figure is the classic shuffle pattern, played in a swung triplet feel.",
      emo: "The bass starts on the 3rd or 5th instead of doubling the guitar's root, then walks to the next root.",
      mathRock: "Chord tones land off the beat in a 3+3+2 grouping, so the bass answers the guitar instead of copying it.",
      alternative: "Root, 5th and 3rd with long, steady notes.",
      acoustic: "Root, 5th and 3rd with long, steady notes.",
    };
    return build(context, "bass-style", `${label} bass`, notes, notes.map((n) => n.name).join(" "),
      why[context.style] ?? "", "Land on the root of each chord at the start of its bar.", undefined);
  }
}

export { nameOf, degreeWord };
