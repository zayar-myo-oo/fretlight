"use client";

import { type Fretboard, getInstrument, noteAt } from "@fretlight/core";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CalibrationPanel } from "@/components/audio/CalibrationPanel";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Slider } from "@/components/ui/Slider";
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

/**
 * Input selection: what kind of device, then which one.
 *
 * Both input types feed the identical pipeline — there is no second detector for
 * audio interfaces. The type choice narrows the device list and sets the noise
 * floor, which is the one thing that genuinely differs between a clean DI signal
 * and a microphone picking up a room.
 *
 * `getUserMedia` must come from a user gesture, so opening an input is always an
 * explicit press, never something that happens on mount.
 */
export function InputSourcePanel({ board, className }: { board: Fretboard; className?: string }) {
  const instrumentId = useSession((s) => s.instrumentId);
  const audio = useAudioState();
  const contextState = useSyncExternalStore(sharedInput.subscribe, () => sharedInput.current?.context.state ?? "off", () => "off");
  const signal = useSignalState();

  const [inputType, setInputType] = useState<InputType>("microphone");
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");

  const instrument = getInstrument(instrumentId);
  const live = audio.sourceKind === "microphone" && audio.listening;

  const open = useCallback(
    async (type: InputType, id: string) => {
      if (!instrument) return;
      await detectionHub.useMicrophone({
        minFrequency: instrument.minFrequency,
        maxFrequency: instrument.maxFrequency,
        inputType: type,
        ...(id ? { deviceId: id } : {}),
      });
      // Labels stay empty until permission has been granted at least once, so
      // the list is worth re-reading right after opening a device.
      setDevices(await listInputs());
    },
    [instrument],
  );

  useEffect(() => {
    void listInputs().then(setDevices);
    // Interfaces get plugged in and pulled out mid-session; keep the list honest.
    return watchDevices((next) => {
      setDevices(next);
      setDeviceId((current) =>
        current && !next.some((device) => device.deviceId === current) ? "" : current,
      );
    });
  }, []);

  // Follow instrument changes: a 5-string bass needs the detector to search down
  // to 26 Hz, a guitar does not and is more accurate without it.
  useEffect(() => {
    if (!live || !instrument) return;
    void detectionHub.retune({
      minFrequency: instrument.minFrequency,
      maxFrequency: instrument.maxFrequency,
      inputType,
      ...(deviceId ? { deviceId } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentId]);

  const visible = devicesOfType(devices, inputType);

  return (
    <Panel
      title="Input"
      className={className}
      meta={<SignalBadge state={signal.state} live={live} />}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            options={[
              { value: "microphone", label: "Microphone", hint: "Built-in or USB mic" },
              { value: "audio_interface", label: "Audio interface", hint: "Guitar or bass plugged in via USB" },
            ]}
            value={inputType}
            onChange={(value) => {
              setInputType(value as InputType);
              setDeviceId("");
              if (live) void open(value as InputType, "");
            }}
          />

          <label className="flex items-center gap-2">
            <span className="hud-label">Device</span>
            <select
              disabled={audio.starting}
          value={deviceId}
              onChange={(event) => {
                const next = event.target.value;
                setDeviceId(next);
                // Switching device mid-session should just work.
                if (live) void open(inputType, next);
              }}
              className="h-9 min-w-[180px] rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-xs text-[var(--color-ink-dim)]"
            >
              <option value="">
                {"System default input"}
              </option>
              {visible.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={live ? "secondary" : "primary"}
            onClick={() => void open(inputType, deviceId)}
            disabled={audio.starting}
          >
            {audio.starting ? "Opening…" : live ? "Reconnect" : "Connect input"}
          </Button>
          {live && (
            <Button variant="ghost" onClick={() => void detectionHub.useVirtualInstrument()}>
              Use virtual instrument
            </Button>
          )}
          {devices.length === 0 && (
            <span className="text-[11px] text-[var(--color-ink-faint)]">
              Connect an input once to see device names.
            </span>
          )}
        </div>

        {contextState !== "off" && contextState !== "running" && <button onClick={() => void sharedInput.resume().catch(() => {})}>Resume audio input</button>}
      {audio.error && (
          <p className="rounded-xl border border-[rgba(255,84,112,0.35)] bg-[rgba(255,84,112,0.08)] p-3 text-xs leading-relaxed text-[var(--color-ink-dim)]">
            {audio.error}
          </p>
        )}

        {live ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="hud-label">Input level</span>
              <span className="readout text-[10px] text-[var(--color-ink-faint)]">
                {audio.deviceLabel}
              </span>
            </div>
            <LevelMeter rms={audio.signalStrength} clipping={audio.peakLevel >= 0.97} />
            <p className="mt-1.5 min-h-[16px] text-[11px] text-[var(--color-ink-faint)]">
              {signal.message}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
              Echo cancellation, noise suppression and auto-gain are disabled — they are
              tuned for speech and would strip a sustained bass fundamental. Detection runs
              in a worker on this device; no audio is uploaded.
            </p>

            <CalibrationPanel live={live} />
          </div>
        ) : (
          <VirtualControls board={board} />
        )}
      </div>
    </Panel>
  );
}

/** The spec's input states, surfaced rather than collapsed into a blank readout. */
function SignalBadge({ state, live }: { state: string; live: boolean }) {
  if (!live) return <Badge tone="warn">virtual instrument</Badge>;
  switch (state) {
    case "note_detected":
      return <Badge tone="correct">note detected</Badge>;
    case "pitch_uncertain":
      return <Badge tone="signal">listening</Badge>;
    case "low_signal":
      return <Badge tone="warn">low signal</Badge>;
    case "clipping":
      return <Badge tone="warn">clipping</Badge>;
    case "noise":
      return <Badge tone="warn">noise</Badge>;
    case "no_signal":
      return <Badge tone="neutral">no signal</Badge>;
    default:
      return <Badge tone="neutral">no input</Badge>;
  }
}

function LevelMeter({ rms, clipping }: { rms: number; clipping: boolean }) {
  // Logarithmic: a linear meter spends most of its travel on levels nobody plays at.
  const db = rms > 0 ? 20 * Math.log10(rms) : -80;
  const percent = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  const hot = db > -6;

  return (
    <div
      className={cn(
        "relative h-2.5 overflow-hidden rounded-full bg-[var(--color-void)] ring-1 transition-shadow",
        clipping ? "ring-2 ring-[var(--color-error)]" : "ring-[var(--color-hairline)]",
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-75",
          clipping || hot ? "bg-[var(--color-error)]" : "bg-[var(--color-signal)]",
        )}
        style={{ width: `${percent}%` }}
      />
      {/* Target zone: loud enough to detect, short of clipping. */}
      <span className="absolute inset-y-0 left-[50%] w-[33%] border-x border-[rgba(255,255,255,0.14)]" />
    </div>
  );
}

function VirtualControls({ board }: { board: Fretboard }) {
  const [detune, setDetune] = useState(0);
  const [held, setHeld] = useState<number | null>(null);

  useEffect(() => {
    void detectionHub.start();
  }, []);

  return (
    <div>
      <p className="mb-3 max-w-xl text-xs leading-relaxed text-[var(--color-ink-faint)]">
        No input connected — these buttons feed the same pipeline, with attack transients,
        drift and intonation error, so nothing downstream is being flattered.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: board.stringCount }, (_, stringIndex) => {
          const open = noteAt(board, stringIndex, 0);
          if (!open) return null;
          const active = held === open.midi;
          return (
            <button
              key={stringIndex}
              onClick={() => {
                if (active) {
                  detectionHub.mock?.release();
                  setHeld(null);
                } else {
                  detectionHub.mock?.hold(open.midi, detune);
                  setHeld(open.midi);
                }
              }}
              className={cn(
                "readout flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-xl border text-sm font-semibold transition-all active:scale-95",
                active
                  ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.14)] text-[var(--color-signal)] glow-signal"
                  : "border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]",
              )}
            >
              <span>
                {open.name}
                <span className="text-[10px] text-[var(--color-ink-faint)]">{open.octave}</span>
              </span>
              <span className="text-[9px] tracking-wider text-[var(--color-ink-faint)] uppercase">
                {active ? "ringing" : "hold"}
              </span>
            </button>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            detectionHub.mock?.release();
            setHeld(null);
          }}
        >
          Mute
        </Button>
      </div>

      <Slider
        className="mt-5 max-w-sm"
        label={`Intonation  ${detune > 0 ? "+" : ""}${detune.toFixed(0)}¢`}
        min={-45}
        max={45}
        value={detune}
        onChange={(value) => {
          setDetune(value);
          if (held !== null) detectionHub.mock?.hold(held, value);
        }}
      />
    </div>
  );
}
