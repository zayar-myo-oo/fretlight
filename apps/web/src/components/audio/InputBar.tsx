"use client";

import { getInstrument } from "@fretlight/core";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAudioState, useSignalState } from "@/hooks/useDetection";
import { sharedInput } from "@/lib/audio/shared-input";
import { detectionHub } from "@/lib/audio/detection-hub";
import {
  type AudioInputDevice,
  type InputType,
  devicesOfType,
  listInputs,
  watchDevices,
} from "@/lib/audio/audio-input";
import { useSession } from "@/store/session";
import { cn } from "@/lib/ui/cn";

export function InputBar({ className }: { readonly className?: string }) {
  const instrumentId = useSession((s) => s.instrumentId);
  const audio = useAudioState();
  const contextState = useSyncExternalStore(sharedInput.subscribe, () => sharedInput.current?.context.state ?? "off", () => "off");
  const signal = useSignalState();

  const [inputType, setInputType] = useState<InputType>("microphone");
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState(false);

  const micOn = audio.sourceKind === "microphone" && audio.listening;

  const turnMicOn = useCallback(async (selectedId = deviceId, selectedType = inputType) => {
    const instrument = getInstrument(instrumentId);
    if (!instrument) return;
    setBusy(true);
    try {
    await detectionHub.useMicrophone({
      minFrequency: instrument.minFrequency,
      maxFrequency: instrument.maxFrequency,
      inputType: selectedType,
      ...(selectedId ? { deviceId: selectedId } : {}),
    });
    setDevices(await listInputs());
    } finally { setBusy(false); }
  }, [instrumentId, inputType, deviceId]);

  const turnMicOff = useCallback(async () => {
    setBusy(true);
    await detectionHub.disable();
    setBusy(false);
  }, []);

  useEffect(() => {
    void listInputs().then(setDevices);
    return watchDevices((next) => {
      setDevices(next);
      setDeviceId((current) =>
        current && !next.some((device) => device.deviceId === current) ? "" : current,
      );
    });
  }, []);

  const visible = devicesOfType(devices, inputType);

  return (
    <div
      className={cn(
        "surface stack flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3",
        className,
      )}
    >
      {/* --- Microphone --- */}
      <div className="flex items-center gap-2.5">
        <span className="hud-label">Mic</span>
        <Toggle
          on={micOn}
          busy={busy}
          onChange={(next) => void (next ? turnMicOn() : turnMicOff())}
        />
      </div>

      <label className="flex items-center gap-2">
        <span className="hud-label">Source</span>
        <select
          value={inputType}
          onChange={(event) => {
            setInputType(event.target.value as InputType);
            setDeviceId("");
            if (micOn) void turnMicOn("", event.target.value as InputType);
          }}
          className="h-8 rounded-lg border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-2 text-xs text-[var(--color-ink-dim)]"
        >
          <option value="microphone">Microphone</option>
          <option value="audio_interface">Audio interface</option>
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="hud-label">Device</span>
        <select
          disabled={audio.starting}
          value={deviceId}
          onChange={(event) => {
            setDeviceId(event.target.value);
            if (micOn) void turnMicOn(event.target.value);
          }}
          className="h-8 min-w-[150px] max-w-[220px] rounded-lg border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-2 text-xs text-[var(--color-ink-dim)]"
        >
          <option value="">Default</option>
          {visible.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </label>

      <span
        className={cn(
          "readout ml-auto text-[10px] tracking-wider uppercase",
          signal.state === "note_detected"
            ? "text-[var(--color-correct)]"
            : signal.state === "noise" || signal.state === "low_signal"
              ? "text-[var(--color-warn)]"
              : "text-[var(--color-ink-faint)]",
        )}
      >
        {micOn ? signal.state.replace(/_/g, " ") : "input off"}
      </span>

      {micOn && <div className="w-full text-xs"><meter aria-label="Input level" min={0} max={1} value={audio.signalStrength} /> {audio.peakLevel >= 0.97 ? "Clipping — lower interface gain" : "Input level"}</div>}

      {contextState !== "off" && contextState !== "running" && <button onClick={() => void sharedInput.resume().catch(() => {})}>Resume audio input</button>}
      {audio.error && (
        <p className="w-full rounded-lg border border-[rgba(255,84,112,0.35)] bg-[rgba(255,84,112,0.08)] px-3 py-2 text-[11px] text-[var(--color-ink-dim)]">
          {audio.error}
        </p>
      )}
    </div>
  );
}

function Toggle({
  on,
  busy,
  onChange,
}: {
  readonly on: boolean;
  readonly busy?: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={busy}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-6 w-11 rounded-full border transition-colors disabled:opacity-50",
        on
          ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.25)]"
          : "border-[var(--color-hairline-bright)] bg-[var(--color-void)]",
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] h-4 w-4 rounded-full transition-all duration-200",
          on
            ? "left-[23px] bg-[var(--color-signal)] shadow-[0_0_10px_var(--color-signal)]"
            : "left-[3px] bg-[var(--color-hairline-bright)]",
        )}
      />
    </button>
  );
}
