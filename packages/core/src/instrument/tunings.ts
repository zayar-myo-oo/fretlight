import { noteToMidi } from "../theory/pitch";

export type InstrumentKind = "guitar" | "bass";

/** Groups tunings in pickers so a long list stays scannable. */
export type TuningCategory = "standard" | "drop" | "open" | "custom";

export interface TuningDefinition {
  readonly id: string;
  readonly name: string;
  readonly instrument: InstrumentKind;
  readonly stringCount: number;
  /** Note names from lowest-pitched string to highest, e.g. bass 4: E1 A1 D2 G2. */
  readonly strings: readonly string[];
  readonly isStandard?: boolean;
  readonly category?: TuningCategory;
  /** Short context shown in pickers for a tuning tied to a particular style. */
  readonly note?: string;
}

export const TUNINGS: readonly TuningDefinition[] = [
  // ---- Guitar ----
  { id: "guitar-6-standard",  name: "Standard",          instrument: "guitar", stringCount: 6, strings: ["E2", "A2", "D3", "G3", "B3", "E4"], isStandard: true, category: "standard" },
  { id: "guitar-6-drop-d",    name: "Drop D",            instrument: "guitar", stringCount: 6, strings: ["D2", "A2", "D3", "G3", "B3", "E4"], category: "drop" },
  { id: "guitar-6-drop-c",    name: "Drop C",            instrument: "guitar", stringCount: 6, strings: ["C2", "G2", "C3", "F3", "A3", "D4"], category: "drop" },
  { id: "guitar-6-eb",        name: "Eb Standard (half step down)", instrument: "guitar", stringCount: 6, strings: ["D#2", "G#2", "C#3", "F#3", "A#3", "D#4"], category: "standard", note: "Everything a half step lower" },
  { id: "guitar-6-d",         name: "D Standard",        instrument: "guitar", stringCount: 6, strings: ["D2", "G2", "C3", "F3", "A3", "D4"], category: "standard", note: "Everything a whole step lower" },
  { id: "guitar-6-open-g",    name: "Open G",            instrument: "guitar", stringCount: 6, strings: ["D2", "G2", "D3", "G3", "B3", "D4"], category: "open", note: "Strum open for a G major chord" },
  { id: "guitar-6-open-d",    name: "Open D",            instrument: "guitar", stringCount: 6, strings: ["D2", "A2", "D3", "F#3", "A3", "D4"], category: "open", note: "Strum open for a D major chord" },
  { id: "guitar-7-standard",  name: "7-String Standard", instrument: "guitar", stringCount: 7, strings: ["B1", "E2", "A2", "D3", "G3", "B3", "E4"], isStandard: true, category: "standard" },

  // ---- Bass ----
  { id: "bass-4-standard",    name: "Standard",          instrument: "bass",   stringCount: 4, strings: ["E1", "A1", "D2", "G2"], isStandard: true, category: "standard" },
  { id: "bass-4-drop-d",      name: "Drop D",            instrument: "bass",   stringCount: 4, strings: ["D1", "A1", "D2", "G2"], category: "drop" },
  { id: "bass-5-standard",    name: "5-String Standard", instrument: "bass",   stringCount: 5, strings: ["B0", "E1", "A1", "D2", "G2"], isStandard: true, category: "standard" },
  { id: "bass-6-standard",    name: "6-String Standard", instrument: "bass",   stringCount: 6, strings: ["B0", "E1", "A1", "D2", "G2", "C3"], isStandard: true, category: "standard" },
];

/**
 * Reserved id for a user-defined tuning built at runtime from per-string
 * note choices, rather than looked up from `TUNINGS`. The app layer owns
 * constructing the actual `TuningDefinition` (it needs session state to do
 * so); this constant just lets both sides agree on the id.
 */
export const CUSTOM_TUNING_ID = "custom";

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
