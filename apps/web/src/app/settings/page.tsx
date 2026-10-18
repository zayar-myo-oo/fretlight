"use client";

import { INSTRUMENTS, getInstrument, tuningsFor } from "@fretlight/core";
import { SoundMenu } from "@/components/fretboard/SoundMenu";
import { LanguageSwitch } from "@/components/layout/LanguageSwitch";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useMounted } from "@/hooks/useMounted";
import { useTx } from "@/lib/i18n/locale";
import { cn } from "@/lib/ui/cn";
import { type NoteLabelMode, useSession } from "@/store/session";

/** Everything that applies app-wide, in one place instead of scattered across tools. */
export default function SettingsPage() {
  const x = useTx();
  const mounted = useMounted();
  const instrumentId = useSession((s) => s.instrumentId);
  const tuningId = useSession((s) => s.tuningId);
  const setInstrument = useSession((s) => s.setInstrument);
  const setTuning = useSession((s) => s.setTuning);
  const labelMode = useSession((s) => s.labelMode);
  const setLabelMode = useSession((s) => s.setLabelMode);
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);
  const chime = useSession((s) => s.tunerChimeEnabled);
  const patch = useSession((s) => s.patch);
  const instrument = getInstrument(instrumentId);
  const tunings = instrument ? tuningsFor(instrument.kind, instrument.stringCount) : [];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{x("Settings")}</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
          {x("Choose your instrument, tuning and sound. Settings stay on this device.")}
        </p>
      </header>

      <Panel title={x("Instrument and tuning")}>
        <div className="grid gap-2 sm:grid-cols-2">
          {INSTRUMENTS.map((option) => {
            const active = mounted && option.id === instrumentId;
            return (
              <button
                key={option.id}
                onClick={() => setInstrument(option.id)}
                aria-pressed={active}
                className={cn(
                  "flex min-h-11 items-center justify-between rounded-xl border px-3.5 py-2.5 text-left",
                  active ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.08)]" : "border-[var(--color-hairline)] bg-[var(--color-void)] hover:border-[var(--color-hairline-bright)]",
                )}
              >
                <span className="text-sm font-medium">{option.name}</span>
                <span className="readout text-[10px] text-[var(--color-ink-faint)]">{option.stringCount}</span>
              </button>
            );
          })}
        </div>
        {mounted && tunings.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-hairline)] pt-4">
            {tunings.map((tuning) => (
              <button
                key={tuning.id}
                onClick={() => setTuning(tuning.id)}
                aria-pressed={tuning.id === tuningId}
                className={cn(
                  "flex min-h-11 flex-col items-start justify-center rounded-xl border px-3 py-1.5",
                  tuning.id === tuningId ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)]" : "border-[var(--color-hairline)] hover:border-[var(--color-hairline-bright)]",
                )}
              >
                <span className="text-xs font-medium">{tuning.name}</span>
                <span className="readout text-[10px] text-[var(--color-ink-faint)]">{tuning.strings.join(" ")}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={x("Display")}>
        <div className="flex flex-col gap-4">
          <Row label={x("Language")}>
            <LanguageSwitch />
          </Row>
          {mounted && (
            <>
              <Row label={x("Fretboard labels")}>
                <SegmentedControl<NoteLabelMode>
                  size="sm"
                  options={[
                    { value: "note", label: x("Note names") },
                    { value: "degree", label: x("Scale degrees") },
                    { value: "interval", label: x("Intervals") },
                  ]}
                  value={labelMode}
                  onChange={setLabelMode}
                />
              </Row>
              <Row label={x("Fretboard orientation")}>
                <SegmentedControl
                  size="sm"
                  options={[
                    { value: "low-bottom", label: x("Low string at the bottom") },
                    { value: "low-top", label: x("Low string on top") },
                  ]}
                  value={lowStringOnTop ? "low-top" : "low-bottom"}
                  onChange={(v) => patch({ lowStringOnTop: v === "low-top" })}
                />
              </Row>
              <Row label={x("Tuner chime when in tune")}>
                <input type="checkbox" checked={chime} onChange={(e) => patch({ tunerChimeEnabled: e.target.checked })} className="h-5 w-5 accent-[var(--color-signal)]" />
              </Row>
            </>
          )}
        </div>
      </Panel>

      <Panel title={x("Sound")}>
        <p className="mb-3 text-sm text-[var(--color-ink-dim)]">{x("The sound used when you tap a note or press Play.")}</p>
        <div className="flex justify-start">
          <SoundMenu />
        </div>
      </Panel>


    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm text-[var(--color-ink-dim)]">{label}</span>
      {children}
    </div>
  );
}
