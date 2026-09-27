import { describe, expect, it } from "vitest";
import { PitchPipeline } from "./pipeline";
import { InstrumentGate } from "./quality";
import { NoteStabilizer } from "./stabilizer";
import { PitchStateMachine } from "./pitch-state";
import {
  synthesizeBassPluck,
  synthesizeGuitarNote,
  synthesizeSpeechLike,
  synthesizeTone,
} from "./test-signals";
import { getInstrument } from "../instrument/instruments";

const SAMPLE_RATE = 48000;
const FRAME = 8192;
/** Matches the AudioWorklet's hop: frameSize >> 3. */
const HOP = FRAME >> 3;

interface ChainResult {
  readonly acceptedFraction: number;
  /** Notes the UI actually committed to displaying. */
  readonly committedNotes: string[];
  /** Fraction of frames where a note was on screen. */
  readonly displayedFraction: number;
}

/**
 * Runs the complete production chain over a signal:
 * pipeline → instrument gate → stabiliser → display state machine.
 *
 * Testing the stages individually is not enough for the question that actually
 * matters — "does talking near the microphone put notes on screen?" — because
 * the answer depends on how the stages compose.
 */
function runChain(signal: Float32Array, instrumentId: string): ChainResult {
  const profile = getInstrument(instrumentId)!;
  const pipeline = new PitchPipeline({
    sampleRate: SAMPLE_RATE,
    minFrequency: profile.minFrequency,
    maxFrequency: profile.maxFrequency,
    analyzeQuality: true,
  });
  const gate = new InstrumentGate(profile.detection);
  const stabilizer = new NoteStabilizer({ confirmFrames: 3, releaseFrames: 8 });
  const display = new PitchStateMachine();

  let frames = 0;
  let accepted = 0;
  let displayed = 0;
  const committed = new Set<string>();

  for (let start = 0; start + FRAME <= signal.length; start += HOP) {
    const timeMs = (start / SAMPLE_RATE) * 1000;
    const estimate = pipeline.process(signal.subarray(start, start + FRAME));
    const verdict = gate.evaluate(
      estimate,
      estimate.quality ?? {
        clarity: estimate.clarity,
        flatness: 0.2,
        harmonicRatio: 0.4,
        zeroCrossingRate: 0.08,
        rms: estimate.rms,
        onset: false,
      },
    );

    const event = verdict.accepted
      ? stabilizer.push(estimate)
      : stabilizer.push({ ...estimate, frequency: null, silent: true });

    const reading =
      event.type === "confirmed" || event.type === "sustained" || event.type === "candidate"
        ? event.reading
        : null;

    const state = display.update({
      reading,
      accepted: verdict.accepted,
      confidence: verdict.confidence,
      timeMs,
    });

    frames++;
    if (verdict.accepted) accepted++;
    if (state.state === "stable" || state.state === "holding") {
      displayed++;
      if (state.reading) {
        committed.add(`${state.reading.note.name}${state.reading.note.octave}`);
      }
    }
  }

  return {
    acceptedFraction: accepted / frames,
    committedNotes: [...committed],
    displayedFraction: displayed / frames,
  };
}

describe("instrument signals get through", () => {
  it("commits a guitar note and holds it", () => {
    const result = runChain(synthesizeGuitarNote(110, SAMPLE_RATE, SAMPLE_RATE * 3), "guitar-6");
    expect(result.acceptedFraction).toBeGreaterThan(0.85);
    expect(result.committedNotes).toEqual(["A2"]);
    expect(result.displayedFraction).toBeGreaterThan(0.8);
  });

  it("commits a bass note, fundamental and all", () => {
    const result = runChain(synthesizeBassPluck(41.2, SAMPLE_RATE, SAMPLE_RATE * 3), "bass-4");
    expect(result.committedNotes).toEqual(["E1"]);
    expect(result.displayedFraction).toBeGreaterThan(0.8);
  });

  it("commits the low B on a 5-string", () => {
    const result = runChain(synthesizeBassPluck(30.87, SAMPLE_RATE, SAMPLE_RATE * 3), "bass-5");
    expect(result.committedNotes).toEqual(["B0"]);
  });

  it("settles on exactly one note for a sustained tone — no flicker", () => {
    const result = runChain(synthesizeGuitarNote(196, SAMPLE_RATE, SAMPLE_RATE * 4), "guitar-6");
    // One note across four seconds. More than one would be the flashing the
    // display state machine exists to prevent.
    expect(result.committedNotes.length).toBe(1);
  });
});

describe("quiet playing", () => {
  /** A note at a fraction of full level, after a second of room tone. */
  function quietRun(amplitude: number, instrumentId: string) {
    const note = synthesizeGuitarNote(196, SAMPLE_RATE, SAMPLE_RATE * 2);
    const signal = new Float32Array(SAMPLE_RATE + note.length);
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    // Room tone first, so the noise-floor tracker has something real to measure.
    for (let i = 0; i < signal.length; i++) signal[i] = random() * 0.0008;
    for (let i = 0; i < note.length; i++) signal[SAMPLE_RATE + i]! += note[i]! * amplitude;
    return runChain(signal, instrumentId);
  }

  it("hears a softly played note, not only a hard one", () => {
    // Regression. Two silence gates used to be applied in series — the
    // pipeline's, against the measured room floor, and the detector's own fixed
    // one against the decimated signal. The second silently discarded anything
    // quiet however low the first went, which is what made the app feel like it
    // only responded when you dug in.
    expect(quietRun(0.5, "guitar-6").committedNotes).toContain("G3");
    expect(quietRun(0.1, "guitar-6").committedNotes).toContain("G3");
    expect(quietRun(0.03, "guitar-6").committedNotes).toContain("G3");
  });

  it("still hears a very quiet note", () => {
    const result = quietRun(0.015, "guitar-6");
    expect(result.committedNotes).toContain("G3");
  });

  it("does not invent notes from room tone alone", () => {
    expect(quietRun(0, "guitar-6").committedNotes).toEqual([]);
  });
});

describe("speech does not", () => {
  it("never puts a note on screen for continuous speech", () => {
    const speech = synthesizeSpeechLike(150, SAMPLE_RATE, SAMPLE_RATE * 4);
    const result = runChain(speech, "guitar-6");
    expect(result.acceptedFraction).toBeLessThan(0.05);
    expect(result.committedNotes).toEqual([]);
    expect(result.displayedFraction).toBe(0);
  });

  it("rejects speech in the bass register too", () => {
    const speech = synthesizeSpeechLike(110, SAMPLE_RATE, SAMPLE_RATE * 4, { glideCents: 180 });
    const result = runChain(speech, "bass-4");
    expect(result.committedNotes).toEqual([]);
  });

  it("holds up against slower, more level speech", () => {
    const speech = synthesizeSpeechLike(130, SAMPLE_RATE, SAMPLE_RATE * 4, {
      glideCents: 90,
      glideRateHz: 1.5,
    });
    const result = runChain(speech, "guitar-6");
    // Occasional frames may slip past the gate on a plateau in the glide, but
    // the stabiliser and the display state machine must stop them reaching the
    // screen as a committed note.
    expect(result.committedNotes.length).toBe(0);
  });

  it("rejects broadband noise outright", () => {
    const noise = new Float32Array(SAMPLE_RATE * 2);
    let a = 1234;
    for (let i = 0; i < noise.length; i++) {
      a = (a * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = (a / 0x7fffffff) * 2 - 1;
    }
    const result = runChain(noise, "guitar-6");
    expect(result.committedNotes).toEqual([]);
  });
});

describe("a note played over background speech", () => {
  it("still commits the note", () => {
    const length = SAMPLE_RATE * 3;
    const note = synthesizeGuitarNote(196, SAMPLE_RATE, length);
    const speech = synthesizeSpeechLike(150, SAMPLE_RATE, length, { seed: 31 });

    // Speech at roughly a third of the instrument's level — someone talking in
    // the room while the player plays.
    const mixed = new Float32Array(length);
    for (let i = 0; i < length; i++) mixed[i] = note[i]! + speech[i]! * 0.35;

    const result = runChain(mixed, "guitar-6");
    expect(result.committedNotes).toContain("G3");
    expect(result.displayedFraction).toBeGreaterThan(0.5);
  });
});

describe("silence", () => {
  it("shows nothing at all", () => {
    const result = runChain(new Float32Array(SAMPLE_RATE * 2), "guitar-6");
    expect(result.committedNotes).toEqual([]);
    expect(result.acceptedFraction).toBe(0);
  });

  it("does not invent a note from a very quiet room", () => {
    const quiet = synthesizeTone({
      frequency: 60,
      sampleRate: SAMPLE_RATE,
      length: SAMPLE_RATE * 2,
      amplitude: 0.002,
      noise: 0.001,
    });
    expect(runChain(quiet, "guitar-6").committedNotes).toEqual([]);
  });
});
