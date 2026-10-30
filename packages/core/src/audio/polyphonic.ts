import { ChordStabilizer, matchChord, type ChordMatch } from "../theory/key-detection";
import { CHORDS } from "../theory/chords";
import { chromaFromSpectrum } from "./chroma";
import { SpectrumAnalyzer, spectralFlatness } from "./fft";
import { computePeak, computeRms } from "./yin";

export interface PolyphonicFrame {
  level: number;
  peak: number;
  active: boolean;
  chroma: readonly number[];
  /** Spectral pitch classes, not individually measured pitches or a fingering. */
  notes: readonly number[];
  raw: ChordMatch | null;
  chord: ChordMatch | null;
}

/** Independent FFT/chroma path: never derives chords from a sequence of YIN notes. */
export class PolyphonicDetector {
  private spectrum: SpectrumAnalyzer;
  private stable = new ChordStabilizer(3, 0.78);
  constructor(readonly sampleRate: number, readonly size = 8192, private gate = 0.0035) {
    this.spectrum = new SpectrumAnalyzer(size);
  }
  process(samples: Float32Array): PolyphonicFrame {
    const level = computeRms(samples), peak = computePeak(samples);
    const magnitudes = this.spectrum.analyze(samples);
    const active = level >= this.gate && spectralFlatness(magnitudes) < 0.3;
    const db = Float32Array.from(magnitudes, (v) => 20 * Math.log10(Math.max(1e-10, v / (this.size / 4))));
    const chroma = active ? chromaFromSpectrum(db, this.sampleRate, this.size, { suppressHarmonics: true }) : new Array<number>(12).fill(0);
    const notes = chroma.flatMap((v, pc) => v >= 0.22 ? [pc] : []);
    const matches = matchChord(chroma, 2);
    let raw = matches[0] ?? null;
    if (raw) {
      const tones = CHORDS[raw.chordId].intervals.map((i) => (raw!.root + i) % 12);
      // All defining tones must be observed. A lone pitch cannot become a power chord.
      const complete = tones.every((pc) => notes.includes(pc));
      // Exact pitch-class aliases (e.g. C6/Am7) are intrinsically ambiguous.
      const tied = matches[1] && raw.confidence - matches[1].confidence < 0.025;
      if (!complete || notes.length < 2 || tied || raw.confidence < 0.78) raw = null;
    }
    // Clear immediately on silence/no evidence instead of holding a confident stale chord.
    if (!active || !raw) this.stable = new ChordStabilizer(3, 0.78);
    const chord = this.stable.push(raw);
    return { level, peak, active, chroma, notes, raw, chord };
  }
}
