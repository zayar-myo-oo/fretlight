import { describe, expect, it } from "vitest";
import { PitchStateMachine } from "./pitch-state";
import { frequencyToNote, noteToFrequency } from "../theory/pitch";

const reading = (name: string, centsOffset = 0) =>
  frequencyToNote(noteToFrequency(name)! * Math.pow(2, centsOffset / 1200));

const good = (name: string, timeMs: number, confidence = 0.9, centsOffset = 0) => ({
  reading: reading(name, centsOffset),
  accepted: true,
  confidence,
  timeMs,
});

const silent = (timeMs: number) => ({
  reading: null,
  accepted: false,
  confidence: 0,
  timeMs,
});

describe("committing a note", () => {
  it("starts with nothing", () => {
    expect(new PitchStateMachine().state.state).toBe("no_signal");
  });

  it("waits before committing, so a transient never reaches the screen", () => {
    const machine = new PitchStateMachine({ minStableMs: 80 });
    expect(machine.update(good("A2", 0)).state).toBe("detecting");
    expect(machine.update(good("A2", 40)).state).toBe("detecting");
    expect(machine.update(good("A2", 90)).state).toBe("stable");
    expect(machine.state.reading!.note.name).toBe("A");
  });

  it("ignores a note that does not persist", () => {
    const machine = new PitchStateMachine({ minStableMs: 80 });
    machine.update(good("A2", 0));
    machine.update(good("C3", 30));
    machine.update(good("E3", 60));
    // Nothing held long enough — the display never committed to anything.
    expect(machine.state.state).toBe("detecting");
    expect(machine.state.midi).toBeNull();
  });

  it("rejects a note below the activation confidence", () => {
    const machine = new PitchStateMachine({ minStableMs: 10, activateConfidence: 0.6 });
    machine.update(good("A2", 0, 0.4));
    expect(machine.update(good("A2", 50, 0.4)).state).toBe("no_signal");
  });
});

describe("a sustained note stays put — the core complaint", () => {
  it("holds one stable note across many frames without flickering", () => {
    const machine = new PitchStateMachine({ minStableMs: 60 });
    const states: string[] = [];
    for (let t = 0; t <= 3000; t += 25) {
      // Confidence and cents wobble the way a real decaying note does.
      const confidence = 0.75 + Math.sin(t / 90) * 0.12;
      states.push(machine.update(good("A2", t, confidence, Math.sin(t / 40) * 3)).state);
    }
    const afterCommit = states.slice(6);
    expect(new Set(afterCommit)).toEqual(new Set(["stable"]));
  });

  it("keeps updating cents while the note itself is anchored", () => {
    const machine = new PitchStateMachine({ minStableMs: 10 });
    machine.update(good("A2", 0));
    machine.update(good("A2", 40, 0.9, -20));
    const flat = machine.state.reading!.cents;
    machine.update(good("A2", 80, 0.9, 20));
    const sharp = machine.state.reading!.cents;

    expect(flat).toBeLessThan(0);
    expect(sharp).toBeGreaterThan(0);
    // Same note throughout — only the deviation moved.
    expect(machine.state.midi).toBe(reading("A2").note.midi);
  });

  it("does not re-trigger the change timestamp on a sustained note", () => {
    const machine = new PitchStateMachine({ minStableMs: 10 });
    machine.update(good("A2", 0));
    machine.update(good("A2", 40));
    const changedAt = machine.state.changedAt;
    for (let t = 80; t < 1000; t += 30) machine.update(good("A2", t));
    expect(machine.state.changedAt).toBe(changedAt);
  });
});

describe("hold and release", () => {
  it("does not clear the display the instant the signal stops", () => {
    const machine = new PitchStateMachine({ minStableMs: 10, holdMs: 600 });
    machine.update(good("A2", 0));
    machine.update(good("A2", 40));
    expect(machine.state.state).toBe("stable");

    const held = machine.update(silent(100));
    expect(held.state).toBe("holding");
    expect(held.reading).not.toBeNull();
    expect(held.held).toBe(true);
  });

  it("clears only after the hold window expires", () => {
    const machine = new PitchStateMachine({ minStableMs: 10, holdMs: 500 });
    machine.update(good("A2", 0));
    machine.update(good("A2", 40));
    expect(machine.update(silent(300)).state).toBe("holding");
    expect(machine.update(silent(500)).state).toBe("holding");
    const gone = machine.update(silent(600));
    expect(gone.state).toBe("no_signal");
    expect(gone.reading).toBeNull();
  });

  it("resumes seamlessly if the note comes back during the hold", () => {
    const machine = new PitchStateMachine({ minStableMs: 10, holdMs: 600 });
    machine.update(good("A2", 0));
    machine.update(good("A2", 40));
    const changedAt = machine.state.changedAt;

    machine.update(silent(100));
    machine.update(silent(200));
    const resumed = machine.update(good("A2", 300));
    expect(resumed.state).toBe("stable");
    expect(resumed.held).toBe(false);
    // Same note, so nothing "changed" — no animation should fire.
    expect(resumed.changedAt).toBe(changedAt);
  });

  it("survives a short note that decays quickly", () => {
    const machine = new PitchStateMachine({ minStableMs: 40, holdMs: 500 });
    machine.update(good("A2", 0));
    machine.update(good("A2", 50));
    expect(machine.state.state).toBe("stable");
    // Note dies almost immediately after being plucked.
    expect(machine.update(silent(120)).state).toBe("holding");
    expect(machine.state.reading!.note.name).toBe("A");
  });
});

describe("switching notes", () => {
  it("requires evidence before replacing a displayed note", () => {
    const machine = new PitchStateMachine({ minStableMs: 10, switchMs: 120 });
    machine.update(good("A2", 0));
    machine.update(good("A2", 40));

    // A different note arrives but has not earned the display yet.
    expect(machine.update(good("C3", 60)).midi).toBe(reading("A2").note.midi);
    expect(machine.update(good("C3", 120)).midi).toBe(reading("A2").note.midi);
    expect(machine.update(good("C3", 200)).midi).toBe(reading("C3").note.midi);
  });

  it("keeps showing the old note while deciding, rather than blanking", () => {
    const machine = new PitchStateMachine({ minStableMs: 10, switchMs: 200 });
    machine.update(good("A2", 0));
    machine.update(good("A2", 40));
    const mid = machine.update(good("C3", 60));
    expect(mid.state).toBe("stable");
    expect(mid.reading!.note.name).toBe("A");
  });

  it("is not derailed by a single stray frame during a sustain", () => {
    const machine = new PitchStateMachine({ minStableMs: 10, switchMs: 120 });
    machine.update(good("A2", 0));
    machine.update(good("A2", 40));
    machine.update(good("F3", 70)); // glitch
    machine.update(good("A2", 100));
    machine.update(good("A2", 140));
    expect(machine.state.midi).toBe(reading("A2").note.midi);
  });

  it("marks the change timestamp when it does switch", () => {
    const machine = new PitchStateMachine({ minStableMs: 10, switchMs: 60 });
    machine.update(good("A2", 0));
    machine.update(good("A2", 40));
    machine.update(good("C3", 100));
    const switched = machine.update(good("C3", 200));
    expect(switched.changedAt).toBe(200);
  });
});

describe("hysteresis", () => {
  it("holds a displayed note at a confidence that would never have started it", () => {
    const machine = new PitchStateMachine({
      minStableMs: 10,
      activateConfidence: 0.7,
      releaseConfidence: 0.3,
    });
    machine.update(good("A2", 0, 0.9));
    machine.update(good("A2", 40, 0.9));
    expect(machine.state.state).toBe("stable");

    const marginal = machine.update(good("A2", 80, 0.45));
    expect(marginal.state).toBe("stable");
  });

  it("does not oscillate on a signal sitting near the boundary", () => {
    const machine = new PitchStateMachine({
      minStableMs: 10,
      activateConfidence: 0.7,
      releaseConfidence: 0.3,
    });
    machine.update(good("A2", 0, 0.9));
    machine.update(good("A2", 40, 0.9));

    const states: string[] = [];
    for (let t = 80; t < 1200; t += 30) {
      states.push(machine.update(good("A2", t, t % 60 === 0 ? 0.5 : 0.35)).state);
    }
    expect(new Set(states)).toEqual(new Set(["stable"]));
  });
});

describe("reset", () => {
  it("clears everything", () => {
    const machine = new PitchStateMachine({ minStableMs: 10 });
    machine.update(good("A2", 0));
    machine.update(good("A2", 40));
    machine.reset();
    expect(machine.state.state).toBe("no_signal");
    expect(machine.state.midi).toBeNull();
  });
});
