import { describe, expect, it } from "vitest";
import { midiToFrequency } from "../theory/pitch";
import { renderPluck } from "./pluck";

const SR = 48000;

/** Strongest autocorrelation lag in the plausible range, as a frequency. */
function estimateHz(samples: Float32Array, expected: number): number {
  const start = Math.floor(SR * 0.05);
  const len = 8192;
  const lo = Math.floor(SR / (expected * 1.3));
  const hi = Math.ceil(SR / (expected * 0.7));
  let best = lo;
  let bestScore = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += samples[start + i]! * samples[start + i + lag]!;
    if (sum > bestScore) {
      bestScore = sum;
      best = lag;
    }
  }
  return SR / best;
}

const base = { sampleRate: SR, decaySeconds: 2, brightness: 0.6, position: 0.13 };

describe("renderPluck", () => {
  it.each([40, 52, 64, 76])("sounds at the requested pitch (MIDI %i)", (midi) => {
    const f = midiToFrequency(midi);
    const hz = estimateHz(renderPluck({ ...base, frequency: f }), f);
    // within a quarter of a semitone
    expect(Math.abs(12 * Math.log2(hz / f))).toBeLessThan(0.25);
  });

  it("is deterministic and bounded", () => {
    const a = renderPluck({ ...base, frequency: 110 });
    const b = renderPluck({ ...base, frequency: 110 });
    expect(a).toEqual(b);
    expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(0.9001);
  });

  it("decays", () => {
    const s = renderPluck({ ...base, frequency: 196 });
    const rms = (from: number, to: number) =>
      Math.sqrt(s.slice(from, to).reduce((t, v) => t + v * v, 0) / (to - from));
    expect(rms(SR * 1.5, SR * 1.6)).toBeLessThan(rms(0, SR * 0.1) * 0.5);
  });
});
