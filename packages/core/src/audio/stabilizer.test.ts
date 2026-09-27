import { describe, expect, it } from "vitest";
import { NoteStabilizer, median } from "./stabilizer";
import { SignalConditioner } from "./conditioning";
import { noteToFrequency } from "../theory/pitch";
import type { PitchEstimate } from "./types";

const frame = (frequency: number | null, clarity = 0.95): PitchEstimate => ({
  frequency,
  clarity: frequency === null ? 0 : clarity,
  rms: frequency === null ? 0 : 0.2,
  peak: frequency === null ? 0 : 0.3,
  silent: frequency === null,
});

describe("NoteStabilizer", () => {
  it("waits for agreement before confirming a note", () => {
    const stabilizer = new NoteStabilizer({ confirmFrames: 3 });
    const a2 = noteToFrequency("A2")!;
    expect(stabilizer.push(frame(a2)).type).toBe("candidate");
    expect(stabilizer.push(frame(a2)).type).toBe("candidate");
    expect(stabilizer.push(frame(a2)).type).toBe("confirmed");
    expect(stabilizer.push(frame(a2)).type).toBe("sustained");
  });

  it("absorbs a single glitched frame mid-sustain", () => {
    const stabilizer = new NoteStabilizer({ confirmFrames: 3 });
    const a2 = noteToFrequency("A2")!;
    const c3 = noteToFrequency("C3")!;
    stabilizer.push(frame(a2));
    stabilizer.push(frame(a2));
    stabilizer.push(frame(a2));
    // The median filter swallows one outlier outright, so the note never even
    // becomes a candidate for switching.
    const glitch = stabilizer.push(frame(c3));
    expect(glitch.type).toBe("sustained");
    expect(stabilizer.currentMidi).toBe(45); // still A2
  });

  it("does not switch notes until the new one has been agreed on", () => {
    const stabilizer = new NoteStabilizer({ confirmFrames: 3, medianWindow: 3 });
    const a2 = noteToFrequency("A2")!;
    const c3 = noteToFrequency("C3")!;
    for (let i = 0; i < 4; i++) stabilizer.push(frame(a2));
    expect(stabilizer.currentMidi).toBe(45);

    // A genuine note change needs confirmFrames agreeing frames to take effect.
    expect(stabilizer.push(frame(c3)).type).toBe("sustained"); // median still A2
    expect(stabilizer.push(frame(c3)).type).toBe("candidate");
    expect(stabilizer.currentMidi).toBe(45);
    stabilizer.push(frame(c3));
    expect(stabilizer.push(frame(c3)).type).toBe("confirmed");
    expect(stabilizer.currentMidi).toBe(48); // C3
  });

  it("rejects low-clarity frames", () => {
    const stabilizer = new NoteStabilizer({ minClarity: 0.8 });
    expect(stabilizer.push(frame(110, 0.4)).type).toBe("silent");
  });

  it("releases the note only after sustained silence", () => {
    const stabilizer = new NoteStabilizer({ confirmFrames: 2, releaseFrames: 3 });
    const e1 = noteToFrequency("E1")!;
    stabilizer.push(frame(e1));
    expect(stabilizer.push(frame(e1)).type).toBe("confirmed");
    expect(stabilizer.push(frame(null)).type).toBe("silent");
    expect(stabilizer.push(frame(null)).type).toBe("silent");
    expect(stabilizer.push(frame(null)).type).toBe("released");
    expect(stabilizer.currentMidi).toBeNull();
  });

  it("median-filters jitter out of the reported frequency", () => {
    const stabilizer = new NoteStabilizer({ confirmFrames: 1, medianWindow: 5 });
    const a4 = 440;
    for (const hz of [a4, a4 + 0.3, a4 - 0.2, 455, a4 + 0.1]) stabilizer.push(frame(hz));
    const result = stabilizer.push(frame(a4));
    if (result.type === "sustained" || result.type === "confirmed") {
      // the 455 Hz outlier must not drag the readout sharp
      expect(Math.abs(result.reading.cents)).toBeLessThan(10);
    } else {
      throw new Error(`unexpected event ${result.type}`);
    }
  });
});

describe("median", () => {
  it("handles odd, even and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("SignalConditioner", () => {
  it("removes a DC offset without destroying the tone", () => {
    const sampleRate = 48000;
    const buffer = new Float32Array(4096);
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = 0.5 + 0.3 * Math.sin((2 * Math.PI * 82.41 * i) / sampleRate);
    }
    new SignalConditioner(sampleRate, 70, 1400).processInPlace(buffer);

    const tail = buffer.subarray(2048);
    const mean = tail.reduce((sum, v) => sum + v, 0) / tail.length;
    expect(Math.abs(mean)).toBeLessThan(0.02);

    let peak = 0;
    for (const value of tail) peak = Math.max(peak, Math.abs(value));
    expect(peak).toBeGreaterThan(0.1);
  });

  it("produces finite output for every sample", () => {
    const buffer = new Float32Array(1024).fill(0.7);
    new SignalConditioner(48000, 26, 500).processInPlace(buffer);
    expect([...buffer].every(Number.isFinite)).toBe(true);
  });
});
