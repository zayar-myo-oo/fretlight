"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { SOUND_PRESETS, fretSynth } from "@/lib/audio/fret-synth";
import { useTx } from "@/lib/i18n/locale";
import { useSession } from "@/store/session";

/** Pick what the app sounds like when you tap a fret or press Play, plus volume. */
export function SoundMenu() {
  const [open, setOpen] = useState(false);
  const x = useTx();

  // Re-render when the preset or volume changes, and when the instrument does
  // (the default sound follows it until you choose one yourself).
  useSession((s) => s.instrumentId);
  const version = useSyncExternalStore(
    fretSynth.subscribe,
    () => `${fretSynth.getChosen()}|${fretSynth.getVolume()}`,
    () => "",
  );
  const active = version ? fretSynth.getPreset() : null;
  const volume = version ? fretSynth.getVolume() : 0.7;
  const following = version ? fretSynth.getChosen() === null : true;

  return (
    <div className="flex flex-col items-end gap-2">
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {x("♪ Sound")}{active ? `: ${x(active.label)}` : ""} {open ? "▴" : "▾"}
      </Button>
      {open && (
        <div className="flex w-full min-w-[260px] flex-col gap-3 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3">
          <label className="flex flex-col gap-1.5">
            <span className="hud-label">{x("Instrument sound")}</span>
            <select
              value={following ? "auto" : (active?.id ?? "auto")}
              onChange={(e) => fretSynth.setPreset(e.target.value === "auto" ? null : e.target.value)}
              className="h-9 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-xs text-[var(--color-ink-dim)]"
            >
              <option value="auto">{x("Match my instrument")}</option>
              <optgroup label={x("Guitar")}>
                {SOUND_PRESETS.filter((p) => p.kind === "guitar").map((p) => (
                  <option key={p.id} value={p.id}>
                    {x(p.label)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={x("Bass")}>
                {SOUND_PRESETS.filter((p) => p.kind === "bass").map((p) => (
                  <option key={p.id} value={p.id}>
                    {x(p.label)}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="flex items-center gap-3">
            <span className="hud-label">{x("Volume")}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => fretSynth.setVolume(Number(e.target.value))}
              className="w-full accent-[var(--color-signal)]"
            />
          </label>
          <Button
            size="sm"
            onClick={() => {
              // A short phrase shows the sound off better than one note.
              const base = active?.kind === "bass" ? 40 : 52;
              [0, 4, 7, 12].forEach((step, i) => setTimeout(() => void fretSynth.pluck(base + step), i * 220));
            }}
          >
            {x("▶ Test sound")}
          </Button>
        </div>
      )}
    </div>
  );
}
