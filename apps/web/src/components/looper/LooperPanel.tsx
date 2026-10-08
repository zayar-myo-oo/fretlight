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
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useLoopClock, useLooper } from "@/hooks/useLooper";
import { type AudioInputDevice, listInputs, watchDevices } from "@/lib/audio/audio-input";
import { type LooperEngine, type TrackKind } from "@/lib/looper/looper-engine";
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

/** Input level, with a warning when the signal is too hot. */
function Meter({ engine, active }: { engine: LooperEngine; active: boolean }) {
  const bars = useRef<HTMLDivElement>(null);
  const [clipping, setClipping] = useState(false);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let wasClipping = false;
    const tick = () => {
      const { peak, clipping: clip } = engine.level();
      const lit = Math.round(Math.min(1, Math.sqrt(peak)) * 16);
      bars.current?.childNodes.forEach((child, i) => {
        (child as HTMLElement).style.opacity = i < lit ? "1" : "0.15";
      });
      if (clip !== wasClipping) {
        wasClipping = clip;
        setClipping(clip);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine, active]);

  return (
    <div className="flex flex-col gap-1">
      <div ref={bars} className="flex h-6 items-end gap-0.5" aria-label="Input level">
        {Array.from({ length: 16 }, (_, i) => (
          <div
            key={i}
            className={cn("w-2 rounded-sm", i > 13 ? "bg-[var(--color-error)]" : i > 10 ? "bg-[#ffb454]" : "bg-[var(--color-signal)]")}
            style={{ height: `${30 + i * 4.4}%`, opacity: 0.15 }}
          />
        ))}
      </div>
      {clipping && <p className="text-[11px] text-[var(--color-error)]">Too loud: lower the input gain or your interface's gain.</p>}
    </div>
  );
}

function CountIn({ engine, start, beat }: { engine: LooperEngine; start: number; beat: number }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const remaining = start - engine.now();
      setLabel(remaining > 0.02 ? String(Math.ceil(remaining / beat - 0.001)) : "GO");
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine, start, beat]);
  return <span className="readout text-5xl font-bold text-[var(--color-signal)]">{label}</span>;
}

export function LooperPanel({
  progression,
  style,
  difficulty,
  instrument,
  board,
  lowStringOnTop,
  selectedChord,
}: {
  progression: Progression;
  style: CompanionStyle;
  difficulty: Difficulty;
  instrument: "guitar" | "bass";
  board: Board;
  lowStringOnTop: boolean;
  selectedChord: number;
}) {
  const { engine, state } = useLooper();
  const bpm = useSession((s) => s.bpm);
  const setBpm = useSession((s) => s.setBpm);
  const timeSignature = useSession((s) => s.timeSignature);
  const patchSession = useSession((s) => s.patch);
  const tap = useRef(new TapTempo());
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [newKind, setNewKind] = useState<TrackKind>("rhythm");
  const [confirmClear, setConfirmClear] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const { settings, phase, tracks, loopSeconds, bars, recording } = state;
  const hasLoop = tracks.length > 0 && loopSeconds !== null;
  const running = phase === "playing";
  const recordingNow = phase === "counting" || phase === "recording";
  const locked = hasLoop;
  const shownBpm = hasLoop ? settings.bpm : bpm;

  // Tempo and time signature come from the app's shared settings.
  useEffect(() => {
    engine.configure({ bpm, beatsPerBar: timeSignature.beats });
  }, [engine, bpm, timeSignature.beats]);

  useEffect(() => {
    void listInputs().then(setDevices);
    return watchDevices(setDevices);
  }, []);

  const clock = useLoopClock(engine, progression, running || phase === "paused");
  const chordIndex = clock.chordIndex >= 0 ? clock.chordIndex : Math.min(selectedChord, progression.chords.length - 1);
  const currentChord = progression.chords[chordIndex];

  // A loop that covers more chords than the progression has shows the chord for each bar.
  const barChords = useMemo(() => {
    if (!bars) return [];
    const count = Math.max(1, Math.round(bars));
    return Array.from({ length: count }, (_, b) => (progression.chords.length ? chordAtBeat(progression, b * settings.beatsPerBar).symbol : ""));
  }, [bars, progression, settings.beatsPerBar]);

  const nameFor = (kind: TrackKind) => {
    const base = KIND_LABELS[kind];
    const same = tracks.filter((t) => t.kind === kind).length;
    return same ? `${base} ${same + 1}` : base;
  };

  const onRecord = () => {
    if (phase === "recording" && recording?.master) void engine.stopMaster();
    else if (recordingNow) engine.cancelRecording();
    else if (!hasLoop) void engine.recordMaster(newKind, nameFor(newKind));
    else void engine.recordOverdub(newKind, nameFor(newKind));
  };

  const recordLabel = recordingNow
    ? recording?.master && phase === "recording"
      ? "■ Stop & loop"
      : "■ Cancel take"
    : hasLoop
      ? "● Record new line"
      : "● Record first line";

  const gateOptions: { value: GateLevel; label: string }[] = [
    { value: "off", label: "Off" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];
  const focusKind: TrackKind = recording?.kind ?? newKind;

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Looper"
        meta={<Badge tone="neutral">Recordings stay in your browser and are not uploaded</Badge>}
      >
        <div className="flex flex-col gap-5">
          <p className="text-sm leading-relaxed text-[var(--color-ink-dim)]">
            Record a line, and it loops. Add more lines on top: a bass, a fill, a melody. Everything stays in time, and you
            can mute, fix or redo any line without touching the others. Recordings vanish if you refresh the page, so
            download anything you want to keep.
          </p>

          {/* ---------------- transport */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={recordingNow ? "danger" : "primary"} size="lg" onClick={onRecord}>
              {recordLabel}
            </Button>
            {!hasLoop && !recordingNow && (
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as TrackKind)}
                aria-label="Type of the first line"
                className="h-12 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-sm"
              >
                {(Object.keys(KIND_LABELS) as TrackKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            )}
            {hasLoop && (
              <>
                {running ? (
                  <Button size="lg" onClick={() => engine.pause()}>
                    ⏸ Pause
                  </Button>
                ) : (
                  <Button size="lg" variant="primary" onClick={() => engine.startPlayback()} disabled={recordingNow}>
                    ▶ Play
                  </Button>
                )}
                <Button size="lg" onClick={() => engine.stop()}>
                  ■ Stop
                </Button>
                <Button size="lg" variant="ghost" onClick={() => engine.restart()} disabled={recordingNow}>
                  ↺ Restart
                </Button>
              </>
            )}
            <span className="mx-1 hidden h-8 w-px bg-[var(--color-hairline)] sm:block" />
            <Button size="sm" variant="ghost" onClick={() => engine.undo()} disabled={!state.canUndo || recordingNow}>
              ↶ Undo
            </Button>
            <Button size="sm" variant="ghost" onClick={() => engine.redo()} disabled={!state.canRedo || recordingNow}>
              ↷ Redo
            </Button>
          </div>

          {/* ---------------- status */}
          <div className="flex min-h-[72px] flex-wrap items-center gap-6 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] px-4 py-3">
            {phase === "counting" && recording ? (
              <div className="flex items-center gap-4">
                <CountIn engine={engine} start={recording.startsAt} beat={recording.beatSeconds} />
                <span className="text-sm text-[var(--color-ink-dim)]">Get ready…</span>
              </div>
            ) : phase === "recording" ? (
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 animate-pulse rounded-full bg-[var(--color-error)]" />
                <span className="text-sm font-medium">{recording?.master ? "Recording: press Stop when your line is done" : `Recording ${recording?.name ?? "line"}`}</span>
              </div>
            ) : (
              <div>
                <p className="hud-label">
                  Position{running ? <span className="ml-2 rounded-full border border-[var(--color-signal)] px-1.5 py-0.5 text-[9px] text-[var(--color-signal)]">LOOP ON</span> : null}
                </p>
                <p className="readout text-xl">
                  {clock.bar > 0 ? `Bar ${clock.bar} / ${clock.totalBars} · Beat ${clock.beat}` : hasLoop ? `${Math.round(bars ?? 0)} bars` : "No loop yet"}
                </p>
              </div>
            )}
            {currentChord && (
              <div>
                <p className="hud-label">Chord</p>
                <p className="readout text-xl text-[var(--color-signal)]">{currentChord.symbol}</p>
              </div>
            )}
            {hasLoop && loopSeconds && (
              <div>
                <p className="hud-label">Loop</p>
                <p className="readout text-sm text-[var(--color-ink-dim)]">
                  {loopSeconds.toFixed(1)} s · {settings.loopMode === "musical" ? "whole bars" : "free length"}
                </p>
              </div>
            )}
            {state.error && <p className="text-sm text-[var(--color-error)]">{state.error}</p>}
          </div>

          {/* ---------------- tempo */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Field label={`Tempo · ${shownBpm} BPM`}>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={40}
                  max={220}
                  value={shownBpm}
                  disabled={locked || recordingNow}
                  onChange={(e) => setBpm(Number(e.target.value))}
                  aria-label="Tempo"
                  className="min-w-0 flex-1 accent-[var(--color-signal)] disabled:opacity-40"
                />
                <Button
                  size="sm"
                  disabled={locked || recordingNow}
                  onClick={() => {
                    const estimate = tap.current.tap(performance.now() / 1000);
                    if (estimate) setBpm(estimate);
                  }}
                >
                  TAP
                </Button>
              </div>
              {locked && <span className="text-[11px] text-[var(--color-ink-faint)]">Locked to the loop. Clear all to change it.</span>}
            </Field>
            <Field label="Time signature">
              <select
                value={timeSignature.beats}
                disabled={locked || recordingNow}
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
            <Field label="Count-in">
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
                  { value: "musical", label: "Whole bars", hint: "Rounds your first take to whole bars: forgiving and in time with the click" },
                  { value: "free", label: "Free", hint: "Uses exactly what you recorded; the click turns off after the first take" },
                ]}
                value={settings.loopMode}
                onChange={(v) => !locked && engine.configure({ loopMode: v as "musical" | "free" })}
              />
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-ink-dim)]">
            <input
              type="checkbox"
              checked={settings.metronome}
              onChange={(e) => engine.configure({ metronome: e.target.checked })}
              className="accent-[var(--color-signal)]"
            />
            Metronome click while looping
          </label>
        </div>
      </Panel>

      {/* ---------------- input */}
      <Panel
        title="Input and noise control"
        meta={
          !state.inputReady ? (
            <Button size="sm" variant="primary" onClick={() => void engine.enableInput()}>
              Enable input
            </Button>
          ) : (
            <Badge tone="theory">input on</Badge>
          )
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Input">
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
              <SegmentedControl
                size="sm"
                options={gateOptions}
                value={settings.gate}
                onChange={(v) => engine.configure({ gate: v })}
              />
              <span className="text-[11px] text-[var(--color-ink-faint)]">
                {GATE_THRESHOLDS[settings.gate] === 0 ? "Everything passes." : "Quiet hiss and hum between notes is silenced. Raise it if noise is still heard."}
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
            <Field label="Level">
              <Meter engine={engine} active={state.inputReady} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Toggle label="Hear myself (use headphones)" checked={settings.monitor} onChange={(v) => engine.configure({ monitor: v })} />
            <Toggle label="Gentle compressor" checked={settings.compressor} onChange={(v) => engine.configure({ compressor: v })} />
            <button className="text-xs underline text-[var(--color-ink-faint)]" onClick={() => setAdvanced((v) => !v)}>
              {advanced ? "Hide" : "Timing"} adjustment
            </button>
          </div>
          {advanced && (
            <Field label={`Latency compensation · ${settings.latencyMs} ms`}>
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
                Recorded lines arrive a little late (your interface and the browser add delay). This shifts them back in time. If a new line sounds behind the beat, raise it; if it is ahead, lower it.
              </span>
            </Field>
          )}
          <p className="text-[11px] text-[var(--color-ink-faint)]">
            A high-pass filter always removes low rumble. The gate and compressor are gentle and leave the tone alone. Audio is
            processed in your browser only.
          </p>
        </div>
      </Panel>

      {/* ---------------- tracks */}
      <Panel
        title="Lines"
        meta={
          hasLoop ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as TrackKind)}
                aria-label="Type of the next line"
                className="h-8 rounded-lg border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-2 text-xs"
              >
                {(Object.keys(KIND_LABELS) as TrackKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="primary" onClick={onRecord} disabled={recordingNow}>
                + Add line
              </Button>
              <Button size="sm" onClick={() => { const bytes = engine.mixWav(1); if (bytes) download(bytes, "fretlight-mix.wav"); }}>
                ↓ Mix (1 loop)
              </Button>
              <Button size="sm" onClick={() => { const bytes = engine.mixWav(4); if (bytes) download(bytes, "fretlight-mix-x4.wav"); }}>
                ↓ Mix (4 loops)
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
          ) : undefined
        }
      >
        {!hasLoop ? (
          <p className="text-sm text-[var(--color-ink-dim)]">
            No lines yet. Press <span className="font-medium text-[var(--color-ink)]">Record first line</span>, play your chords, then press Stop. Your line
            becomes the loop, and you can add lines on top.
          </p>
        ) : (
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
        )}
      </Panel>

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
          bpm={bpm}
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
