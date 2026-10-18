"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { SOUND_PRESETS, fretSynth } from "@/lib/audio/fret-synth";
import { useTx } from "@/lib/i18n/locale";
import { useSession } from "@/store/session";
import { playEvents, stopCompanion } from "@/lib/audio/companion-player";

/** Pick what the app sounds like when you tap a fret or press Play, plus volume. */
export function SoundMenu() {
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(false);
  const preview = useRef(0);
  const activePreview = useRef(false);
  const x = useTx();

  useEffect(() => () => {
    preview.current++;
    if (activePreview.current) stopCompanion();
  }, []);

  const stopPreview = () => {
    preview.current++;
    if (activePreview.current) stopCompanion();
    activePreview.current = false;
    setTesting(false);
  };

  const testSound = async () => {
    if (testing) { stopPreview(); return; }
    const id = ++preview.current;
    activePreview.current = true;
    setTesting(true);
    setError(false);
    const preset = fretSynth.getPreset();
    const base = preset.kind === "bass" ? 40 : 52;
    try {
      await playEvents([0, 4, 7, 12].map((step, i) => ({ midi: base + step, at: i * 0.22, preset })), 1.8, () => {
        if (id !== preview.current) return;
        activePreview.current = false;
        setTesting(false);
      });
    } catch {
      if (id !== preview.current) return;
      stopPreview();
      setError(true);
    }
  };

  // Re-render when the preset or volume changes, and when the instrument does
  // (the default sound follows it until you choose one yourself).
  useSession((s) => s.instrumentId);
  const version = useSyncExternalStore(
    fretSynth.subscribe,
    () => `${fretSynth.getChosen()}|${fretSynth.getVolume()}|${fretSynth.getSampleStatus()}`,
    () => "",
  );
  const active = version ? fretSynth.getPreset() : null;
  const volume = version ? fretSynth.getVolume() : 0.7;
  const following = version ? fretSynth.getChosen() === null : true;
  const status = version ? fretSynth.getSampleStatus() : "idle";

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
              onChange={(e) => {
                stopPreview();
                setError(false);
                fretSynth.setPreset(e.target.value === "auto" ? null : e.target.value);
              }}
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
          <p role="status" className="text-xs text-[var(--color-ink-dim)]">
            {x(status === "loading" ? "Loading instrument samples. Synth sound is available."
              : status === "ready" ? "Instrument samples ready."
              : status === "fallback" ? "Samples unavailable. Using synth sound."
              : "Samples load when you play. Synth sound works offline.")}
          </p>
          {error && <p role="alert" className="text-xs text-[var(--color-error)]">{x("Audio could not start. Tap Test sound to retry.")}</p>}
          <Button size="sm" onClick={() => void testSound()}>
            {x(testing ? "■ Stop test" : "▶ Test sound")}
          </Button>
        </div>
      )}
    </div>
  );
}
