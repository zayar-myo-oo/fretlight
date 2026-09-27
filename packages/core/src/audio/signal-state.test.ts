import { describe, expect, it } from "vitest";
import { assessSignal, type SignalInputs } from "./signal-state";

const base: SignalInputs = {
  listening: true,
  rms: 0.05,
  peak: 0.2,
  instrumentConfidence: 0,
  rejectReason: null,
  display: "detecting",
  positionScore: null,
};

describe("assessSignal", () => {
  it("reports no input when nothing is listening", () => {
    expect(assessSignal({ ...base, listening: false }).signal).toBe("no_input");
  });

  it("reports clipping when the peak hits the ceiling", () => {
    const result = assessSignal({ ...base, peak: 0.99 });
    expect(result.signal).toBe("clipping");
    expect(result.message).toMatch(/clip/i);
  });

  it("flags clipping even while a note is confidently held", () => {
    // A distorted input is bad information regardless of what is on screen —
    // the player needs to know their gain is too hot even mid-note.
    const result = assessSignal({ ...base, peak: 0.99, display: "stable", instrumentConfidence: 0.9 });
    expect(result.signal).toBe("clipping");
  });

  it("does not flag clipping for ordinary loud playing", () => {
    const result = assessSignal({ ...base, peak: 0.6, display: "stable" });
    expect(result.signal).toBe("note_detected");
  });

  it("respects a custom clip threshold", () => {
    expect(assessSignal({ ...base, peak: 0.5 }, { clip: 0.4 }).signal).toBe("clipping");
    expect(assessSignal({ ...base, peak: 0.3 }, { clip: 0.4 }).signal).not.toBe("clipping");
  });

  it("still reports a held note as note_detected when nothing is clipping", () => {
    expect(assessSignal({ ...base, display: "stable", peak: 0.4 }).signal).toBe("note_detected");
    expect(assessSignal({ ...base, display: "holding", peak: 0.4 }).signal).toBe("note_detected");
  });

  it("falls back through no_signal / low_signal / noise as before", () => {
    expect(assessSignal({ ...base, rms: 0.001 }).signal).toBe("no_signal");
    expect(assessSignal({ ...base, rms: 0.01 }).signal).toBe("low_signal");
    expect(assessSignal({ ...base, rms: 0.05, rejectReason: "noise_like" }).signal).toBe("noise");
  });
});
