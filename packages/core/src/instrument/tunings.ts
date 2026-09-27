import { noteToMidi } from "../theory/pitch";

export type InstrumentKind = "guitar" | "bass";

export interface TuningDefinition {
  readonly id: string;
  readonly name: string;
  readonly instrument: InstrumentKind;
  readonly stringCount: number;
  /** Note names from lowest-pitched string to highest, e.g. bass 4: E1 A1 D2 G2. */
  readonly strings: readonly string[];
  readonly isStandard?: boolean;
}

export const TUNINGS: readonly TuningDefinition[] = [
  // ---- Guitar ----
  { id: "guitar-6-standard",  name: "Standard",          instrument: "guitar", stringCount: 6, strings: ["E2", "A2", "D3", "G3", "B3", "E4"], isStandard: true },
  { id: "guitar-6-drop-d",    name: "Drop D",            instrument: "guitar", stringCount: 6, strings: ["D2", "A2", "D3", "G3", "B3", "E4"] },
  { id: "guitar-6-eb",        name: "Eb Standard",       instrument: "guitar", stringCount: 6, strings: ["Eb2", "Ab2", "Db3", "Gb3", "Bb3", "Eb4"] },
  { id: "guitar-6-d-standard",name: "D Standard",        instrument: "guitar", stringCount: 6, strings: ["D2", "G2", "C3", "F3", "A3", "D4"] },
  { id: "guitar-6-dadgad",    name: "DADGAD",            instrument: "guitar", stringCount: 6, strings: ["D2", "A2", "D3", "G3", "A3", "D4"] },
  { id: "guitar-6-open-g",    name: "Open G",            instrument: "guitar", stringCount: 6, strings: ["D2", "G2", "D3", "G3", "B3", "D4"] },
  { id: "guitar-7-standard",  name: "7-String Standard", instrument: "guitar", stringCount: 7, strings: ["B1", "E2", "A2", "D3", "G3", "B3", "E4"], isStandard: true },
  { id: "guitar-7-drop-a",    name: "7-String Drop A",   instrument: "guitar", stringCount: 7, strings: ["A1", "E2", "A2", "D3", "G3", "B3", "E4"] },

  // ---- Bass ----
  { id: "bass-4-standard",    name: "Standard",          instrument: "bass",   stringCount: 4, strings: ["E1", "A1", "D2", "G2"], isStandard: true },
  { id: "bass-4-drop-d",      name: "Drop D",            instrument: "bass",   stringCount: 4, strings: ["D1", "A1", "D2", "G2"] },
  { id: "bass-4-eb",          name: "Eb Standard",       instrument: "bass",   stringCount: 4, strings: ["Eb1", "Ab1", "Db2", "Gb2"] },
  { id: "bass-5-standard",    name: "5-String Standard", instrument: "bass",   stringCount: 5, strings: ["B0", "E1", "A1", "D2", "G2"], isStandard: true },
  { id: "bass-5-high-c",      name: "5-String High C",   instrument: "bass",   stringCount: 5, strings: ["E1", "A1", "D2", "G2", "C3"] },
  { id: "bass-6-standard",    name: "6-String Standard", instrument: "bass",   stringCount: 6, strings: ["B0", "E1", "A1", "D2", "G2", "C3"], isStandard: true },
];

export const TUNINGS_BY_ID: ReadonlyMap<string, TuningDefinition> = new Map(
  TUNINGS.map((t) => [t.id, t]),
);

export function getTuning(id: string): TuningDefinition | null {
  return TUNINGS_BY_ID.get(id) ?? null;
}

export function tuningsFor(instrument: InstrumentKind, stringCount?: number): TuningDefinition[] {
  return TUNINGS.filter(
    (t) => t.instrument === instrument && (stringCount === undefined || t.stringCount === stringCount),
  );
}

export function defaultTuning(instrument: InstrumentKind, stringCount: number): TuningDefinition {
  const candidates = tuningsFor(instrument, stringCount);
  return candidates.find((t) => t.isStandard) ?? candidates[0] ?? TUNINGS[0]!;
}

/** Open-string MIDI numbers, lowest string first. */
export function tuningMidi(tuning: TuningDefinition): number[] {
  return tuning.strings.map((name) => {
    const midi = noteToMidi(name);
    if (midi === null) throw new Error(`Invalid string note "${name}" in tuning ${tuning.id}`);
    return midi;
  });
}
