import { midiToNote } from "../theory/pitch";
import type { Spelling } from "../theory/types";
import type { Fretboard } from "./fretboard";

/**
 * One place on the neck where a detected pitch could have been played,
 * with a score for how likely it is that this is where it actually was.
 */
export interface PositionCandidate {
  readonly string: number;
  readonly fret: number;
  readonly midi: number;
  readonly name: string;
  readonly octave: number;
  /** 0..1 — higher is more likely. */
  readonly score: number;
  /** Per-factor contributions, for debugging and for explaining the choice. */
  readonly factors: {
    readonly playability: number;
    /** How far along the neck from the previous note. */
    readonly proximity: number;
    /** Whether this stays on the string the player was already on. */
    readonly stringContinuity: number;
    readonly hand: number;
    readonly stringHint: number;
  };
}

export interface PositionContext {
  /**
   * Where the fretting hand is, along the neck — from the player telling us, or
   * from camera hand tracking.
   *
   * This is the single most valuable piece of context there is. Audio cannot
   * distinguish an A2 on the low E at fret 5 from the open A string; they are
   * the same waveform. Without knowing roughly where the hand is, the estimator
   * can only guess, and guessing "the lowest position" is wrong for most real
   * playing — a pentatonic box at the 5th fret gets drawn down at the nut.
   */
  readonly handFret?: { readonly fret: number; readonly confidence: number } | null;
  /** Frets the hand can reach without shifting. Defaults to the estimator's span. */
  readonly handSpan?: number;
  /** Which string the camera or the practice exercise expects. */
  readonly stringHint?: { readonly string: number; readonly confidence: number } | null;
  /** How much to trust the pitch itself; a shaky reading should not force a move. */
  readonly pitchConfidence?: number;
  /** An exercise's expected position — strong evidence when practising. */
  readonly expected?: { readonly string: number; readonly fret: number } | null;
}

export interface PositionEstimatorOptions {
  /**
   * How much better a rival candidate must score before the estimate moves off
   * the position currently held. This is the hysteresis that stops the highlight
   * flipping between two equivalent places for the same note.
   */
  readonly stickiness?: number;
  /** Frets within this distance count as reachable without shifting the hand. */
  readonly handSpan?: number;
  /** Bias toward open strings and low frets, as a beginner would play. */
  readonly preferOpenPositions?: boolean;
  readonly spelling?: Spelling;
  /** Forget the previous position after this many milliseconds of silence. */
  readonly memoryMs?: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Works out where on the neck a detected pitch was most likely played.
 *
 * A single pitch class appears in many places — an A2 on a bass is playable on
 * the E string at fret 5, the A string open, or the D string at fret 7. Lighting
 * up all of them is not information, it is wallpaper: it tells the player
 * nothing about what they just did.
 *
 * So candidates are generated from the tuning, then ranked on the evidence that
 * is actually available — where the hand was last time, where the camera says it
 * is now, which string the exercise expects, and how playable the position is —
 * and only the winner is reported.
 *
 * Two properties matter as much as the ranking itself:
 *
 *  - **Continuity.** A hand does not teleport. A candidate three frets from the
 *    last one is far more likely than one twelve frets away, so the previous
 *    position is weighted heavily.
 *  - **Hysteresis.** When two candidates score almost the same, the one already
 *    held wins. Without this the highlight oscillates between equivalent
 *    positions on a sustained note, which looks broken even though every
 *    individual frame was "correct".
 */
export class PositionEstimator {
  private current: PositionCandidate | null = null;
  private lastSeenAt = 0;
  /**
   * Where the fretting hand appears to be, inferred from recent play.
   *
   * Only *fretted* notes update this. An open string is played without the hand
   * being anywhere in particular, so treating fret 0 as evidence of hand
   * position would drag the anchor to the nut every time a player used one.
   */
  private anchorFret: number | null = null;

  private readonly stickiness: number;
  private readonly handSpan: number;
  private readonly preferOpenPositions: boolean;
  private readonly spelling: Spelling;
  private readonly memoryMs: number;

  constructor(
    private board: Fretboard,
    options: PositionEstimatorOptions = {},
  ) {
    this.stickiness = options.stickiness ?? 0.12;
    this.handSpan = options.handSpan ?? 5;
    this.preferOpenPositions = options.preferOpenPositions ?? true;
    this.spelling = options.spelling ?? "sharp";
    this.memoryMs = options.memoryMs ?? 2500;
  }

  /** Swap the neck (instrument or tuning change) and forget the held position. */
  setBoard(board: Fretboard): void {
    this.board = board;
    this.reset();
  }

  get held(): PositionCandidate | null {
    return this.current;
  }

  /** Where the hand appears to be, or null before any fretted note. */
  get inferredHandFret(): number | null {
    return this.anchorFret === null ? null : Math.round(this.anchorFret);
  }

  /** Every place this exact pitch can be played, unranked. */
  candidatesFor(midi: number): PositionCandidate[] {
    const out: PositionCandidate[] = [];
    for (let string = 0; string < this.board.stringCount; string++) {
      const fret = midi - this.board.openMidi[string]!;
      if (fret < 0 || fret > this.board.fretCount) continue;
      const note = midiToNote(midi, this.spelling);
      out.push({
        string,
        fret,
        midi,
        name: note.name,
        octave: note.octave,
        score: 0,
        factors: { playability: 0, proximity: 0, stringContinuity: 0, hand: 0, stringHint: 0 },
      });
    }
    return out;
  }

  /**
   * Rank the candidates and return the most likely one.
   * `timeMs` lets the estimator forget a stale position after a long silence.
   */
  estimate(
    midi: number,
    context: PositionContext = {},
    timeMs = 0,
  ): { best: PositionCandidate | null; candidates: PositionCandidate[] } {
    // After a long gap the player has probably moved; the old position is no
    // longer evidence of anything.
    if (timeMs > 0 && this.lastSeenAt > 0 && timeMs - this.lastSeenAt > this.memoryMs) {
      this.current = null;
      this.anchorFret = null;
    }

    const raw = this.candidatesFor(midi);
    if (raw.length === 0) return { best: null, candidates: [] };

    const previous = this.current;
    // Resolve the anchor once, up front. It used to be assigned inside the
    // per-candidate scoring function, which meant the first candidate was scored
    // with no anchor and the rest were scored with one — different weightings
    // for the same decision, and an order-dependent winner.
    const anchor = context.handFret?.fret ?? this.anchorFret;
    const scored = raw
      .map((candidate) => this.score(candidate, context, previous, anchor))
      .sort((a, b) => b.score - a.score);

    let best = scored[0]!;

    // Hysteresis: stay where we are unless a rival is clearly better.
    if (previous) {
      const heldNow = scored.find(
        (candidate) => candidate.string === previous.string && candidate.fret === previous.fret,
      );
      if (heldNow && heldNow.score >= best.score - this.stickiness) {
        best = heldNow;
      }
    }

    this.current = best;
    // The player telling us where their hand is overrides anything inferred.
    if (context.handFret) this.anchorFret = context.handFret.fret;
    // Fretted notes move the anchor; open strings leave it where it was.
    else if (best.fret > 0) {
      this.anchorFret =
        this.anchorFret === null ? best.fret : this.anchorFret * 0.45 + best.fret * 0.55;
    }
    if (timeMs > 0) this.lastSeenAt = timeMs;
    return { best, candidates: scored };
  }

  private score(
    candidate: PositionCandidate,
    context: PositionContext,
    previous: PositionCandidate | null,
    anchorFret: number | null,
  ): PositionCandidate {
    // --- Playability: a weak prior for the first note of a phrase, when there
    // is nothing better to go on. Open strings get a small nudge, deliberately
    // small: an earlier version gave them enough of a bonus to beat string
    // continuity, so a player working up the E string had every note reported
    // on the open A instead.
    const fretRatio = candidate.fret / Math.max(1, this.board.fretCount);
    let playability = 1 - fretRatio * 0.45;
    if (this.preferOpenPositions && candidate.fret === 0) playability = Math.min(1, playability + 0.08);
    playability = clamp01(playability);

    // --- Continuity: how far this is from where the hand appears to be.
    //
    // Measured against the inferred anchor rather than the literal previous
    // note, so a phrase that dips to an open string does not reset the sense of
    // where the player is standing. An open string itself is neutral: it costs
    // nothing from any hand position, because it needs no hand at all.
    let proximity = 0.5;
    if (anchorFret !== null) {
      if (candidate.fret === 0) {
        proximity = 0.75;
      } else {
        const distance = Math.abs(candidate.fret - anchorFret);
        const shift = Math.max(0, distance - this.handSpan);
        proximity = clamp01(1 - shift / 8 - distance * 0.03);
      }
    }

    // A mild tie-breaker only. Players cross strings constantly, so this must
    // never be strong enough to insist a phrase stays on one string.
    let stringContinuity = 0.5;
    if (previous) {
      const stringDistance = Math.abs(candidate.string - previous.string);
      stringContinuity = stringDistance === 0 ? 1 : stringDistance === 1 ? 0.7 : 0.45;
    }

    // --- Where the fretting hand is.
    let hand = 0.5;
    let handWeight = 0;
    if (context.handFret && context.handFret.confidence > 0.25) {
      const anchor = context.handFret.fret;
      const span = context.handSpan ?? this.handSpan;
      const distance = Math.abs(candidate.fret - anchor);

      // Inside the hand's span costs almost nothing; beyond it the score falls
      // away sharply, because reaching there means physically shifting position.
      hand = distance <= span ? 1 - (distance / span) * 0.15 : clamp01(0.85 - (distance - span) / 6);

      // Open strings stay cheap from anywhere — players reach for them
      // constantly without leaving the position they are in. A floor, not a
      // fixed value: with the hand at the nut an open string is the *best*
      // answer, and pinning it would rank a fretted note above it.
      if (candidate.fret === 0) hand = Math.max(hand, 0.8);

      handWeight = context.handFret.confidence;
    }

    // --- An explicit string hint, from string detection or from the exercise.
    let stringHint = 0.5;
    let stringWeight = 0;
    if (context.stringHint && context.stringHint.confidence > 0.25) {
      stringHint = candidate.string === context.stringHint.string ? 1 : 0.15;
      stringWeight = context.stringHint.confidence;
    }
    if (context.expected) {
      const match =
        candidate.string === context.expected.string && candidate.fret === context.expected.fret;
      stringHint = Math.max(stringHint, match ? 1 : 0.2);
      stringWeight = Math.max(stringWeight, 0.8);
    }

    // Weights renormalise over whatever evidence exists, so the estimator
    // behaves sensibly with audio alone and gets sharper as the camera and the
    // exercise contribute.
    const weights = {
      // Deliberately the smallest term. "Easiest to play" is a reasonable
      // tie-breaker and a bad primary signal: it is what made the estimator
      // insist every phrase was being played at the nut.
      playability: this.anchorFret === null ? 0.30 : 0.14,
      proximity: this.anchorFret === null ? 0 : 0.46,
      // Only once there is a hand anchor. Before that, a player who has so far
      // touched only open strings is most likely still on them, and a string
      // continuity bonus would talk the estimator out of that.
      stringContinuity: previous && this.anchorFret !== null ? 0.12 : 0,
      hand: 1.1 * handWeight,
      stringHint: 0.6 * stringWeight,
    };
    const total =
      weights.playability +
        weights.proximity +
        weights.stringContinuity +
        weights.hand +
        weights.stringHint || 1;

    const score =
      (playability * weights.playability +
        proximity * weights.proximity +
        stringContinuity * weights.stringContinuity +
        hand * weights.hand +
        stringHint * weights.stringHint) /
      total;

    return {
      ...candidate,
      score: clamp01(score),
      factors: { playability, proximity, hand, stringHint, stringContinuity },
    };
  }

  /** Called when the note is released — keeps the position as a hint, briefly. */
  release(timeMs = 0): void {
    if (timeMs > 0) this.lastSeenAt = timeMs;
  }

  reset(): void {
    this.current = null;
    this.lastSeenAt = 0;
    this.anchorFret = null;
  }
}
