import type { InstrumentGateOptions } from "../audio/quality";
import type { InstrumentKind } from "./tunings";

export interface InstrumentProfile {
  readonly id: string;
  readonly kind: InstrumentKind;
  readonly name: string;
  readonly stringCount: number;
  readonly fretCount: number;
  /**
   * Frequency window the pitch detector should trust for this instrument.
   * A 4-string bass bottoms out at E1 ≈ 41.2 Hz; a 5-string reaches B0 ≈ 30.87 Hz.
   * Searching below these limits only invites sub-harmonic errors.
   */
  readonly minFrequency: number;
  readonly maxFrequency: number;
  readonly description: string;
  /**
   * Detection tuning for this instrument.
   *
   * A single generic configuration does not work: a bass note's fundamental is
   * weak and its partials are dense, so it needs a more forgiving flatness
   * ceiling than a guitar, while a guitar's higher register tolerates a stricter
   * periodicity threshold. These feed the instrument gate.
   */
  readonly detection: InstrumentGateOptions;
}

export const INSTRUMENTS: readonly InstrumentProfile[] = [
  {
    id: "guitar-6",
    kind: "guitar",
    name: "Guitar",
    stringCount: 6,
    fretCount: 22,
    minFrequency: 70,
    maxFrequency: 1400,
    description: "6-string electric or acoustic",
    detection: {
      minClarity: 0.82,
      maxFlatness: 0.30,
      maxZeroCrossingRate: 0.32,
      maxCentsSpread: 35,
      activateConfidence: 0.62,
      releaseConfidence: 0.36,
    },
  },
  {
    id: "guitar-7",
    kind: "guitar",
    name: "7-String Guitar",
    stringCount: 7,
    fretCount: 24,
    minFrequency: 55,
    maxFrequency: 1400,
    description: "Extended range, low B",
    detection: {
      minClarity: 0.82,
      maxFlatness: 0.30,
      maxZeroCrossingRate: 0.30,
      maxCentsSpread: 35,
      activateConfidence: 0.62,
      releaseConfidence: 0.36,
    },
  },
  {
    id: "bass-4",
    kind: "bass",
    name: "Bass",
    stringCount: 4,
    fretCount: 20,
    minFrequency: 33,
    maxFrequency: 500,
    description: "4-string, E1 to G2 open",
    detection: {
      minClarity: 0.78,
      maxFlatness: 0.36,
      // A low note crosses zero rarely; anything busy is not the bass.
      maxZeroCrossingRate: 0.18,
      maxCentsSpread: 42,
      stabilityWindow: 7,
      activateConfidence: 0.58,
      releaseConfidence: 0.32,
    },
  },
  {
    id: "bass-5",
    kind: "bass",
    name: "5-String Bass",
    stringCount: 5,
    fretCount: 22,
    minFrequency: 26,
    maxFrequency: 500,
    description: "Low B0 at 30.87 Hz",
    detection: {
      minClarity: 0.76,
      maxFlatness: 0.38,
      maxZeroCrossingRate: 0.16,
      maxCentsSpread: 45,
      stabilityWindow: 8,
      activateConfidence: 0.56,
      releaseConfidence: 0.30,
    },
  },
  {
    id: "bass-6",
    kind: "bass",
    name: "6-String Bass",
    stringCount: 6,
    fretCount: 24,
    minFrequency: 26,
    maxFrequency: 700,
    description: "Low B0 through high C3",
    detection: {
      minClarity: 0.76,
      maxFlatness: 0.38,
      maxZeroCrossingRate: 0.20,
      maxCentsSpread: 45,
      stabilityWindow: 8,
      activateConfidence: 0.56,
      releaseConfidence: 0.30,
    },
  },
];

export const INSTRUMENTS_BY_ID: ReadonlyMap<string, InstrumentProfile> = new Map(
  INSTRUMENTS.map((i) => [i.id, i]),
);

export function getInstrument(id: string): InstrumentProfile | null {
  return INSTRUMENTS_BY_ID.get(id) ?? null;
}
