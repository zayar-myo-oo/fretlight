import { calculateCents } from "../theory/pitch";
import type { FrameQuality, PitchEstimate } from "./types";

export type RejectReason =
  | "accepted"
  | "silent"
  | "aperiodic"
  | "noise_like"
  | "unstable_pitch"
  | "below_gate";

export interface GateVerdict {
  readonly accepted: boolean;
  /** 0..1 — how much this looks like a plucked string rather than anything else. */
  readonly confidence: number;
  readonly reason: RejectReason;
  /** 0..1 — how steady the pitch has been across recent frames. */
  readonly pitchStability: number;
}

export interface InstrumentGateOptions {
  /** Clarity below this is not a pitched instrument note. */
  readonly minClarity?: number;
  /** Flatness above this is noise-like. */
  readonly maxFlatness?: number;
  /** Zero-crossing rate above this suggests consonants or noise. */
  readonly maxZeroCrossingRate?: number;
  /** Cents of spread across the stability window that still counts as steady. */
  readonly maxCentsSpread?: number;
  /** Frames of pitch history used to judge stability. */
  readonly stabilityWindow?: number;
  /** Confidence needed to start accepting. */
  readonly activateConfidence?: number;
  /** Confidence needed to keep accepting once started. Lower than activate. */
  readonly releaseConfidence?: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Decides whether a frame is a real instrument note or something else in the room.
 *
 * The core problem: speech and a guitar overlap heavily in frequency, so a band
 * filter cannot separate them. Nor can periodicity alone — a sung or spoken
 * vowel is periodic, and a naive "clarity > 0.8" gate happily reports notes
 * while someone talks.
 *
 * What actually separates them is how the pitch *behaves over time*. Speech is
 * never still: prosody slides the fundamental tens of cents within a syllable.
 * A fretted string is mechanically fixed — it holds pitch to within a few cents
 * until it is released. So pitch stability carries the most weight here, backed
 * by spectral flatness (vowels are noisier than strings), harmonic structure and
 * periodicity.
 *
 * Accept and release use different thresholds. With one threshold, a signal
 * hovering near it flickers the UI on and off several times a second, which is
 * the specific failure this class exists to prevent.
 */
export class InstrumentGate {
  private readonly minClarity: number;
  private readonly maxFlatness: number;
  private readonly maxZeroCrossingRate: number;
  private readonly maxCentsSpread: number;
  private readonly stabilityWindow: number;
  private readonly activateConfidence: number;
  private readonly releaseConfidence: number;

  private history: number[] = [];
  private accepting = false;

  constructor(options: InstrumentGateOptions = {}) {
    this.minClarity = options.minClarity ?? 0.80;
    this.maxFlatness = options.maxFlatness ?? 0.32;
    this.maxZeroCrossingRate = options.maxZeroCrossingRate ?? 0.30;
    this.maxCentsSpread = options.maxCentsSpread ?? 38;
    this.stabilityWindow = options.stabilityWindow ?? 6;
    this.activateConfidence = options.activateConfidence ?? 0.60;
    this.releaseConfidence = options.releaseConfidence ?? 0.34;
  }

  evaluate(estimate: PitchEstimate, quality: FrameQuality): GateVerdict {
    if (estimate.silent || estimate.frequency === null) {
      this.history = [];
      this.accepting = false;
      return { accepted: false, confidence: 0, reason: "silent", pitchStability: 0 };
    }

    this.history.push(estimate.frequency);
    if (this.history.length > this.stabilityWindow) this.history.shift();

    const pitchStability = this.measureStability();

    // Hard rejections — no amount of the other terms should rescue these.
    if (quality.clarity < this.minClarity * 0.75) {
      this.accepting = false;
      return { accepted: false, confidence: 0, reason: "aperiodic", pitchStability };
    }
    if (quality.zeroCrossingRate > this.maxZeroCrossingRate * 1.5) {
      this.accepting = false;
      return { accepted: false, confidence: 0, reason: "noise_like", pitchStability };
    }

    const clarityScore = clamp01((quality.clarity - this.minClarity) / (1 - this.minClarity));
    const flatnessScore = clamp01((this.maxFlatness - quality.flatness) / this.maxFlatness);
    const harmonicScore = clamp01((quality.harmonicRatio - 0.18) / 0.45);
    const zcrScore = clamp01((this.maxZeroCrossingRate - quality.zeroCrossingRate) / this.maxZeroCrossingRate);

    const confidence = clamp01(
      pitchStability * 0.38 +
        clarityScore * 0.27 +
        flatnessScore * 0.20 +
        harmonicScore * 0.10 +
        zcrScore * 0.05,
    );

    const threshold = this.accepting ? this.releaseConfidence : this.activateConfidence;
    const accepted = confidence >= threshold;
    this.accepting = accepted;

    if (!accepted) {
      // Name the dominant failure so the UI can say something useful and so
      // tuning these thresholds later is not guesswork.
      const reason: RejectReason =
        pitchStability < 0.4 ? "unstable_pitch" : flatnessScore < 0.4 ? "noise_like" : "below_gate";
      return { accepted: false, confidence, reason, pitchStability };
    }

    return { accepted: true, confidence, reason: "accepted", pitchStability };
  }

  /**
   * 1 when every recent frame agreed on the pitch, falling to 0 as the spread
   * approaches `maxCentsSpread`. Two frames are not enough to judge, so a fresh
   * note gets the benefit of the doubt rather than being rejected at its onset.
   */
  private measureStability(): number {
    if (this.history.length < 3) return 0.62;

    let min = Infinity;
    let max = -Infinity;
    for (const frequency of this.history) {
      if (frequency < min) min = frequency;
      if (frequency > max) max = frequency;
    }
    if (min <= 0) return 0;

    const spread = Math.abs(calculateCents(max, min));
    return clamp01(1 - spread / this.maxCentsSpread);
  }

  get isAccepting(): boolean {
    return this.accepting;
  }

  reset(): void {
    this.history = [];
    this.accepting = false;
  }
}
