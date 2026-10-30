import { describe, it, expect } from "vitest";
import { PitchPipeline } from "./pipeline";
import { InstrumentGate } from "./quality";
import { NoteStabilizer } from "./stabilizer";
import { PitchStateMachine } from "./pitch-state";
import { synthesizeGuitarNote, synthesizeTone } from "./test-signals";
import { getInstrument } from "../instrument/instruments";
import { midiToFrequency } from "../theory/pitch";
import { PolyphonicDetector } from "./polyphonic";

const rates = [44100, 48000, 96000];
describe("production-sized guitar frames, E2–E4", () => {
  for (const sampleRate of rates) it(`commits all 25 semitones at ${sampleRate} Hz`, () => {
    const latency: number[] = [], cost: number[] = [];
    for (let midi = 40; midi <= 64; midi++) {
      const profile = getInstrument("guitar-6")!;
      const pipeline = new PitchPipeline({ sampleRate, minFrequency: profile.minFrequency, maxFrequency: profile.maxFrequency, analyzeQuality: true });
      const size = 2 ** Math.ceil(Math.log2(pipeline.requiredFrameSize));
      const hop = Math.max(256, size >> 3);
      const gate = new InstrumentGate(profile.detection), stabilizer = new NoteStabilizer({ confirmFrames: 3, releaseFrames: 8 }), display = new PitchStateMachine();
      const lead = Math.round(sampleRate * 0.25);
      const signal = new Float32Array(sampleRate + lead);
      for (let i = 0; i < lead; i++) signal[i] = Math.sin(i * 1.71) * 0.0001;
      signal.set(synthesizeGuitarNote(midiToFrequency(midi), sampleRate, sampleRate, midi), lead);
      const committed = new Set<number>();
      let first = -1;
      for (let start = 0; start + size <= signal.length; start += hop) {
        const began = performance.now();
        const estimate = pipeline.process(signal.subarray(start, start + size));
        cost.push(performance.now() - began);
        const verdict = gate.evaluate(estimate, estimate.quality ?? { clarity: 0, flatness: 1, harmonicRatio: 0, zeroCrossingRate: 1, rms: estimate.rms, onset: false });
        const event = stabilizer.push(verdict.accepted ? estimate : { ...estimate, frequency: null, silent: true });
        const reading = event.type === "confirmed" || event.type === "sustained" || event.type === "candidate" ? event.reading : null;
        const result = display.update({ reading, accepted: verdict.accepted, confidence: verdict.confidence, timeMs: (start + size) / sampleRate * 1000 });
        if (result.state === "stable" && result.midi !== null) {
          committed.add(result.midi);
          if (first < 0) first = (start + size - lead) / sampleRate * 1000;
          expect(Math.abs(1200 * Math.log2(result.reading!.frequency / midiToFrequency(midi)))).toBeLessThan(20);
        }
      }
      expect([...committed], `MIDI ${midi}`).toEqual([midi]);
      expect(first).toBeLessThan(250);
      latency.push(first);
    }
    cost.sort((a, b) => a - b);
    console.log(JSON.stringify({ sampleRate, noteCount: 25, onsetToStableMs: { min: Math.min(...latency), max: Math.max(...latency) }, dspMsP95: cost[Math.floor(cost.length * .95)] }));
  });
});

const voicings: Record<string, number[]> = { C: [48, 52, 55, 60, 64], D: [50, 57, 62, 66], E: [40, 47, 52, 56, 59, 64], G: [43, 47, 50, 55, 59, 67], A: [45, 52, 57, 61, 64], Am: [45, 52, 57, 60, 64], Em: [40, 47, 52, 55, 59, 64], Dm: [50, 57, 62, 65], G7: [43, 47, 50, 55, 59, 65] };
describe("independent polyphonic waveform validation", () => {
  for (const sampleRate of rates) it(`recognizes clean harmonic chord voicings at ${sampleRate} Hz`, () => {
    const size = sampleRate > 48000 ? 16384 : 8192;
    for (const [symbol, notes] of Object.entries(voicings)) {
      const wave = new Float32Array(size);
      for (const midi of notes) {
        const tone = synthesizeTone({ frequency: midiToFrequency(midi), sampleRate, length: size, harmonics: [1, .5, .28, .16, .08], amplitude: .4 / notes.length, seed: midi });
        for (let i = 0; i < size; i++) wave[i]! += tone[i]!;
      }
      const detector = new PolyphonicDetector(sampleRate, size);
      let frame = detector.process(wave);
      for (let n = 0; n < 3; n++) frame = detector.process(wave);
      expect(frame.chord?.symbol, `${symbol}: ${JSON.stringify(frame)}`).toBe(symbol);
      expect(detector.process(new Float32Array(size)).chord).toBeNull();
    }
  });
  it("rejects single-note harmonics, silence and broadband noise", () => {
    for (let midi = 40; midi <= 64; midi++) {
      const detector = new PolyphonicDetector(48000);
      const tone = synthesizeGuitarNote(midiToFrequency(midi), 48000, 8192);
      for (let n = 0; n < 5; n++) expect(detector.process(tone).chord, `MIDI ${midi}`).toBeNull();
    }
    const detector = new PolyphonicDetector(48000);
    const noise = Float32Array.from({ length: 8192 }, (_, i) => Math.sin(i * i * 17.123) * .3);
    for (let n = 0; n < 5; n++) expect(detector.process(noise).chord).toBeNull();
  });
});

it("measures settling time for strummed chord waveforms", () => {
  const sampleRate = 48000, size = 8192, hop = 2400;
  const latencies: number[] = [];
  for (const [symbol, notes] of Object.entries(voicings)) {
    const lead = sampleRate / 4;
    const wave = new Float32Array(sampleRate * 2);
    for (let n = 0; n < notes.length; n++) {
      const start = lead + n * 960;
      const note = synthesizeGuitarNote(midiToFrequency(notes[n]!), sampleRate, wave.length - start, notes[n]);
      for (let i = 0; i < note.length; i++) wave[start + i]! += note[i]! / notes.length;
    }
    const detector = new PolyphonicDetector(sampleRate, size);
    let first = -1, last: string | undefined;
    for (let start = 0; start + size <= wave.length; start += hop) {
      const frame = detector.process(wave.subarray(start, start + size));
      last = frame.chord?.symbol;
      if (last === symbol && first < 0) first = (start + size - lead) / sampleRate * 1000;
    }
    expect(last, symbol).toBe(symbol); expect(first, symbol).toBeGreaterThan(0); expect(first, symbol).toBeLessThan(600);
    latencies.push(first);
  }
  console.log(JSON.stringify({ strummedChords: 9, sampleRate, onsetToStableChordMs: { min: Math.min(...latencies), max: Math.max(...latencies) } }));
});
