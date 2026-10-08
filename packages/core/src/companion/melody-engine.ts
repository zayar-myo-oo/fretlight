import type { Fretboard } from "../instrument/fretboard";
import { mod } from "../theory/pitch";
import { spellPitchClass } from "../song-analysis/timeline-builder";
import { pitchRange } from "./placement";
import { type Progression, keyPitchClasses } from "./progression";
import { STYLE_PROFILES, type StyleProfile } from "./styles";
import type { CompanionStyle, Difficulty, Idea, IdeaNote, NoteRole, ProgressionChord } from "./types";

/**
 * The note-choosing core. Every melodic idea is a short path from a starting
 * note to a *target* chord tone, found by a small dynamic-programming search:
 * strong beats must be chord tones, weak beats may pass through the key's notes,
 * big leaps cost more than steps (voice leading), and the last note should
 * arrive on the target by step when it can. Nothing is random: the same inputs
 * give the same line, and `variant` selects the next-best alternative.
 */
export interface GenContext {
  readonly board: Fretboard;
  readonly progression: Progression;
  readonly style: CompanionStyle;
  readonly difficulty: Difficulty;
  /** 0 = best line; higher numbers give different, still valid alternatives. */
  readonly variant: number;
  readonly instrument: "guitar" | "bass";
}

export interface Range {
  readonly low: number;
  readonly high: number;
}

export const profileOf = (ctx: GenContext): StyleProfile => STYLE_PROFILES[ctx.style];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Where lead lines sit: around G3-E5 on guitar, nudged up for styles that live higher. */
export function leadRange(ctx: GenContext): Range {
  const pr = pitchRange(ctx.board);
  if (ctx.instrument === "bass") return bassRange(ctx);
  const low = clamp(55 + profileOf(ctx).registerShift, pr.low, pr.high - 14);
  return { low, high: Math.min(pr.high, low + 17) };
}

/** Counter-melodies sit a little higher so they do not crowd the lead or the bass. */
export function counterRange(ctx: GenContext): Range {
  const pr = pitchRange(ctx.board);
  if (ctx.instrument === "bass") return bassRange(ctx);
  const low = clamp(60 + profileOf(ctx).registerShift, pr.low, pr.high - 14);
  return { low, high: Math.min(pr.high, low + 15) };
}

/** Bass lines use the instrument's lowest octave and a half. */
export function bassRange(ctx: GenContext): Range {
  const pr = pitchRange(ctx.board);
  return { low: pr.low, high: Math.min(pr.high, pr.low + 19) };
}

/** Notes the key (and style) allows as passing tones. */
export function scalePitchClasses(ctx: GenContext): Set<number> {
  const key = ctx.progression.key.key;
  const base = keyPitchClasses(ctx.progression);
  if (!key || profileOf(ctx).scale !== "pentatonic") return base;
  // Pentatonic: leave out the two notes that rub against chords (4th and 7th of major; 2nd and 6th of minor).
  const drop = key.mode === "major" ? [3, 6] : [1, 5];
  return new Set(key.pitchClasses.filter((_, i) => !drop.includes(i)));
}

export function chordAtBeat(progression: Progression, beat: number): ProgressionChord {
  const total = progression.totalBeats;
  const b = ((beat % total) + total) % total;
  return progression.chords.find((c) => b >= c.startBeat && b < c.startBeat + c.beats) ?? progression.chords[0]!;
}

/** Chord tones allowed at this level: the plain triad for beginners, the whole chord after that. */
export function usableTones(ctx: GenContext, chord: ProgressionChord): number[] {
  return ctx.difficulty === "beginner" ? chord.pitchClasses.slice(0, 3).map((p) => mod(p, 12)) : chord.pitchClasses.map((p) => mod(p, 12));
}

function jitter(ctx: GenContext, slot: number, midi: number): number {
  if (ctx.variant === 0) return 0;
  let h = (slot * 73856093) ^ (midi * 19349663) ^ (ctx.variant * 83492791);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h >>> 0) % 1000) / 1000 * 0.7;
}

function intervalCost(profile: StyleProfile, difficulty: Difficulty, semitones: number): number {
  const d = Math.abs(semitones);
  const a = profile.arpeggio;
  let cost: number;
  if (d === 0) cost = profile.repeatCost;
  else if (d <= 2) cost = 0;
  else if (d <= 4) cost = 0.55 - 0.45 * a;
  else if (d === 5) cost = 1.1 - 0.6 * a;
  else if (d === 7) cost = 1.7 - 1.0 * a;
  else if (d === 12) cost = profile.octaveCost;
  else cost = 2.6 + 0.15 * d;
  if (difficulty === "beginner" && d > 5 && d !== 12) cost += 2;
  return cost;
}

export interface Slot {
  readonly beat: number;
  readonly chord: ProgressionChord;
}

export interface SegmentSpec {
  /** The note just before the segment (fixed). Null: the search also picks the first note near `anchor`. */
  readonly start: number | null;
  readonly anchor: number;
  readonly slots: readonly Slot[];
  readonly goal: number;
  readonly range: Range;
}

interface Candidate {
  midi: number;
  tone: boolean;
  cost: number;
}

/** Best path through the slots from `start` to `goal`. Returns one midi note per slot. */
export function solveSegment(ctx: GenContext, spec: SegmentSpec): number[] {
  const profile = profileOf(ctx);
  const scale = scalePitchClasses(ctx);
  const n = spec.slots.length;
  if (n === 0) return [];
  const goalPc = mod(spec.goal, 12);

  const candidates: Candidate[][] = spec.slots.map((slot, k) => {
    const tones = new Set(usableTones(ctx, slot.chord));
    const strong = Number.isInteger(slot.beat);
    const root = mod(slot.chord.root, 12);
    const out: Candidate[] = [];
    for (let midi = spec.range.low; midi <= spec.range.high; midi++) {
      const pc = mod(midi, 12);
      const isTone = tones.has(pc);
      const isScale = scale.has(pc) || slot.chord.pitchClasses.some((p) => mod(p, 12) === pc);
      const isExt = profile.extensions && ctx.difficulty !== "beginner" && isScale && (pc === mod(root + 2, 12) || pc === mod(root + 9, 12));
      const isApproach = ctx.difficulty === "advanced" && k === n - 1 && (pc === mod(goalPc + 1, 12) || pc === mod(goalPc - 1, 12));

      let cost: number;
      if (strong) {
        if (isTone) cost = 0;
        else if (isExt) cost = 0.9;
        else continue; // strong beats are chord tones, always
      } else if (isTone) cost = 0.05;
      else if (ctx.difficulty === "beginner") continue;
      else if (isScale) cost = 0.3;
      else if (isApproach) cost = 0.6;
      else continue;
      out.push({ midi, tone: isTone, cost: cost + jitter(ctx, k, midi) });
    }
    return out;
  });
  if (candidates.some((c) => c.length === 0)) return spec.slots.map(() => spec.goal);

  // A non-chord-tone must be reached and left by step.
  const pair = (prev: Candidate, cur: Candidate) => {
    const d = Math.abs(cur.midi - prev.midi);
    return intervalCost(profile, ctx.difficulty, d) + ((!prev.tone || !cur.tone) && d > 2 ? 2 : 0);
  };

  let costs = candidates[0]!.map((c) => {
    const first = spec.start === null ? Math.abs(c.midi - spec.anchor) * 0.12 : intervalCost(profile, ctx.difficulty, c.midi - spec.start);
    return c.cost + first + (spec.start !== null && !c.tone && Math.abs(c.midi - spec.start) > 2 ? 2 : 0);
  });
  const back: number[][] = [];
  for (let k = 1; k < n; k++) {
    const next: number[] = [];
    const from: number[] = [];
    for (const cur of candidates[k]!) {
      let best = Infinity;
      let bestFrom = 0;
      candidates[k - 1]!.forEach((prev, j) => {
        const total = costs[j]! + pair(prev, cur);
        if (total < best) {
          best = total;
          bestFrom = j;
        }
      });
      next.push(best + cur.cost);
      from.push(bestFrom);
    }
    costs = next;
    back.push(from);
  }

  // Arrival: landing on the target by step is what makes a fill sound like it resolves.
  const finish = candidates[n - 1]!.map((c, j) => {
    const d = Math.abs(spec.goal - c.midi);
    const arrival = intervalCost(profile, ctx.difficulty, d) + (d <= 2 && d > 0 ? -0.3 : d === 0 ? 0.2 : 0.4) + (!c.tone && d > 2 ? 2 : 0);
    return costs[j]! + arrival;
  });
  let index = finish.indexOf(Math.min(...finish));
  const path: number[] = new Array(n);
  for (let k = n - 1; k >= 0; k--) {
    path[k] = candidates[k]![index]!.midi;
    if (k > 0) index = back[k - 1]![index]!;
  }
  return path;
}

/** The midi in `range` with pitch class `pc` nearest `anchor`. */
export function nearestMidi(pc: number, anchor: number, range: Range): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let midi = range.low; midi <= range.high; midi++) {
    if (mod(midi, 12) !== mod(pc, 12)) continue;
    const d = Math.abs(midi - anchor);
    if (d < bestDistance) {
      bestDistance = d;
      best = midi;
    }
  }
  return best >= 0 ? best : Math.round(anchor);
}

export function degreeWord(chord: ProgressionChord, pc: number): string {
  const index = chord.pitchClasses.findIndex((p) => mod(p, 12) === mod(pc, 12));
  if (index === 0) return "root";
  if (index === 1) return chord.quality === "sus2" ? "2nd" : chord.quality === "sus4" ? "4th" : "3rd";
  if (index === 2) return "5th";
  if (index === 3) return chord.quality === "add9" ? "9th" : "7th";
  return "note";
}

export function nameOf(ctx: GenContext, midi: number): string {
  return spellPitchClass(mod(midi, 12), ctx.progression.key.key);
}

/** Which role a note plays against the chord sounding when it starts. */
export function roleOf(chord: ProgressionChord, midi: number, isTarget = false): NoteRole {
  const pc = mod(midi, 12);
  if (isTarget) return "target";
  const index = chord.pitchClasses.findIndex((p) => mod(p, 12) === pc);
  if (index === 0) return "root";
  if (index > 0) return "chordTone";
  return "passing";
}

export function makeNote(
  ctx: GenContext,
  midi: number,
  startBeat: number,
  durationBeats: number,
  chord: ProgressionChord,
  role?: NoteRole,
): IdeaNote {
  return {
    midi,
    name: nameOf(ctx, midi),
    startBeat,
    durationBeats,
    role: role ?? roleOf(chord, midi),
    chordIndex: chord.index,
  };
}

/** Which tone of the next chord a fill lands on: the style's habit, rotated by `variant`. */
function targetPc(ctx: GenContext, chord: ProgressionChord): { pc: number; kind: "root" | "third" | "fifth" } {
  const order: ("root" | "third" | "fifth")[] =
    profileOf(ctx).target === "root" ? ["root", "third", "fifth"] : ["third", "root", "fifth"];
  const kind = order[ctx.variant % 3]!;
  const index = kind === "root" ? 0 : kind === "third" ? 1 : 2;
  return { pc: mod(chord.pitchClasses[Math.min(index, chord.pitchClasses.length - 1)]!, 12), kind };
}

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

/** Guitar fills: one per chord change, ending on a chord tone of the chord that follows. */
export function generateFills(ctx: GenContext, fillBeats = 2): Idea[] {
  const { chords, totalBeats } = ctx.progression;
  const profile = profileOf(ctx);
  const range = leadRange(ctx);
  const anchor = Math.round((range.low + range.high) / 2);
  const out: Idea[] = [];

  chords.forEach((cur, i) => {
    const next = chords[(i + 1) % chords.length]!;
    const nextStart = i + 1 < chords.length ? next.startBeat : totalBeats;
    const firstBeat = nextStart - fillBeats;
    if (firstBeat < 0) return;

    const perBeat = Math.max(1, profile.density[ctx.difficulty]);
    const count = Math.max(1, Math.round(fillBeats * perBeat));
    const step = fillBeats / count;
    const slots: Slot[] = Array.from({ length: count }, (_, k) => {
      const beat = firstBeat + k * step;
      return { beat, chord: chordAtBeat(ctx.progression, beat) };
    });

    const goalInfo = targetPc(ctx, next);
    const goal = nearestMidi(goalInfo.pc, anchor, range);
    const path = solveSegment(ctx, { start: null, anchor, slots, goal, range });

    const notes: IdeaNote[] = path.map((midi, k) => makeNote(ctx, midi, slots[k]!.beat, step, slots[k]!.chord));
    notes.push(makeNote(ctx, goal, nextStart, 2, next, "target"));

    const names = notes.map((n) => n.name);
    const targetName = names[names.length - 1]!;
    const first = notes[0]!;
    const middle = notes.slice(1, -1);
    const passing = middle.filter((n) => n.role === "passing");
    const why: string[] = [
      `${first.name} is the ${degreeWord(cur, first.midi) === "note" ? "scale note" : degreeWord(cur, first.midi)} of the ${cur.symbol} chord.`,
    ];
    if (passing.length) {
      why.push(`${passing.map((n) => n.name).join(" and ")} ${plural(passing.length, "connects", "connect")} toward ${next.symbol}.`);
    }
    why.push(`${targetName} is the ${goalInfo.kind} of the ${next.symbol} chord, so the line lands on a note that belongs to the new chord.`);

    out.push({
      id: `fill-${i}`,
      category: "fills",
      title: `${fillBeats === 1 ? "Quick" : "Short"} fill into ${next.symbol}`,
      notes,
      fromChord: i,
      toChord: Math.min(i + 1, chords.length - 1),
      target: { name: targetName, midi: goal, chordIndex: next.index },
      what: names.join(" → "),
      why: why.join(" "),
      where: `Resolve on ${targetName}, the ${goalInfo.kind} of the ${next.symbol} chord.`,
      tip: profile.techniques.includes("slide") && ctx.difficulty !== "beginner" ? "Try sliding into the last note." : undefined,
    });
  });
  return out;
}

/** A chord tone of `chord` chosen by voice leading: the nearest one to where the melody was. */
function voiceLead(ctx: GenContext, chord: ProgressionChord, previous: number | null, range: Range, avoidRoot: boolean): number {
  const anchor = previous ?? Math.round((range.low + range.high) / 2);
  const tones = usableTones(ctx, chord).slice(0, 3);
  const pool = avoidRoot && tones.length > 1 ? tones.slice(1) : tones;
  const options = pool.map((pc) => nearestMidi(pc, anchor, range));
  const scored = options.map((midi) => ({ midi, cost: Math.abs(midi - anchor) + jitter(ctx, chord.index, midi) * 3 }));
  scored.sort((a, b) => a.cost - b.cost || a.midi - b.midi);
  return scored[0]!.midi;
}

/** A melody that visits a chord tone of every chord, connected by passing notes. */
export function generateLead(ctx: GenContext): Idea[] {
  return [melodyThroughChords(ctx, "lead", leadRange(ctx), false)];
}

/** A second, quieter line: chord tones that are not the root, in a higher register. */
export function generateCounter(ctx: GenContext): Idea[] {
  return [melodyThroughChords(ctx, "counter", counterRange(ctx), true)];
}

function melodyThroughChords(ctx: GenContext, category: "lead" | "counter", range: Range, avoidRoot: boolean): Idea {
  const { chords } = ctx.progression;
  const profile = profileOf(ctx);
  const perBar = category === "counter"
    ? { beginner: 1, intermediate: 2, advanced: 4 }[ctx.difficulty]
    : Math.max(2, Math.round(4 * profile.density[ctx.difficulty] * (ctx.difficulty === "advanced" ? 0.75 : 0.5)));

  // One landing note per chord, picked by voice leading so the line moves in small steps.
  const anchors: number[] = [];
  chords.forEach((chord, i) => {
    if (i === 0) {
      const first = avoidRoot ? { pc: mod(chord.pitchClasses[1] ?? chord.root, 12) } : targetPc(ctx, chord);
      anchors.push(nearestMidi(first.pc, Math.round((range.low + range.high) / 2), range));
    } else anchors.push(voiceLead(ctx, chord, anchors[i - 1]!, range, avoidRoot));
  });

  const notes: IdeaNote[] = [];
  chords.forEach((chord, i) => {
    const count = Math.max(1, Math.min(perBar, Math.round(chord.beats * 2)));
    const step = chord.beats / count;
    const landing = anchors[i]!;
    notes.push(makeNote(ctx, landing, chord.startBeat, step, chord, "target"));
    if (count > 1) {
      const slots: Slot[] = Array.from({ length: count - 1 }, (_, k) => ({ beat: chord.startBeat + (k + 1) * step, chord }));
      const goal = anchors[(i + 1) % chords.length]!;
      const path = solveSegment(ctx, { start: landing, anchor: landing, slots, goal, range });
      path.forEach((midi, k) => notes.push(makeNote(ctx, midi, slots[k]!.beat, step, chord)));
    }
  });

  const landings = notes.filter((n) => n.role === "target");
  const names = landings.map((n) => n.name);
  const passing = notes.filter((n) => n.role === "passing");
  const lines = chords.map((chord, i) => `${landings[i]!.name} is the ${degreeWord(chord, landings[i]!.midi)} of ${chord.symbol}`);
  return {
    id: `${category}-0`,
    category,
    title: category === "lead" ? "Lead melody from chord tones" : "Counter melody",
    notes,
    fromChord: 0,
    toChord: chords.length - 1,
    target: { name: names[0]!, midi: landings[0]!.midi, chordIndex: 0 },
    what: notes.map((n) => n.name).join(" → "),
    why:
      `${lines.join("; ")}.` +
      (passing.length ? ` ${[...new Set(passing.map((n) => n.name))].join(" and ")} connect${passing.length === 1 ? "s" : ""} the chord tones.` : "") +
      (category === "counter" ? " It avoids the root so it does not double the bass." : ""),
    where: `Each chord change lands on a chord tone of the new chord, and the last note leads back to ${names[0]}.`,
    tip: category === "counter" ? "Play it softer than the main melody." : undefined,
  };
}
