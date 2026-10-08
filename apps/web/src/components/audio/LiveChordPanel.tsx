"use client";

import { type MusicKey, SHARP_NAMES, findDiatonicChord, getChord } from "@fretlight/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { type AudioInputDevice, classifyDevice, listInputs, watchDevices } from "@/lib/audio/audio-input";
import { ChordListener, type ChordFrame } from "@/lib/audio/chord-listener";

function describeError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "Microphone access was blocked. Allow it in the browser's address bar, then try again.";
  if (name === "NotFoundError") return "No audio input found. Plug in your interface and press Start again.";
  if (name === "OverconstrainedError") return "That device isn't available any more. Pick another input.";
  if (name === "NotReadableError") return "The device is in use by another app. Close it and try again.";
  return "Couldn't open the audio input.";
}

/**
 * Live chord detection from the microphone or an audio interface.
 * The audio work lives in `ChordListener`; this only renders its frames.
 */
export function LiveChordPanel({ activeKey }: { activeKey: MusicKey | null }) {
  const listener = useRef<ChordListener | null>(null);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<ChordFrame | null>(null);

  useEffect(() => {
    void listInputs().then(setDevices);
    return watchDevices(setDevices);
  }, []);

  useEffect(() => {
    const current = listener.current ?? (listener.current = new ChordListener());
    return () => void current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const current = listener.current ?? (listener.current = new ChordListener());
    const label = devices.find((d) => d.deviceId === deviceId)?.label ?? "";
    try {
      await current.start(deviceId, label, setFrame);
      setRunning(true);
      // Labels only appear once permission is granted, so refresh the list now.
      setDevices(await listInputs());
    } catch (e) {
      setRunning(false);
      setError(describeError(e));
    }
  }, [deviceId, devices]);

  const stop = useCallback(async () => {
    await listener.current?.stop();
    setRunning(false);
    setFrame(null);
  }, []);

  // Switching device while listening should just work.
  const onDevice = (id: string) => {
    setDeviceId(id);
    if (running) {
      const label = devices.find((d) => d.deviceId === id)?.label ?? "";
      listener.current?.start(id, label, setFrame).catch((e) => {
        setRunning(false);
        setError(describeError(e));
      });
    }
  };

  const chord = frame?.chord ?? null;
  const tones = chord ? getChord(chord.root, chord.chordId) : null;
  const numeral = chord && tones && activeKey ? findDiatonicChord(activeKey, [...tones.pitchClasses]) : null;

  return (
    <Panel
      title="Live Chord Detection"
      meta={<Badge tone={running ? "theory" : "neutral"}>{running ? "Listening" : "Off"}</Badge>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="hud-label">Input</span>
            <select
              value={deviceId}
              onChange={(e) => onDevice(e.target.value)}
              className="h-9 min-w-[180px] max-w-[260px] rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-xs text-[var(--color-ink-dim)]"
            >
              <option value="">Default input</option>
              {devices
                .filter((d) => d.deviceId && d.deviceId !== "default")
                .map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                    {classifyDevice(d.label) === "audio_interface" ? " (interface)" : ""}
                  </option>
                ))}
            </select>
          </label>
          {running ? (
            <Button size="sm" onClick={() => void stop()}>
              ■ Stop listening
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void start()}>
              ● Start listening
            </Button>
          )}
        </div>

        {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}

        {!running && !error && (
          <p className="text-xs leading-relaxed text-[var(--color-ink-dim)]">
            Plug in your guitar or bass interface (or use a microphone), press Start, and
            strum a chord. Everything is analysed on this device; no audio is recorded or sent.
          </p>
        )}

        {running && (
          <>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-void)]">
              <div
                className="h-full rounded-full bg-[var(--color-signal)] transition-[width] duration-75"
                style={{ width: `${Math.min(100, Math.round(Math.sqrt(frame?.level ?? 0) * 140))}%` }}
              />
            </div>

            <div>
              <span className="hud-label">Detected chord</span>
              {chord ? (
                <div className="mt-1 flex flex-wrap items-baseline gap-3">
                  <span className="readout text-3xl font-semibold text-[var(--color-signal)]">{chord.symbol}</span>
                  <span className="readout text-xs text-[var(--color-ink-dim)]">
                    Confidence {Math.round(chord.confidence * 100)}%
                  </span>
                </div>
              ) : (
                <p className="mt-1 text-sm text-[var(--color-ink-faint)]">
                  {frame?.active ? "Listening…" : "No chord detected. Play a chord, or check the input level."}
                </p>
              )}
            </div>

            {frame && frame.notes.length > 0 && (
              <div>
                <span className="hud-label">Detected notes</span>
                <p className="readout mt-1 text-sm">{frame.notes.map((pc) => SHARP_NAMES[pc]).join(" ")}</p>
              </div>
            )}

            {chord && (
              <div>
                <span className="hud-label">Key context</span>
                <p className="readout mt-1 text-sm">
                  {activeKey
                    ? numeral
                      ? `${numeral.roman} in ${activeKey.name}`
                      : `Not diatonic to ${activeKey.name}`
                    : "Choose or detect a key to see the Roman numeral"}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
