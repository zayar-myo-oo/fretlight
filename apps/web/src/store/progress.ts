"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PracticeRecord {
  readonly id: string;
  /** ISO date, so streaks survive timezone changes better than a raw timestamp. */
  readonly date: string;
  readonly exercise: string;
  readonly instrumentId: string;
  readonly bpm: number;
  readonly durationSeconds: number;
  readonly pitchAccuracy: number;
  readonly timingAccuracy: number;
  readonly overall: number;
  readonly notesCorrect: number;
  readonly notesTotal: number;
}

interface ProgressState {
  records: PracticeRecord[];
  addRecord: (record: Omit<PracticeRecord, "id" | "date">) => void;
  clear: () => void;
}

/**
 * Local practice history. Phase 1 keeps it entirely in localStorage — the app
 * has to be useful offline, and nothing here needs a server to be true.
 * A future sync layer can push these same records to Postgres.
 */
export const useProgress = create<ProgressState>()(
  persist(
    (set) => ({
      records: [],
      addRecord: (record) =>
        set((state) => ({
          records: [
            {
              ...record,
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              date: new Date().toISOString(),
            },
            ...state.records,
          ].slice(0, 500),
        })),
      clear: () => set({ records: [] }),
    }),
    { name: "fretlight.progress", version: 1 },
  ),
);

export interface ProgressSummary {
  readonly totalMinutes: number;
  readonly sessions: number;
  readonly averageAccuracy: number;
  readonly averagePitchAccuracy: number;
  readonly averageTimingAccuracy: number;
  readonly bestAccuracy: number;
  readonly streakDays: number;
  readonly bestBpm: number;
}

export type ProgressRange = "today" | "week" | "month" | "all";

/**
 * Records within a range, most recent first (records are already stored that
 * way). "Streak" is deliberately never computed from a filtered set — it is
 * a single running number, not something that resets when you change which
 * window you're looking at, so callers should always pass the *unfiltered*
 * history to `summarise()` when they need `streakDays`.
 */
export function filterRecordsByRange(
  records: readonly PracticeRecord[],
  range: ProgressRange,
): readonly PracticeRecord[] {
  if (range === "all") return records;
  const days = range === "today" ? 0 : range === "week" ? 6 : 29;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return records.filter((record) => new Date(record.date) >= cutoff);
}

export function summarise(records: readonly PracticeRecord[]): ProgressSummary {
  if (records.length === 0) {
    return {
      totalMinutes: 0,
      sessions: 0,
      averageAccuracy: 0,
      averagePitchAccuracy: 0,
      averageTimingAccuracy: 0,
      bestAccuracy: 0,
      streakDays: 0,
      bestBpm: 0,
    };
  }

  const totalSeconds = records.reduce((sum, r) => sum + r.durationSeconds, 0);
  const averageAccuracy = records.reduce((sum, r) => sum + r.overall, 0) / records.length;
  const averagePitchAccuracy = records.reduce((sum, r) => sum + r.pitchAccuracy, 0) / records.length;
  const averageTimingAccuracy = records.reduce((sum, r) => sum + r.timingAccuracy, 0) / records.length;

  // Streak: count back from today over the set of distinct practice days.
  const days = new Set(records.map((r) => r.date.slice(0, 10)));
  let streakDays = 0;
  const cursor = new Date();
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (days.has(key)) {
      streakDays++;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    // Practising has not happened *yet* today, but yesterday still counts.
    if (streakDays === 0 && key === new Date().toISOString().slice(0, 10)) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }

  return {
    totalMinutes: Math.round(totalSeconds / 60),
    sessions: records.length,
    averageAccuracy,
    averagePitchAccuracy,
    averageTimingAccuracy,
    bestAccuracy: Math.max(...records.map((r) => r.overall)),
    streakDays,
    bestBpm: Math.max(...records.map((r) => r.bpm)),
  };
}
