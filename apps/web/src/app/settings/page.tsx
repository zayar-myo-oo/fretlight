"use client";

import { INSTRUMENTS, getInstrument, tuningsFor } from "@fretlight/core";
import { useState } from "react";
import { SoundMenu } from "@/components/fretboard/SoundMenu";
import { LanguageSwitch } from "@/components/layout/LanguageSwitch";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useMounted } from "@/hooks/useMounted";
import { useTx } from "@/lib/i18n/locale";
import { clearSession } from "@/lib/looper/session-store";
import { cn } from "@/lib/ui/cn";
import { useProgress } from "@/store/progress";
import { type NoteLabelMode, useSession } from "@/store/session";
import { useWeakAreas } from "@/store/weak-areas";

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
  const clearProgress = useProgress((s) => s.clear);
  const clearWeak = useWeakAreas((s) => s.clear);
  const [confirm, setConfirm] = useState<null | "progress" | "looper" | "ideas">(null);
  const [done, setDone] = useState<string | null>(null);

  const instrument = getInstrument(instrumentId);
  const tunings = instrument ? tuningsFor(instrument.kind, instrument.stringCount) : [];

  const wipe = async (what: "progress" | "looper" | "ideas") => {
    if (what === "progress") {
      clearProgress();
      clearWeak();
    } else if (what === "looper") {
      await clearSession();
    } else {
      try {
        localStorage.removeItem("fretlight.companion.ideas");
      } catch {
        // nothing stored
      }
    }
    setConfirm(null);
    setDone(x("Deleted from this device."));
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{x("Settings")}</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
          {x("These apply everywhere: Tuner, Fretboard, Companion, Looper and Practice. Everything is stored on this device only.")}
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

      <Panel title={x("Your data")}>
        <p className="mb-3 text-sm text-[var(--color-ink-dim)]">
          {x("Practice history, saved ideas and your last loop are kept in this browser. Nothing is uploaded. Deleting cannot be undone.")}
        </p>
        <div className="flex flex-col gap-2">
          {(
            [
              ["progress", x("Practice history and weak spots")],
              ["ideas", x("Saved Companion ideas")],
              ["looper", x("Saved loop")],
            ] as const
          ).map(([id, label]) => (
            <div key={id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-hairline)] px-3 py-2">
              <span className="text-sm">{label}</span>
              {confirm === id ? (
                <span className="flex gap-2">
                  <Button size="sm" variant="danger" onClick={() => void wipe(id)}>
                    {x("Yes, delete")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                    {x("Keep")}
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => { setDone(null); setConfirm(id); }}>
                  {x("Delete")}
                </Button>
              )}
            </div>
          ))}
          {done && <p role="status" className="text-sm text-[#39e08b]">✓ {done}</p>}
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
