"use client";

import {
  type CompanionStyle,
  type Difficulty,
  type Fretboard as Board,
  GATE_THRESHOLDS,
  type GateLevel,
  type Progression,
  TapTempo,
  chordAtBeat,
} from "@fretlight/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { NowPanel } from "@/components/looper/NowPanel";
import { KIND_LABELS, TrackRow } from "@/components/looper/TrackRow";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useLoopClock } from "@/hooks/useLooper";
import { type AudioInputDevice, listInputs, watchDevices } from "@/lib/audio/audio-input";
import type { LooperEngine, LooperState, TrackKind } from "@/lib/looper/looper-engine";
import { cn } from "@/lib/ui/cn";
import { useSession } from "@/store/session";

function download(bytes: Uint8Array<ArrayBuffer>, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "line";

/** A moving line across a waveform lane. Reads the audio clock every frame without re-rendering the page. */
function Playhead({ engine }: { engine: LooperEngine }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const position = engine.position();
      const loop = engine.getState().loopSeconds;
      if (el.current) {
        const visible = position !== null && loop !== null && engine.getState().phase !== "stopped";
        el.current.style.opacity = visible ? "1" : "0";
        if (visible) el.current.style.left = `${(position / loop) * 100}%`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine]);
  return <div ref={el} className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-white opacity-0 shadow-[0_0_6px_rgba(255,255,255,0.9)]" />;
}

/** Input level, with a warning when the signal is too hot. `large` is the check-your-level version. */
function Meter({ engine, active, large }: { engine: LooperEngine; active: boolean; large?: boolean }) {
  const bars = useRef<HTMLDivElement>(null);
  const [clipping, setClipping] = useState(false);
  const [signal, setSignal] = useState(false);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let wasClipping = false;
    let heard = false;
    const tick = () => {
      const { peak, clipping: clip } = engine.level();
      const lit = Math.round(Math.min(1, Math.sqrt(peak)) * 24);
      bars.current?.childNodes.forEach((child, i) => {
        (child as HTMLElement).style.opacity = i < lit ? "1" : "0.15";
      });
      if (clip !== wasClipping) {
        wasClipping = clip;
        setClipping(clip);
      }
      const hasSignal = peak > 0.02;
      if (hasSignal !== heard) {
        heard = hasSignal;
        setSignal(hasSignal);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine, active]);

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={bars} className={cn("flex items-end gap-0.5", large ? "h-10" : "h-6")} aria-label="Input level">
        {Array.from({ length: 24 }, (_, i) => (
          <div
            key={i}
            className={cn("flex-1 rounded-sm", i > 20 ? "bg-[var(--color-error)]" : i > 16 ? "bg-[#ffb454]" : "bg-[var(--color-signal)]")}
            style={{ height: `${25 + i * 3.1}%`, opacity: 0.15 }}
          />
        ))}
      </div>
      {clipping ? (
        <p className="text-xs font-medium text-[var(--color-error)]">Too loud (red). Lower the input gain, or the gain knob on your interface.</p>
      ) : large ? (
        <p className="text-xs text-[var(--color-ink-dim)]">
          {signal ? "✓ I can hear you. Aim for the green and yellow, not the red." : "Play a note or a chord: the bars should move."}
        </p>
      ) : null}
    </div>
  );
}

function Step({ n, label, state }: { n: number; label: string; state: "todo" | "now" | "done" }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "readout flex h-6 w-6 items-center justify-center rounded-full border text-xs",
          state === "done" && "border-[#39e08b] text-[#39e08b]",
          state === "now" && "border-[var(--color-signal)] bg-[rgba(34,224,214,0.15)] text-[var(--color-signal)]",
          state === "todo" && "border-[var(--color-hairline-bright)] text-[var(--color-ink-faint)]",
        )}
      >
        {state === "done" ? "✓" : n}
      </span>
      <span className={cn("text-sm", state === "now" ? "font-medium text-[var(--color-ink)]" : "text-[var(--color-ink-faint)]")}>{label}</span>
    </div>
  );
}

export function LooperPanel({
  engine,
  state,
  progression,
  style,
  difficulty,
  instrument,
  board,
  lowStringOnTop,
  selectedChord,
}: {
  engine: LooperEngine;
  state: LooperState;
  progression: Progression;
  style: CompanionStyle;
  difficulty: Difficulty;
  instrument: "guitar" | "bass";
  board: Board;
  lowStringOnTop: boolean;
  selectedChord: number;
}) {
  const bpm = useSession((s) => s.bpm);
  const setBpm = useSession((s) => s.setBpm);
  const timeSignature = useSession((s) => s.timeSignature);
  const patchSession = useSession((s) => s.patch);
  const tap = useRef(new TapTempo());
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [newKind, setNewKind] = useState<TrackKind>("rhythm");
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { settings, phase, tracks, loopSeconds, bars, recording } = state;
  const hasLoop = tracks.length > 0 && loopSeconds !== null;
  const running = phase === "playing";
  const recordingNow = phase === "counting" || phase === "recording";
  const shownBpm = hasLoop ? settings.bpm : bpm;

  useEffect(() => {
    engine.configure({ bpm, beatsPerBar: timeSignature.beats });
  }, [engine, bpm, timeSignature.beats]);

  useEffect(() => {
    void listInputs().then(setDevices);
    return watchDevices(setDevices);
  }, []);

  // Tell the player a take landed: otherwise "did it record?" is a real question.
  const previousCount = useRef(0);
  useEffect(() => {
    if (tracks.length > previousCount.current && previousCount.current >= 0 && !recordingNow) {
      const last = tracks[tracks.length - 1]!;
      setNotice(previousCount.current === 0 ? `✓ Recorded. “${last.name}” is now looping.` : `✓ “${last.name}” added to the loop.`);
      const timer = setTimeout(() => setNotice(null), 6000);
      previousCount.current = tracks.length;
      return () => clearTimeout(timer);
    }
    previousCount.current = tracks.length;
  }, [tracks, recordingNow]);

  const clock = useLoopClock(engine, progression, running || phase === "paused");
  const chordIndex = clock.chordIndex >= 0 ? clock.chordIndex : Math.min(selectedChord, progression.chords.length - 1);

  const barChords = useMemo(() => {
    if (!bars) return [];
    const count = Math.max(1, Math.round(bars));
    return Array.from({ length: count }, (_, b) => (progression.chords.length ? chordAtBeat(progression, b * settings.beatsPerBar).symbol : ""));
  }, [bars, progression, settings.beatsPerBar]);

  const nameFor = (kind: TrackKind) => {
    const same = tracks.filter((t) => t.kind === kind).length;
    return same ? `${KIND_LABELS[kind]} ${same + 1}` : KIND_LABELS[kind];
  };

  const startRecording = () => {
    setNotice(null);
    if (!hasLoop) void engine.recordMaster(newKind, nameFor(newKind));
    else void engine.recordOverdub(newKind, nameFor(newKind));
  };

  const gateOptions: { value: GateLevel; label: string }[] = [
    { value: "off", label: "Off" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];
  const focusKind: TrackKind = recording?.kind ?? newKind;
  const stage: "connect" | "ready" | "loop" = hasLoop ? "loop" : state.inputReady ? "ready" : "connect";

  const settingsSummary = `${shownBpm} BPM · ${timeSignature.beats}/4 · count-in ${settings.countInBars === 0 ? "off" : `${settings.countInBars} bar${settings.countInBars > 1 ? "s" : ""}`} · ${settings.loopMode === "musical" ? "whole bars" : "free length"} · click ${settings.metronome ? "on" : "off"}`;
  const inputSummary = `${settings.deviceId ? "chosen input" : "default input"} · gate ${settings.gate} · gain ${Math.round(settings.inputGain * 100)}%`;

  const settingsControls = (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={`Tempo · ${shownBpm} BPM`}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={40}
              max={220}
              value={shownBpm}
              disabled={hasLoop || recordingNow}
              onChange={(e) => setBpm(Number(e.target.value))}
              aria-label="Tempo"
              className="min-w-0 flex-1 accent-[var(--color-signal)] disabled:opacity-40"
            />
            <Button
              size="sm"
              disabled={hasLoop || recordingNow}
              onClick={() => {
                const estimate = tap.current.tap(performance.now() / 1000);
                if (estimate) setBpm(estimate);
              }}
            >
              TAP
            </Button>
          </div>
          <span className="text-[11px] text-[var(--color-ink-faint)]">
            {hasLoop ? "Locked to the loop. Clear all to change it." : "Not sure? Tap along with the song, four or more times."}
          </span>
        </Field>
        <Field label="Time signature">
          <select
            value={timeSignature.beats}
            disabled={hasLoop || recordingNow}
            onChange={(e) => patchSession({ timeSignature: { beats: Number(e.target.value), value: 4 } })}
            className="h-9 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-sm disabled:opacity-40"
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}/4
              </option>
            ))}
          </select>
        </Field>
        <Field label="Count-in before recording">
          <SegmentedControl
            size="sm"
            options={[
              { value: "0", label: "Off" },
              { value: "1", label: "1 bar" },
              { value: "2", label: "2 bars" },
            ]}
            value={String(settings.countInBars)}
            onChange={(v) => engine.configure({ countInBars: Number(v) as 0 | 1 | 2 })}
          />
        </Field>
        <Field label="Loop length">
          <SegmentedControl
            size="sm"
            options={[
              { value: "musical", label: "Whole bars", hint: "Rounds your first take to whole bars, so it stays in time with the click" },
              { value: "free", label: "Free", hint: "Uses exactly what you recorded; the click turns off after the first take" },
            ]}
            value={settings.loopMode}
            onChange={(v) => !hasLoop && engine.configure({ loopMode: v as "musical" | "free" })}
          />
        </Field>
      </div>
      <Toggle label="Metronome click while the loop plays" checked={settings.metronome} onChange={(v) => engine.configure({ metronome: v })} />
    </div>
  );

  const inputControls = (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Input device">
          <select
            value={settings.deviceId}
            onChange={(e) => {
              engine.configure({ deviceId: e.target.value });
              if (state.inputReady) void engine.enableInput(e.target.value);
            }}
            className="h-9 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-xs"
          >
            <option value="">Default input</option>
            {devices
              .filter((d) => d.deviceId && d.deviceId !== "default")
              .map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Noise gate">
          <SegmentedControl size="sm" options={gateOptions} value={settings.gate} onChange={(v) => engine.configure({ gate: v })} />
          <span className="text-[11px] text-[var(--color-ink-faint)]">
            {GATE_THRESHOLDS[settings.gate] === 0 ? "Everything passes." : "Silences hiss and hum between notes. Raise it if you still hear noise."}
          </span>
        </Field>
        <Field label={`Input gain · ${Math.round(settings.inputGain * 100)}%`}>
          <input
            type="range"
            min={0.1}
            max={2}
            step={0.05}
            value={settings.inputGain}
            onChange={(e) => engine.configure({ inputGain: Number(e.target.value) })}
            aria-label="Input gain"
            className="accent-[var(--color-signal)]"
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Toggle label="Hear myself (headphones only)" checked={settings.monitor} onChange={(v) => engine.configure({ monitor: v })} />
        <Toggle label="Gentle compressor" checked={settings.compressor} onChange={(v) => engine.configure({ compressor: v })} />
      </div>
      <Field label={`Timing adjustment · ${settings.latencyMs} ms`}>
        <input
          type="range"
          min={0}
          max={250}
          step={1}
          value={settings.latencyMs}
          onChange={(e) => engine.configure({ latencyMs: Number(e.target.value) })}
          className="accent-[var(--color-signal)]"
        />
        <span className="text-[11px] text-[var(--color-ink-faint)]">
          New lines can land a little late (your interface and browser add delay). If a line sounds behind the beat, raise this; if it is ahead, lower it.
        </span>
      </Field>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Looper"
        meta={<span className="text-[11px] text-[var(--color-ink-faint)]">Recordings stay in your browser and are never uploaded.</span>}
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Step n={1} label="Connect your guitar" state={stage === "connect" ? "now" : "done"} />
            <span className="hidden text-[var(--color-ink-faint)] sm:block">→</span>
            <Step n={2} label="Record a first line" state={stage === "connect" ? "todo" : stage === "ready" ? "now" : "done"} />
            <span className="hidden text-[var(--color-ink-faint)] sm:block">→</span>
            <Step n={3} label="Layer more lines" state={stage === "loop" ? "now" : "todo"} />
          </div>

          {notice && (
            <p className="rounded-xl border border-[#39e08b] bg-[rgba(57,224,139,0.1)] px-4 py-2.5 text-sm text-[#39e08b]" role="status">
              {notice}
            </p>
          )}
          {state.error && <p className="rounded-xl border border-[var(--color-error)] px-4 py-2.5 text-sm text-[var(--color-error)]">{state.error}</p>}

          {/* ----------------------------------------------------- 1: connect */}
          {stage === "connect" && (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-[var(--color-hairline-bright)] bg-[var(--color-void)] p-6">
              <p className="text-base font-medium">Turn on your input to begin</p>
              <p className="max-w-xl text-sm leading-relaxed text-[var(--color-ink-dim)]">
                Plug in your guitar or bass (through an audio interface) or use a microphone. Your browser will ask for permission. Nothing is recorded
                until you press Record.
              </p>
              <Button size="lg" variant="primary" onClick={() => void engine.enableInput()}>
                Turn on input
              </Button>
            </div>
          )}

          {/* ----------------------------------------------------- 2: ready */}
          {stage === "ready" && !recordingNow && (
            <div className="flex flex-col gap-4 rounded-2xl border border-[var(--color-signal)] bg-[rgba(34,224,214,0.05)] p-5">
              <div>
                <p className="text-base font-medium">Check your level, then record</p>
                <ol className="mt-1 list-inside list-decimal text-sm leading-relaxed text-[var(--color-ink-dim)]">
                  <li>Play a chord. The bars below should move.</li>
                  <li>Press Record. After the count-in, play your chords.</li>
                  <li>Press Stop when you are done. That line becomes the loop.</li>
                </ol>
              </div>
              <Meter engine={engine} active large />
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" variant="danger" onClick={startRecording}>
                  ● Record
                </Button>
                <label className="flex items-center gap-2 text-xs text-[var(--color-ink-dim)]">
                  This line is
                  <select
                    value={newKind}
                    onChange={(e) => setNewKind(e.target.value as TrackKind)}
                    className="h-9 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-2 text-xs"
                  >
                    {(Object.keys(KIND_LABELS) as TrackKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------- 3: loop */}
          {stage === "loop" && (
            <div className="flex flex-col gap-4 rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                {running ? (
                  <Button size="lg" onClick={() => engine.pause()}>
                    ⏸ Pause
                  </Button>
                ) : (
                  <Button size="lg" variant="primary" onClick={() => engine.startPlayback()} disabled={recordingNow}>
                    ▶ Play loop
                  </Button>
                )}
                <Button size="lg" onClick={() => engine.stop()} disabled={!running && phase !== "paused"}>
                  ■ Stop
                </Button>
                <Button size="lg" variant="ghost" onClick={() => engine.restart()} disabled={recordingNow}>
                  ↺ Restart
                </Button>
                <span className="mx-1 hidden h-8 w-px bg-[var(--color-hairline)] sm:block" />
                <Button size="sm" variant="ghost" onClick={() => engine.undo()} disabled={!state.canUndo || recordingNow}>
                  ↶ Undo
                </Button>
                <Button size="sm" variant="ghost" onClick={() => engine.redo()} disabled={!state.canRedo || recordingNow}>
                  ↷ Redo
                </Button>
                <div className="ml-auto text-right">
                  <p className="readout text-lg">
                    {clock.bar > 0 ? `Bar ${clock.bar} / ${clock.totalBars} · Beat ${clock.beat}` : `${Math.round(bars ?? 0)} bars`}
                  </p>
                  <p className="text-[11px] text-[var(--color-ink-faint)]">
                    {running ? "Loop is on" : phase === "paused" ? "Paused" : "Stopped"} · {loopSeconds!.toFixed(1)} s
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-hairline)] pt-4">
                <Button size="lg" variant="danger" onClick={startRecording} disabled={recordingNow}>
                  ● Record a new line
                </Button>
                <label className="flex items-center gap-2 text-xs text-[var(--color-ink-dim)]">
                  Line type
                  <select
                    value={newKind}
                    onChange={(e) => setNewKind(e.target.value as TrackKind)}
                    className="h-9 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-2 text-xs"
                  >
                    {(Object.keys(KIND_LABELS) as TrackKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-[var(--color-ink-faint)]">It plays the loop, counts you in, and records one full loop.</p>
              </div>
            </div>
          )}

          <Disclosure title="Settings" summary={settingsSummary}>
            {settingsControls}
          </Disclosure>
          <Disclosure title="Input" summary={state.inputReady ? inputSummary : "not connected yet"}>
            <div className="flex flex-col gap-4">
              {state.inputReady && <Meter engine={engine} active large />}
              {inputControls}
            </div>
          </Disclosure>
        </div>
      </Panel>

      {/* ---------------------------------------------------------------- lines */}
      {hasLoop && (
        <Panel
          title={`Lines (${tracks.length})`}
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => { const bytes = engine.mixWav(1); if (bytes) download(bytes, "fretlight-mix.wav"); }}>
                ↓ Download mix
              </Button>
              {confirmClear ? (
                <>
                  <Button size="sm" variant="danger" onClick={() => { engine.clearAll(); setConfirmClear(false); }}>
                    Yes, clear everything
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)} disabled={recordingNow}>
                  Clear all
                </Button>
              )}
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            {barChords.length > 0 && loopSeconds && (
              <div className="grid gap-3 md:grid-cols-[260px_1fr]">
                <p className="hud-label self-center">Bars and chords</p>
                <div className="relative flex overflow-hidden rounded-lg border border-[var(--color-hairline)]">
                  {barChords.map((symbol, i) => (
                    <div
                      key={i}
                      className={cn(
                        "readout flex-1 truncate border-r border-[var(--color-hairline)] px-1.5 py-1 text-center text-xs last:border-r-0",
                        clock.bar === i + 1 ? "bg-[rgba(34,224,214,0.18)] text-[var(--color-ink)]" : "text-[var(--color-ink-dim)]",
                      )}
                    >
                      <span className="block text-[9px] text-[var(--color-ink-faint)]">{i + 1}</span>
                      {symbol}
                    </div>
                  ))}
                  <Playhead engine={engine} />
                </div>
              </div>
            )}
            {tracks.map((track) => (
              <div key={track.id} className="relative">
                <TrackRow
                  track={track}
                  bars={bars ?? 1}
                  loopSeconds={loopSeconds!}
                  busy={recordingNow}
                  recordingThis={recording?.trackId === track.id}
                  onVolume={(v) => engine.setVolume(track.id, v)}
                  onMute={(m) => engine.setMuted(track.id, m)}
                  onSolo={(s) => engine.setSolo(track.id, s)}
                  onRename={(n) => engine.rename(track.id, n)}
                  onKind={(k) => engine.setKind(track.id, k)}
                  onDelete={() => engine.deleteTrack(track.id)}
                  onDuplicate={() => engine.duplicateTrack(track.id)}
                  onDownload={() => { const bytes = engine.trackWav(track.id); if (bytes) download(bytes, `fretlight-${slug(track.name)}.wav`); }}
                  onRerecord={() => void engine.recordOverdub(track.kind, track.name, { replaceId: track.id })}
                  onPunch={(start, end) => void engine.recordOverdub(track.kind, track.name, { replaceId: track.id, region: { start, end } })}
                  onClearSection={(start, end) => engine.clearSection(track.id, start, end)}
                />
                <div className="pointer-events-none absolute top-3 right-3 bottom-[44px] hidden w-[calc(100%-260px-2.5rem)] md:block">
                  <Playhead engine={engine} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {progression.chords.length > 0 && (
        <NowPanel
          progression={progression}
          chordIndex={chordIndex}
          running={running}
          style={style}
          difficulty={difficulty}
          instrument={instrument}
          board={board}
          lowStringOnTop={lowStringOnTop}
          bpm={shownBpm}
          focusKind={focusKind}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="hud-label">{label}</span>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-ink-dim)]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--color-signal)]" />
      {label}
    </label>
  );
}
