"use client";
import type { ChordMatch, Fretboard } from "@fretlight/core";
import { sharedInput, type InputSession } from "./shared-input";

export type DetectionValue =
  | { kind: "note"; midi: number | null; frequency: number | null; confidence: number }
  | { kind: "chord"; chord: ChordMatch | null; notes: readonly number[] };
export type DetectionEvent = DetectionValue & { at: number };
const subscribers = new Set<(time: number, value: DetectionValue) => void>();
export const captureEvents = {
  // A failing subscriber must never break the detector, nor one detector the recorder.
  push(time: number, value: DetectionValue) { for (const fn of subscribers) { try { fn(time, value); } catch { /* isolated */ } } },
  subscribe(fn: (time: number, value: DetectionValue) => void) { subscribers.add(fn); return () => { subscribers.delete(fn); }; },
};
export interface RecordedSession {
  version: 1;
  id: string;
  createdAt: string;
  duration: number;
  sampleRate: number;
  deviceLabel: string;
  trackSettings: MediaTrackSettings;
  board: Fretboard;
  events: DetectionEvent[];
  audio: Blob;
  /** Events represent detection decision times, shifted back by `latency` to approximate acoustic onset. */
  timing: "audio-context-decision-time";
  /** Seconds subtracted from decision times: analysis window per kind (estimated, not measured). */
  latency?: { note: number; chord: number };
  /** Requested take length, seconds. */
  limit?: number;
  stopReason: string;
}
export interface RecorderState { recording: boolean; saving: boolean; error: string | null; latest: RecordedSession | null }
const EMPTY: RecorderState = { recording: false, saving: false, error: null, latest: null };

export function eventAt(events: readonly DetectionEvent[], seconds: number): DetectionEvent | null {
  // Binary search also handles backwards seeks and playback-rate changes.
  let low = 0, high = events.length;
  while (low < high) { const mid = (low + high) >>> 1; if (events[mid]!.at <= seconds + 1e-6) low = mid + 1; else high = mid; }
  return low ? events[low - 1]! : null;
}

export function recordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") throw new Error("Recording is unavailable in this browser.");
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
}

export class SessionRecorder {
  private state: RecorderState = EMPTY;
  private listeners = new Set<() => void>();
  private recorder: MediaRecorder | null = null;
  private completion: Promise<RecordedSession> | null = null;
  private reason = "Stopped by player";
  private input: InputSession | null = null;
  private endTime: number | null = null;
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private patch(value: Partial<RecorderState>) { this.state = { ...this.state, ...value }; for (const fn of this.listeners) fn(); }

  start(board: Fretboard, limitSeconds = 30): void {
    if (this.recorder || this.state.saving) throw new Error("A recording is already being saved.");
    const input = sharedInput.current;
    if (!input || input.context.state !== "running") throw new Error("Connect or resume an input before recording.");
    const mimeType = recordingMimeType();
    const recorder = new MediaRecorder(input.stream, mimeType ? { mimeType } : undefined);
    // Re-anchored in onstart: MediaRecorder takes a moment to begin capturing.
    let origin = input.context.currentTime;
    // The YIN frame and the chord FFT window each lag the sound they describe.
    const latency = { note: 0.05, chord: Math.round((input.context.sampleRate > 48000 ? 16384 : 8192) / input.context.sampleRate / 2 * 1000) / 1000 };
    const events: DetectionEvent[] = [];
    const chunks: Blob[] = [];
    let bytes = 0, duration = 0, failure: string | null = null;
    this.reason = "Stopped by player";
    this.input = input;
    this.endTime = null;
    this.recorder = recorder;
    const track = input.stream.getAudioTracks()[0];
    const metadata = { version: 1 as const, id: crypto.randomUUID(), createdAt: new Date().toISOString(), sampleRate: input.context.sampleRate, deviceLabel: track?.label || "Audio input", trackSettings: track?.getSettings() ?? {}, board: structuredClone(board), timing: "audio-context-decision-time" as const, latency, limit: limitSeconds };
    // Per kind: notes and chords interleave, and a shared key would log every flip.
    const lastKey = { note: "", chord: "" };
    const unEvents = captureEvents.subscribe((time, value) => {
      const at = time - origin - latency[value.kind];
      if (recorder.state !== "recording") return;
      // Spectral note sets wobble frame to frame; only the chord name defines an event.
      const key = value.kind === "note" ? `${value.midi}` : `${value.chord?.symbol ?? ""}`;
      if (key === lastKey[value.kind]) return;
      lastKey[value.kind] = key;
      events.push({ ...value, at: Math.max(0, events.at(-1)?.at ?? 0, at) });
    });
    const unInput = sharedInput.subscribe(() => {
      if (sharedInput.current !== input || input.context.state !== "running") {
        void this.stop("Input changed, disconnected or interrupted").catch(() => {});
      }
    });
    const limit = setTimeout(() => { void this.stop(`${limitSeconds}-second take complete`).catch(() => {}); }, limitSeconds * 1000 + 150);
    this.completion = new Promise<RecordedSession>((resolve, reject) => {
      const cleanup = () => { clearTimeout(limit); unEvents(); unInput(); this.recorder = null; this.input = null; };
      recorder.ondataavailable = ({ data }) => {
        if (data.size) { chunks.push(data); bytes += data.size; }
        if (bytes > 32 * 1024 * 1024) void this.stop("Recording size limit reached").catch(() => {});
      };
      recorder.onerror = () => { failure = "The browser interrupted recording. The available audio was retained."; void this.stop("Recorder error").catch(() => {}); };
      recorder.onstop = () => {
        duration = Math.max(0, (this.endTime ?? input.context.currentTime) - origin);
        cleanup();
        const audio = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "application/octet-stream" });
        if (!audio.size) {
          const error = new Error("The browser produced no recorded audio.");
          this.patch({ recording: false, saving: false, error: error.message }); reject(error); return;
        }
        const session: RecordedSession = { ...metadata, duration, events: events.filter((event) => event.at <= duration), audio, stopReason: this.reason };
        this.patch({ recording: false, saving: true, latest: session, error: failure });
        saveSession(session).then(() => { this.patch({ saving: false }); resolve(session); }).catch(() => {
          this.patch({ saving: false, error: "Browser storage is unavailable or full. Export this take before leaving the page." });
          resolve(session);
        });
      };
      recorder.onstart = () => { origin = input.context.currentTime; };
      try { recorder.start(250); } catch (error) { cleanup(); this.patch({ recording: false, saving: false, error: String(error) }); reject(error); }

    });
    void this.completion.catch(() => {});
    if (recorder.state === "recording") this.patch({ recording: true, error: null });
  }

  forget(id: string) { if (this.state.latest?.id === id) this.patch({ latest: null }); }

  stop(reason = "Stopped by player"): Promise<RecordedSession | null> {
    if (this.recorder?.state === "recording") { this.reason = reason; this.endTime = this.input?.context.currentTime ?? null; this.patch({ recording: false, saving: true }); this.recorder.stop(); }
    return this.completion ?? Promise.resolve(null);
  }
}
export const sessionRecorder = new SessionRecorder();
export const SERVER_RECORDER_STATE = EMPTY;

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("fretlight.recordings", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("sessions", { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Recording database is blocked by another tab."));
  });
}
export async function saveSession(session: RecordedSession): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite"); tx.objectStore("sessions").put(session);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
export async function listSessions(): Promise<RecordedSession[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction("sessions", "readonly").objectStore("sessions").getAll();
    request.onsuccess = () => { db.close(); resolve((request.result as RecordedSession[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt))); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
export async function deleteSession(id: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite"); tx.objectStore("sessions").delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export function exportEvents(session: RecordedSession) {
  const { audio, ...metadata } = session;
  downloadBlob(new Blob([JSON.stringify({ ...metadata, audioFile: `${session.id}.${audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm"}`, mimeType: audio.type }, null, 2)], { type: "application/json" }), `${session.id}.json`);
}
