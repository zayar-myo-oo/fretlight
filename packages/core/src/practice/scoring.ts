export interface AccuracyBreakdown {
  readonly correct: number;
  readonly wrong: number;
  readonly skipped: number;
  readonly total: number;
  /** Share of expected notes hit correctly, 0..1. */
  readonly pitchAccuracy: number;
  /** Mean timing accuracy over graded notes, 0..1. Always 1 for untimed exercises. */
  readonly timingAccuracy: number;
  /** Weighted blend used for the headline number. */
  readonly overall: number;
}

/**
 * The single place accuracy is defined. Pitch is weighted more heavily than
 * timing because playing the wrong note is a bigger error than playing the right
 * note slightly late — but timing still counts, which is the point of practising
 * with a click.
 */
export function scorePractice(input: {
  correct: number;
  wrong: number;
  skipped: number;
  total: number;
  timingSamples: readonly number[];
  pitchWeight?: number;
}): AccuracyBreakdown {
  const pitchWeight = input.pitchWeight ?? 0.65;
  const graded = input.correct + input.wrong + input.skipped;
  const pitchAccuracy = graded === 0 ? 0 : input.correct / graded;
  const timingAccuracy =
    input.timingSamples.length === 0
      ? 1
      : input.timingSamples.reduce((sum, value) => sum + value, 0) / input.timingSamples.length;

  return {
    correct: input.correct,
    wrong: input.wrong,
    skipped: input.skipped,
    total: input.total,
    pitchAccuracy,
    timingAccuracy,
    overall: pitchAccuracy * pitchWeight + timingAccuracy * (1 - pitchWeight),
  };
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
