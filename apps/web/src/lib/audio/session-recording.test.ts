import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFretboard, getTuning } from "@fretlight/core";
import { sharedInput, type InputSession } from "./shared-input";
import { captureEvents, SessionRecorder, listSessions, deleteSession, eventAt, type DetectionEvent } from "./session-recording";
import { detectionMarkers } from "./detection-markers";
const board = createFretboard(getTuning("guitar-6-standard")!, 22);
class Recorder extends EventTarget {
  static isTypeSupported = (type: string) => type === "audio/mp4";
  state = "inactive"; mimeType = "audio/mp4";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void; onerror?: () => void;
  static last: Recorder;
  constructor(readonly stream: MediaStream) { super(); Recorder.last = this; }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(["recorded"], { type: this.mimeType }) }); this.onstop?.(); }); }
}
afterEach(() => { sharedInput.current = null; vi.unstubAllGlobals(); });
describe("recorded session synchronization", () => {
  it("records the exact shared stream, stores the final chunk and rebases events", async () => {
    vi.stubGlobal("MediaRecorder", Recorder);
    const context = { state: "running", currentTime: 10, sampleRate: 44100 };
    const stream = { getAudioTracks: () => [{ label: "USB", getSettings: () => ({ sampleRate: 44100 }) }] };
    sharedInput.current = { stream, context } as unknown as InputSession;
    const recorder = new SessionRecorder(); recorder.start(board);
    expect(Recorder.last.stream).toBe(stream);
    captureEvents.push(9, { kind: "note", midi: 40, frequency: 82.4, confidence: 1 });
    captureEvents.push(10.2, { kind: "note", midi: 40, frequency: 82.4, confidence: 1 });
    captureEvents.push(10.3, { kind: "note", midi: 40, frequency: 82.5, confidence: 1 });
    captureEvents.push(10.5, { kind: "note", midi: null, frequency: null, confidence: 0 });
    context.currentTime = 11;
    const saved = await recorder.stop();
    expect(saved!.duration).toBe(1); expect(saved!.audio.size).toBe(8); expect(saved!.events).toHaveLength(2);
    expect(saved!.events[0]!.at).toBeCloseTo(.2);
    expect((await listSessions()).some((s) => s.id === saved!.id)).toBe(true);
    await deleteSession(saved!.id); expect((await listSessions()).some((s) => s.id === saved!.id)).toBe(false);
  });
  it("seeking backwards and into release events does not leave stale notes", () => {
    const events: DetectionEvent[] = [{ at: .2, kind: "note", midi: 40, frequency: 82.4, confidence: 1 }, { at: .7, kind: "note", midi: null, frequency: null, confidence: 0 }];
    expect(eventAt(events, .2 - 0.0000004)).toBe(events[0]);
    expect(eventAt(events, .8)).toBe(events[1]); expect(eventAt(events, .3)).toBe(events[0]); expect(eventAt(events, 0)).toBeNull();
  });
  it("surfaces synchronous recorder startup failures", () => {
    class BrokenRecorder extends Recorder { override start() { throw new Error("Encoder unavailable"); } }
    vi.stubGlobal("MediaRecorder", BrokenRecorder);
    sharedInput.current = { context: { state: "running", currentTime: 0, sampleRate: 48000 }, stream: { getAudioTracks: () => [] } } as unknown as InputSession;
    const recorder = new SessionRecorder(); recorder.start(board);
    expect(recorder.getSnapshot().recording).toBe(false);
    expect(recorder.getSnapshot().error).toContain("Encoder unavailable");
  });
  it("requires a running captured input", () => { expect(() => new SessionRecorder().start(board)).toThrow("Connect or resume"); });
  it("maps note octaves separately from chord pitch classes within frets 0–12", () => {
    const markers = detectionMarkers(board, { kind: "note", midi: 40, frequency: 82.4, confidence: 1 });
    expect(markers).toEqual([{ string: 0, fret: 0, label: "E2", tone: "live" }]);
    const higher = detectionMarkers(board, { kind: "note", midi: 64, frequency: 329.6, confidence: 1 });
    expect(higher.length).toBeGreaterThan(1); expect(higher.every((m) => m.fret <= 12 && board.openMidi[m.string]! + m.fret === 64)).toBe(true);
    const chord = detectionMarkers(board, { kind: "chord", chord: { root: 9, rootName: "A", symbol: "Am", chordId: "minor", confidence: 1 }, notes: [9, 0, 4] });
    expect(chord.length).toBeGreaterThan(6); expect(chord.every((m) => [9, 0, 4].includes((board.openMidi[m.string]! + m.fret) % 12))).toBe(true);
  });
});
