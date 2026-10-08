import { describe, expect, it } from "vitest";
import {
  clearRegion, encodeWav, levelOf, mixTracks, peaksOf, positionInfo, repeatLoop, replaceRegion, snapLoopSeconds,
} from "./loop-math";

describe("snapLoopSeconds", () => {
  it("keeps a free loop exactly as recorded", () => {
    expect(snapLoopSeconds(7.61, 120, 4, "free").seconds).toBe(7.61);
  });
  it("rounds a musical loop to whole bars", () => {
    // 120 BPM in 4/4 is 2 s per bar
    expect(snapLoopSeconds(15.4, 120, 4, "musical")).toEqual({ seconds: 16, bars: 8 });
    expect(snapLoopSeconds(0.3, 120, 4, "musical").bars).toBe(1);
  });
});

describe("positionInfo", () => {
  it("reports bar and beat", () => {
    expect(positionInfo(5, 16, 120, 4)).toMatchObject({ bar: 3, beat: 3, totalBars: 8 });
  });
  it("wraps around the loop", () => {
    expect(positionInfo(17, 16, 120, 4).bar).toBe(1);
    expect(positionInfo(-1, 16, 120, 4).bar).toBe(8);
  });
});

describe("waveform and editing", () => {
  it("finds the loudest sample per bucket", () => {
    const peaks = peaksOf(Float32Array.from([0.1, -0.5, 0.2, 0.9]), 2);
    expect(peaks[0]).toBeCloseTo(0.5);
    expect(peaks[1]).toBeCloseTo(0.9);
  });
  it("punches a section in without touching the rest", () => {
    const base = new Float32Array(100).fill(0.1);
    const take = new Float32Array(100).fill(0.9);
    const out = replaceRegion(base, take, 100, 0.2, 0.5);
    expect(out[10]).toBeCloseTo(0.1);
    expect(out[30]).toBeCloseTo(0.9);
    expect(out[60]).toBeCloseTo(0.1);
    expect(base[30]).toBeCloseTo(0.1);
  });
  it("silences a section", () => {
    const out = clearRegion(new Float32Array(1000).fill(0.5), 1000, 0.2, 0.6, 0);
    expect(out[300]).toBe(0);
    expect(out[100]).toBeCloseTo(0.5);
    expect(out[800]).toBeCloseTo(0.5);
  });
  it("tapers beside the cut so it does not click", () => {
    const out = clearRegion(new Float32Array(1000).fill(0.5), 1000, 0.4, 0.6, 0.02);
    expect(out[399]).toBeLessThan(0.1);
    expect(out[300]).toBeCloseTo(0.5);
  });
});

describe("mixing and export", () => {
  it("mixes with volume and avoids clipping", () => {
    const a = new Float32Array(4).fill(0.8);
    const mixed = mixTracks([{ samples: a, volume: 1 }, { samples: a, volume: 1 }], 4);
    expect(Math.max(...mixed)).toBeLessThanOrEqual(1);
    expect(mixTracks([{ samples: a, volume: 0.5 }], 4)[0]).toBeCloseTo(0.4);
  });
  it("repeats a loop", () => {
    expect(Array.from(repeatLoop(Float32Array.from([1, 2]), 3))).toEqual([1, 2, 1, 2, 1, 2]);
  });
  it("writes a valid WAV header", () => {
    const wav = encodeWav(Float32Array.from([0, 0.5, -0.5]), 44100);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(44100);
    expect(wav.length).toBe(44 + 6);
  });
  it("detects clipping", () => {
    expect(levelOf(Float32Array.from([0.2, 0.99])).clipping).toBe(true);
    expect(levelOf(Float32Array.from([0.2, 0.5])).clipping).toBe(false);
  });
});
