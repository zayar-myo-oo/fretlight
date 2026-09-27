import { describe, expect, it } from "vitest";
import { PitchPipeline } from "./pipeline";
import { chooseDecimationFactor } from "./decimate";
import { synthesizeBassPluck, synthesizeGuitarNote, synthesizeTone } from "./test-signals";
import { calculateCents, frequencyToNote, noteToFrequency } from "../theory/pitch";

const SAMPLE_RATE = 48000;

const bass = () =>
  new PitchPipeline({ sampleRate: SAMPLE_RATE, minFrequency: 26, maxFrequency: 500 });
const guitar = () =>
  new PitchPipeline({ sampleRate: SAMPLE_RATE, minFrequency: 70, maxFrequency: 1400 });

const centsError = (detected: number, expected: number) =>
  Math.abs(calculateCents(detected, expected));

describe("decimation factor", () => {
  it("shrinks the work substantially for bass while staying above the fundamentals", () => {
    const factor = chooseDecimationFactor(SAMPLE_RATE, 500);
    expect(factor).toBeGreaterThan(4);
    expect(SAMPLE_RATE / factor).toBeGreaterThan(500 * 2);
  });

  it("decimates less for guitar, which reaches higher", () => {
    expect(chooseDecimationFactor(SAMPLE_RATE, 1400)).toBeLessThan(
      chooseDecimationFactor(SAMPLE_RATE, 500),
    );
  });

  it("never returns a factor below 1", () => {
    expect(chooseDecimationFactor(8000, 4000)).toBe(1);
  });
});

describe("PitchPipeline on bass", () => {
  it("still finds every open string on a 5-string after decimating", () => {
    const pipeline = bass();
    const frameSize = 8192;
    for (const [name, frequency] of Object.entries({
      B0: 30.87, E1: 41.2, A1: 55.0, D2: 73.42, G2: 98.0,
    })) {
      const frame = synthesizeBassPluck(frequency, SAMPLE_RATE, frameSize);
      const result = pipeline.process(frame);
      expect(result.frequency, `${name} produced no estimate`).not.toBeNull();
      expect(
        centsError(result.frequency!, frequency),
        `${name}: got ${result.frequency?.toFixed(2)} Hz, wanted ${frequency} Hz`,
      ).toBeLessThan(25);
      pipeline.reset();
    }
  });

  it("names the low B correctly", () => {
    const pipeline = bass();
    const frame = synthesizeBassPluck(30.87, SAMPLE_RATE, 8192);
    const reading = frequencyToNote(pipeline.process(frame).frequency!);
    expect(`${reading.note.name}${reading.note.octave}`).toBe("B0");
  });

  it("asks for a frame long enough to resolve its lowest note", () => {
    const pipeline = bass();
    expect(pipeline.requiredFrameSize).toBeGreaterThan(SAMPLE_RATE / 26);
    expect(pipeline.requiredFrameSize).toBeLessThanOrEqual(8192);
  });

  it("reports the input's level, not the filtered signal's", () => {
    const pipeline = bass();
    const loud = synthesizeBassPluck(41.2, SAMPLE_RATE, 8192);
    expect(pipeline.process(loud).rms).toBeGreaterThan(0.05);
  });

  it("gates silence before doing any work", () => {
    const result = bass().process(new Float32Array(8192));
    expect(result.silent).toBe(true);
    expect(result.frequency).toBeNull();
  });
});

describe("PitchPipeline on guitar", () => {
  it("tracks every open string in standard tuning", () => {
    const pipeline = guitar();
    for (const name of ["E2", "A2", "D3", "G3", "B3", "E4"]) {
      const frequency = noteToFrequency(name)!;
      const frame = synthesizeGuitarNote(frequency, SAMPLE_RATE, 4096);
      const result = pipeline.process(frame);
      expect(result.frequency, name).not.toBeNull();
      expect(centsError(result.frequency!, frequency), name).toBeLessThan(15);
      pipeline.reset();
    }
  });

  it("keeps tuner-grade resolution through the decimation", () => {
    const pipeline = guitar();
    const target = noteToFrequency("A2")! * Math.pow(2, 10 / 1200); // 10 cents sharp
    const frame = synthesizeGuitarNote(target, SAMPLE_RATE, 4096);
    const reading = frequencyToNote(pipeline.process(frame).frequency!);
    expect(reading.note.name).toBe("A");
    expect(reading.cents).toBeGreaterThan(4);
    expect(reading.cents).toBeLessThan(16);
  });
});

describe("PitchPipeline across sample rates", () => {
  it("works at 44.1 kHz as well as 48 kHz", () => {
    for (const sampleRate of [44100, 48000]) {
      const pipeline = new PitchPipeline({ sampleRate, minFrequency: 26, maxFrequency: 500 });
      const frame = synthesizeBassPluck(41.2, sampleRate, 8192);
      const result = pipeline.process(frame);
      expect(result.frequency, `${sampleRate} Hz`).not.toBeNull();
      expect(centsError(result.frequency!, 41.2), `${sampleRate} Hz`).toBeLessThan(25);
    }
  });

  it("agrees with the undecimated detector", () => {
    const frame = synthesizeTone({ frequency: 82.41, sampleRate: SAMPLE_RATE, length: 8192 });
    const decimated = new PitchPipeline({
      sampleRate: SAMPLE_RATE, minFrequency: 70, maxFrequency: 1400,
    }).process(frame);
    const direct = new PitchPipeline({
      sampleRate: SAMPLE_RATE, minFrequency: 70, maxFrequency: 1400, decimationFactor: 1,
    }).process(frame);
    expect(centsError(decimated.frequency!, direct.frequency!)).toBeLessThan(5);
  });
});
