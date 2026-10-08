import { SHARP_NAMES } from "../theory/types";

/**
 * Rule-based reading of the practice history: what improved, what is ready to
 * speed up, which skills are weak, and what to do next. Nothing is guessed: a
 * skill with no data says so instead of showing a made-up score.
 */

export interface SessionLike {
  /** ISO timestamp. */
  readonly date: string;
  readonly exercise: string;
  readonly instrumentId: string;
  readonly bpm: number;
  readonly durationSeconds: number;
  readonly pitchAccuracy: number;
  readonly timingAccuracy: number;
  readonly overall: number;
}

export interface TallyLike {
  readonly attempts: number;
  readonly correct: number;
}

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const average = (values: readonly number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

export interface DayComparison {
  readonly today: number;
  readonly previous: number;
  /** "Yesterday", or the date of the last day practised before today. */
  readonly previousLabel: string;
  readonly delta: number;
}

/** Today's average accuracy against the last earlier day with practice. Null without both. */
export function compareWithPreviousDay(records: readonly SessionLike[], now: Date = new Date()): DayComparison | null {
  const todayKey = dayKey(now.toISOString());
  const byDay = new Map<string, number[]>();
  for (const r of records) {
    const key = dayKey(r.date);
    byDay.set(key, [...(byDay.get(key) ?? []), r.overall]);
  }
  const today = byDay.get(todayKey);
  const earlier = [...byDay.keys()].filter((k) => k < todayKey).sort();
  const lastKey = earlier[earlier.length - 1];
  if (!today || !lastKey) return null;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const previous = average(byDay.get(lastKey)!);
  const current = average(today);
  return {
    today: current,
    previous,
    previousLabel: lastKey === dayKey(yesterday.toISOString()) ? "Yesterday" : lastKey,
    delta: current - previous,
  };
}

export interface TempoReady {
  readonly exercise: string;
  readonly bpm: number;
  readonly next: number;
}

/**
 * An exercise is ready to speed up when its last three runs at the current top
 * tempo all scored 85% or better. Suggests 10 BPM more.
 */
export function tempoReadiness(records: readonly SessionLike[], threshold = 0.85): TempoReady[] {
  const byExercise = new Map<string, SessionLike[]>();
  for (const r of records) byExercise.set(r.exercise, [...(byExercise.get(r.exercise) ?? []), r]);
  const out: TempoReady[] = [];
  for (const [exercise, runs] of byExercise) {
    const sorted = [...runs].sort((a, b) => b.date.localeCompare(a.date));
    const top = Math.max(...sorted.map((r) => r.bpm));
    const atTop = sorted.filter((r) => r.bpm === top).slice(0, 3);
    if (atTop.length === 3 && atTop.every((r) => r.overall >= threshold)) out.push({ exercise, bpm: top, next: Math.min(240, top + 10) });
  }
  return out;
}

export interface Skill {
  readonly id: "timing" | "pitch" | "notes" | "positions" | "scales" | "bass";
  readonly label: string;
  /** 0..1, or null when there is not enough data to say. */
  readonly score: number | null;
  /** What the score is based on. */
  readonly basis: string;
}

const tallyScore = (tallies: Record<string, TallyLike>) => {
  let attempts = 0;
  let correct = 0;
  for (const t of Object.values(tallies)) {
    attempts += t.attempts;
    correct += t.correct;
  }
  return { attempts, score: attempts >= 10 ? correct / attempts : null };
};

const SCALE_WORDS = /scale|pentatonic|major|minor|dorian|phrygian|lydian|mixolydian|locrian|blues|position/i;

/** Skill scores from data the app actually records. */
export function skillMap(
  records: readonly SessionLike[],
  notes: Record<string, TallyLike>,
  positions: Record<string, TallyLike>,
): Skill[] {
  const enough = records.length >= 2;
  const scales = records.filter((r) => SCALE_WORDS.test(r.exercise));
  const bass = records.filter((r) => r.instrumentId.startsWith("bass"));
  const noteScore = tallyScore(notes);
  const positionScore = tallyScore(positions);
  return [
    { id: "timing", label: "Timing", score: enough ? average(records.map((r) => r.timingAccuracy)) : null, basis: `${records.length} sessions` },
    { id: "pitch", label: "Pitch", score: enough ? average(records.map((r) => r.pitchAccuracy)) : null, basis: `${records.length} sessions` },
    { id: "notes", label: "Knowing the notes", score: noteScore.score, basis: `${noteScore.attempts} notes played` },
    { id: "positions", label: "Fretboard positions", score: positionScore.score, basis: `${positionScore.attempts} positions played` },
    { id: "scales", label: "Scales", score: scales.length >= 2 ? average(scales.map((r) => r.overall)) : null, basis: `${scales.length} scale sessions` },
    { id: "bass", label: "Bass", score: bass.length >= 2 ? average(bass.map((r) => r.overall)) : null, basis: `${bass.length} bass sessions` },
  ];
}

export interface Recommendation {
  readonly title: string;
  readonly detail: string;
  /** Where to go to do it, with the settings already filled in. */
  readonly href: string;
}

/** The weakest notes with enough attempts to trust (at least 5, below 75%). */
export function weakNotes(notes: Record<string, TallyLike>, limit = 2): { pitchClass: number; accuracy: number }[] {
  return Object.entries(notes)
    .filter(([, t]) => t.attempts >= 5)
    .map(([pc, t]) => ({ pitchClass: Number(pc), accuracy: t.correct / t.attempts }))
    .filter((n) => n.accuracy < 0.75)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, limit);
}

/** What to practise next, most useful first. Empty history gets a starting point. */
export function recommendations(records: readonly SessionLike[], notes: Record<string, TallyLike>): Recommendation[] {
  const out: Recommendation[] = [];
  const recent = [...records].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const typicalBpm = recent.length ? Math.round(average(recent.map((r) => r.bpm)) / 5) * 5 : 80;
  const timing = recent.length >= 3 ? average(recent.map((r) => r.timingAccuracy)) : null;
  const slower = Math.max(50, typicalBpm - 10);

  const weak = weakNotes(notes);
  if (weak.length) {
    const names = weak.map((n) => SHARP_NAMES[n.pitchClass]!).join(" + ");
    const bpm = timing !== null && timing < 0.7 ? slower : typicalBpm;
    out.push({
      title: `Practise ${names}`,
      detail: `${weak.map((n) => `${SHARP_NAMES[n.pitchClass]} ${Math.round(n.accuracy * 100)}%`).join(", ")}. A note drill on just these, ${bpm} BPM, about 5 minutes.`,
      href: `/practice?kind=note&notes=${weak.map((n) => n.pitchClass).join(",")}&bpm=${bpm}`,
    });
  }

  if (timing !== null && timing < 0.7) {
    out.push({
      title: `Slow down to ${slower} BPM`,
      detail: `Your timing has averaged ${Math.round(timing * 100)}% over your last ${recent.length} sessions. Play slower and in time first; speed comes after.`,
      href: `/practice?bpm=${slower}`,
    });
  }

  for (const ready of tempoReadiness(records).slice(0, 2)) {
    out.push({
      title: `You are ready for ${ready.next} BPM`,
      detail: `Your last three "${ready.exercise}" runs at ${ready.bpm} BPM all scored 85% or more.`,
      href: `/practice?bpm=${ready.next}`,
    });
  }

  if (records.length === 0) {
    out.push({
      title: "Start with a note drill",
      detail: "Ten notes, any position, with the metronome off. It gives Fretlight something to learn from.",
      href: "/practice?kind=note",
    });
  }
  return out;
}
