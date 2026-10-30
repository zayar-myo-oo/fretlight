import type { ChordMatch } from "@fretlight/core";
import type { PitchStateSlice } from "./detection-state";
import type { ChordFrame } from "./chord-listener";

export type LiveMode = "note" | "chord" | "auto";

export type LiveDecision =
  | { kind: "silent" }
  | { kind: "uncertain" }
  | { kind: "note"; midi: number; name: string; octave: number; frequency: number; cents: number | null; confidence: number }
  | { kind: "chord"; chord: ChordMatch; heard: readonly number[] };

/** Chord must hold this long before it replaces what's on screen. */
const CHORD_CONFIRM_MS = 150;
/** A different chord must hold longer than this to replace a displayed one. */
const CHORD_SWITCH_MS = 350;
/** Keep the last result through brief dropouts before clearing to silence. */
const HOLD_MS = 700;

/**
 * Turns the two existing detectors' outputs into one thing to show.
 * Pure and clock-driven so it can be reasoned about (and tested) without audio.
 */
export class LiveInterpreter {
  private shown: LiveDecision = { kind: "silent" };
  private shownAt = 0;
  private pending: { symbol: string; since: number } | null = null;
  private lastEvidence = 0;

  reset(): void {
    this.shown = { kind: "silent" };
    this.pending = null;
  }

  update(now: number, mode: LiveMode, pitch: PitchStateSlice, frame: ChordFrame | null): LiveDecision {
    const noteStable = pitch.display === "stable" && pitch.midi !== null && pitch.frequency !== null;
    const note: LiveDecision | null = noteStable
      ? { kind: "note", midi: pitch.midi!, name: pitch.noteName ?? "", octave: pitch.octave ?? 0, frequency: pitch.frequency!, cents: pitch.cents, confidence: pitch.confidence }
      : null;
    const chord = mode === "note" ? null : this.smoothChord(now, frame);
    const active = noteStable || pitch.display === "detecting" || pitch.display === "holding" || !!frame?.active;

    let next: LiveDecision | null;
    if (mode === "note") next = note;
    else if (mode === "chord") next = chord;
    // Auto: a chord needs ≥3 heard pitch classes so a single ringing note
    // (root + harmonics) is never promoted to a power chord.
    else next = chord && (frame?.notes.length ?? 0) >= 3 ? chord : note ?? chord;

    if (next) {
      this.lastEvidence = now;
      return this.show(next, now);
    }
    if (now - this.lastEvidence < HOLD_MS && this.shown.kind !== "silent") return this.shown;
    return this.show(active ? { kind: "uncertain" } : { kind: "silent" }, now);
  }

  private smoothChord(now: number, frame: ChordFrame | null): LiveDecision | null {
    const c = frame?.chord;
    if (!c) { this.pending = null; return null; }
    const shown = this.shown.kind === "chord" ? this.shown.chord.symbol : null;
    if (c.symbol === shown) { this.pending = null; return { kind: "chord", chord: c, heard: frame!.notes }; }
    if (this.pending?.symbol !== c.symbol) this.pending = { symbol: c.symbol, since: now };
    const need = shown ? CHORD_SWITCH_MS : CHORD_CONFIRM_MS;
    if (now - this.pending.since >= need) return { kind: "chord", chord: c, heard: frame!.notes };
    // Not yet confirmed: keep showing the current chord if there is one.
    return this.shown.kind === "chord" ? this.shown : null;
  }

  private show(next: LiveDecision, now: number): LiveDecision {
    if (!sameDecision(this.shown, next)) this.shownAt = now;
    this.shown = next;
    return next;
  }

  get since(): number { return this.shownAt; }
}

export function decisionLabel(d: LiveDecision): string | null {
  if (d.kind === "note") return `${d.name}${d.octave}`;
  if (d.kind === "chord") return d.chord.symbol || d.chord.rootName;
  return null;
}

export function sameDecision(a: LiveDecision, b: LiveDecision): boolean {
  return a.kind === b.kind && decisionLabel(a) === decisionLabel(b);
}

// --- History ---------------------------------------------------------------

/** `at` is seconds from listening start — the same clock Phase 3 recordings will use. */
export interface LiveEvent {
  readonly id: number;
  readonly at: number;
  readonly kind: "note" | "chord";
  readonly label: string;
  readonly midi?: number;
  readonly chord?: ChordMatch;
  readonly confidence: number;
}

/** Below this, a flicker isn't logged as a separate event. */
const MIN_EVENT_MS = 120;

export class LiveHistory {
  private events: LiveEvent[] = [];
  private nextId = 1;
  private candidate: { label: string; since: number; decision: LiveDecision; logged: boolean } | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly limit = 100) {}

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = (): readonly LiveEvent[] => this.events;

  clear(): void { this.events = []; this.candidate = null; this.emit(); }

  /** Feed every decision; only stable, non-repeating ones become events. */
  observe(decision: LiveDecision, nowMs: number, originMs: number): void {
    const label = decisionLabel(decision);
    if (!label) { this.candidate = null; return; }
    // Same label held continuously is one event; re-played after a gap is a new one.
    if (this.candidate?.label !== label) { this.candidate = { label, since: nowMs, decision, logged: false }; return; }
    if (this.candidate.logged || nowMs - this.candidate.since < MIN_EVENT_MS) return;
    this.candidate.logged = true;
    const d = this.candidate.decision;
    const event: LiveEvent = {
      id: this.nextId++,
      at: Math.max(0, (this.candidate.since - originMs) / 1000),
      kind: d.kind === "chord" ? "chord" : "note",
      label,
      ...(d.kind === "note" ? { midi: d.midi, confidence: d.confidence } : {}),
      ...(d.kind === "chord" ? { chord: d.chord, confidence: d.chord.confidence } : {}),
    } as LiveEvent;
    this.events = [...this.events, event].slice(-this.limit);
    this.emit();
  }

  private emit() { for (const fn of this.listeners) fn(); }
}

export function formatEventTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}
