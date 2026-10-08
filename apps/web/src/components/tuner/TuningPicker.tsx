"use client";

import { CUSTOM_TUNING_ID, INSTRUMENTS, type TuningCategory, tuningsFor } from "@fretlight/core";
import { CustomTuningEditor } from "@/components/tuner/CustomTuningEditor";
import { useMounted } from "@/hooks/useMounted";
import { useSession } from "@/store/session";
import { cn } from "@/lib/ui/cn";

const CATEGORY_ORDER: readonly TuningCategory[] = ["standard", "drop", "open"];
const CATEGORY_LABELS: Record<TuningCategory, string> = {
  standard: "Standard",
  drop: "Drop",
  open: "Open",
  custom: "Custom",
};

/**
 * Instrument + tuning picker for the tuner itself.
 *
 * Standard tuning stays the default for every instrument (`isStandard` on the
 * definition) — this only ever changes what a deliberate tap chooses. Drop D
 * is opt-in, never forced, and "Custom" hands the player every string
 * individually rather than trying to guess every tuning anyone might want.
 */
export function TuningPicker() {
  const mounted = useMounted();
  const instrumentId = useSession((s) => s.instrumentId);
  const tuningId = useSession((s) => s.tuningId);
  const setInstrument = useSession((s) => s.setInstrument);
  const setTuning = useSession((s) => s.setTuning);

  const instrument = INSTRUMENTS.find((option) => option.id === instrumentId);
  const tunings = instrument ? tuningsFor(instrument.kind, instrument.stringCount) : [];
  const isCustom = tuningId === CUSTOM_TUNING_ID;

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    tunings: tunings.filter((t) => (t.category ?? "standard") === category),
  })).filter((group) => group.tunings.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {INSTRUMENTS.map((option) => {
          const active = mounted && option.id === instrumentId;
          return (
            <button
              key={option.id}
              onClick={() => setInstrument(option.id)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2 text-left transition-all",
                active
                  ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)]"
                  : "border-[var(--color-hairline)] hover:border-[var(--color-hairline-bright)]",
              )}
            >
              <span className="text-xs font-medium">{option.name}</span>
              <span className="readout text-[10px] text-[var(--color-ink-faint)]">
                {option.stringCount} str
              </span>
            </button>
          );
        })}
      </div>

      {mounted && instrument && (
        <div className="flex flex-col gap-3">
          {grouped.map((group) => (
            <div key={group.category}>
              <span className="hud-label mb-2 block">{CATEGORY_LABELS[group.category]}</span>
              <div className="flex flex-wrap gap-2">
                {group.tunings.map((tuning) => {
                  const active = tuning.id === tuningId;
                  return (
                    <button
                      key={tuning.id}
                      title={tuning.note}
                      onClick={() => setTuning(tuning.id)}
                      className={cn(
                        "flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2 text-left transition-all",
                        active
                          ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)]"
                          : "border-[var(--color-hairline)] hover:border-[var(--color-hairline-bright)]",
                      )}
                    >
                      <span className="text-xs font-medium">{tuning.name}</span>
                      <span className="readout text-[10px] text-[var(--color-ink-faint)]">
                        {tuning.strings.join(" ")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <span className="hud-label mb-2 block">{CATEGORY_LABELS.custom}</span>
            <button
              onClick={() => setTuning(CUSTOM_TUNING_ID)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2 text-left transition-all",
                isCustom
                  ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)]"
                  : "border-[var(--color-hairline)] hover:border-[var(--color-hairline-bright)]",
              )}
            >
              <span className="text-xs font-medium">Custom</span>
              <span className="readout text-[10px] text-[var(--color-ink-faint)]">set every string yourself</span>
            </button>

            {isCustom && <CustomTuningEditor instrumentId={instrumentId} className="mt-3" />}
          </div>
        </div>
      )}
    </div>
  );
}
