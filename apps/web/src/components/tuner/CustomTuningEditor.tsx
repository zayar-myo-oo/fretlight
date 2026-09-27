"use client";

import { SHARP_NAMES, getInstrument, noteToMidi } from "@fretlight/core";
import { resolveTuning } from "@/lib/tuning/resolve-tuning";
import { useSession } from "@/store/session";
import { cn } from "@/lib/ui/cn";

/** Scientific-pitch octaves worth offering — covers everything from a low B0 bass string to a high guitar fret. */
const OCTAVES = [0, 1, 2, 3, 4, 5, 6];

/**
 * Per-string note pickers for the "Custom" tuning.
 *
 * Only rendered while Custom is the active tuning. Each string is a
 * (pitch class, octave) pair rather than free text, so every value this UI
 * can produce is guaranteed parseable — there is no "invalid note" state to
 * handle downstream.
 */
export function CustomTuningEditor({ instrumentId, className }: { instrumentId: string; className?: string }) {
  const customTunings = useSession((s) => s.customTunings);
  const setCustomTuningString = useSession((s) => s.setCustomTuningString);

  const instrument = getInstrument(instrumentId);
  if (!instrument) return null;

  const tuning = resolveTuning(instrumentId, "custom", customTunings);

  return (
    <div className={cn("flex flex-wrap gap-2.5", className)}>
      {tuning.strings.map((note, index) => {
        const midi = noteToMidi(note) ?? 40;
        const pitchClass = ((midi % 12) + 12) % 12;
        const octave = Math.floor(midi / 12) - 1;

        return (
          <div
            key={index}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-2.5"
          >
            <span className="hud-label">string {index + 1}</span>
            <div className="flex gap-1">
              <select
                aria-label={`String ${index + 1} note`}
                value={pitchClass}
                onChange={(event) =>
                  setCustomTuningString(instrumentId, index, `${SHARP_NAMES[Number(event.target.value)]}${octave}`)
                }
                className="h-8 rounded-lg border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-1.5 text-xs text-[var(--color-ink-dim)]"
              >
                {SHARP_NAMES.map((name, pc) => (
                  <option key={name} value={pc}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`String ${index + 1} octave`}
                value={octave}
                onChange={(event) =>
                  setCustomTuningString(instrumentId, index, `${SHARP_NAMES[pitchClass]}${event.target.value}`)
                }
                className="h-8 w-14 rounded-lg border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-1.5 text-xs text-[var(--color-ink-dim)]"
              >
                {OCTAVES.map((oct) => (
                  <option key={oct} value={oct}>
                    {oct}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
