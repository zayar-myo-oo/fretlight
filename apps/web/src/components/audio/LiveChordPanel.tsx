"use client";

import { type ChordMatch, type MusicKey, SHARP_NAMES, findDiatonicChord, getChord } from "@fretlight/core";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { type AudioInputDevice, classifyDevice, listInputs, watchDevices } from "@/lib/audio/audio-input";
import { ChordListener, type ChordFrame } from "@/lib/audio/chord-listener";
import { Fretboard } from "@/components/fretboard/Fretboard";
import { useFretboardContext } from "@/hooks/useFretboard";
import { detectionMarkers } from "@/lib/audio/detection-markers";
import { useTx } from "@/lib/i18n/locale";

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
export function LiveChordPanel({
  activeKey,
  onChord,
  footer,
  title = "Live Chord Detection",
}: {
  activeKey: MusicKey | null;
  /** Called once each time a new stable chord is heard. */
  onChord?: (chord: ChordMatch) => void;
  footer?: ReactNode;
  title?: string;
}) {
  const { board } = useFretboardContext();
  const mounted = useRef(true);
  const request = useRef(0);
  const [busy, setBusy] = useState(false);
  const listener = useRef<ChordListener | null>(null);
  const x = useTx();
  const lastSymbol = useRef<string | null>(null);
  const onChordRef = useRef(onChord);
  onChordRef.current = onChord;
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
    mounted.current = true;
    const current = listener.current ?? (listener.current = new ChordListener());
    return () => { mounted.current = false; ++request.current; void current.stop(); };
  }, []);

  const handleFrame = useCallback((next: ChordFrame) => {
    setFrame(next);
    const symbol = next.chord?.symbol ?? null;
    if (next.chord && symbol !== lastSymbol.current) {
      onChordRef.current?.(next.chord);
    }
    lastSymbol.current = symbol;
  }, []);

  const start = useCallback(async (id = deviceId) => {
    const ticket = ++request.current;
    setError(null);
    setBusy(true);
    const current = listener.current ?? (listener.current = new ChordListener());
    const label = devices.find((d) => d.deviceId === id)?.label ?? "";
    try {
      await current.start(id, label, handleFrame, () => { setRunning(false); setFrame(null); setError("Input disconnected. Reconnect and start again."); });
      if (!mounted.current || ticket !== request.current) return;
      setRunning(current.running);
      // Labels only appear once permission is granted, so refresh the list now.
      setDevices(await listInputs());
    } catch (e) {
      if (!mounted.current || ticket !== request.current) return;
      setRunning(false);
      setError(describeError(e));
    } finally { if (mounted.current && ticket === request.current) setBusy(false); }
  }, [deviceId, devices, handleFrame]);

  const stop = useCallback(async () => {
    await listener.current?.stop();
    setRunning(false);
    setFrame(null);
    lastSymbol.current = null;
  }, []);

  // Switching device while listening should just work.
  const onDevice = (id: string) => {
    setDeviceId(id);
    if (running) void start(id);
  };

  const chord = frame?.chord ?? null;
  const tones = chord ? getChord(chord.root, chord.chordId) : null;
  const numeral = chord && tones && activeKey ? findDiatonicChord(activeKey, [...tones.pitchClasses]) : null;

  return (
    <Panel
      title={title}
      meta={<Badge tone={running ? "theory" : "neutral"}>{x(running ? "Listening" : "Off")}</Badge>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="hud-label">{x("Input")}</span>
            <select
              disabled={busy}
              value={deviceId}
              onChange={(e) => onDevice(e.target.value)}
              className="h-9 min-w-[180px] max-w-[260px] rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-xs text-[var(--color-ink-dim)]"
            >
              <option value="">{x("Default input")}</option>
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
              {x("■ Stop listening")}
            </Button>
          ) : (
            <Button size="sm" disabled={busy} variant="primary" onClick={() => void start()}>
              {x("● Start listening")}
            </Button>
          )}
        </div>

        {error && <p className="text-sm text-[var(--color-error)]">{x(error)}</p>}

        {!running && !error && (
          <p className="text-xs leading-relaxed text-[var(--color-ink-dim)]">
            {x("Plug in your guitar or bass interface (or use a microphone), press Start, and strum a chord. Audio stays on this device. Use Record take to save a performance.")}
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

            {frame && frame.peak >= 0.97 && <p role="status" className="text-xs text-[var(--color-error)]">Clipping — lower interface gain.</p>}
            <div>
              <span className="hud-label">{x("Detected chord")}</span>
              {chord ? (
                <div className="mt-1 flex flex-wrap items-baseline gap-3">
                  <span className="readout text-3xl font-semibold text-[var(--color-signal)]">{chord.symbol}</span>
                  <span className="readout text-xs text-[var(--color-ink-dim)]">
                    {x("Confidence {n}%", { n: Math.round(chord.confidence * 100) })}
                  </span>
                </div>
              ) : (
                <p className="mt-1 text-sm text-[var(--color-ink-faint)]">
                  {x(frame?.active ? "Listening…" : "No chord detected. Play a chord, or check the input level.")}
                </p>
              )}
            </div>

            {frame && frame.notes.length > 0 && (
              <div>
                <span className="hud-label">Spectral pitch classes (may include harmonics)</span>
                <p className="readout mt-1 text-sm">{frame.notes.map((pc) => SHARP_NAMES[pc]).join(" ")}</p>
              </div>
            )}

            {chord && (
              <div>
                <span className="hud-label">{x("Key context")}</span>
                <p className="readout mt-1 text-sm">
                  {activeKey
                    ? numeral
                      ? x("{numeral} in {key}", { numeral: numeral.roman, key: activeKey.name })
                      : x("Not diatonic to {key}", { key: activeKey.name })
                    : x("Choose or detect a key to see the Roman numeral")}
                </p>
              </div>
            )}
          </>
        )}

        <Fretboard board={board} toFret={12} markers={detectionMarkers(board, { kind: "chord", chord, notes: frame?.notes ?? [] })} />
        <p className="text-xs text-[var(--color-ink-faint)]">Frets 0–12 show chord-tone locations; pink marks the root. Audio does not establish a fingering or inversion. Ambiguous matches remain unlabelled.</p>
        {footer}
      </div>
    </Panel>
  );
}
