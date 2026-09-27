import {
  CUSTOM_TUNING_ID,
  type TuningDefinition,
  defaultTuning,
  getInstrument,
  getTuning,
} from "@fretlight/core";

/**
 * Turns the session's (instrumentId, tuningId) selection into an actual
 * `TuningDefinition` the fretboard/detector can use.
 *
 * Most of the time this is just a `TUNINGS` lookup. The one exception is
 * `CUSTOM_TUNING_ID`, which never lives in `TUNINGS` — it is built here from
 * whatever per-string notes the player has set for this instrument,
 * falling back to that instrument's standard tuning until they set any.
 */
export function resolveTuning(
  instrumentId: string,
  tuningId: string,
  customTunings: Readonly<Record<string, readonly string[]>>,
): TuningDefinition {
  const instrument = getInstrument(instrumentId) ?? getInstrument("bass-4")!;

  if (tuningId === CUSTOM_TUNING_ID) {
    const base = defaultTuning(instrument.kind, instrument.stringCount);
    const strings = customTunings[instrumentId] ?? base.strings;
    return {
      id: CUSTOM_TUNING_ID,
      name: "Custom",
      instrument: instrument.kind,
      stringCount: instrument.stringCount,
      strings,
      category: "custom",
    };
  }

  const tuning = getTuning(tuningId);
  return tuning && tuning.stringCount === instrument.stringCount
    ? tuning
    : defaultTuning(instrument.kind, instrument.stringCount);
}
