"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Fretboard } from "@/components/fretboard/Fretboard";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useFretboardContext } from "@/hooks/useFretboard";
import { sharedInput } from "@/lib/audio/shared-input";
import { detectionMarkers } from "@/lib/audio/detection-markers";
import { formatEventTime } from "@/lib/audio/live-interpreter";
import { deleteSession, downloadBlob, eventAt, exportEvents, listSessions, sessionRecorder, SERVER_RECORDER_STATE, type DetectionEvent, type RecordedSession } from "@/lib/audio/session-recording";

const LIMITS = [5, 15, 30] as const;

export function audioExtension(type: string): string {
  return type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
}

/** The latest note and latest chord at `t`, each read independently from the timeline. */
function stateAt(events: readonly DetectionEvent[], t: number) {
  return {
    note: eventAt(events.filter((e) => e.kind === "note"), t),
    chord: eventAt(events.filter((e) => e.kind === "chord"), t),
  };
}

export function RecordingPanel() {
  const { board } = useFretboardContext();
  const state = useSyncExternalStore(sessionRecorder.subscribe, sessionRecorder.getSnapshot, () => SERVER_RECORDER_STATE);
  const contextState = useSyncExternalStore(sharedInput.subscribe, () => sharedInput.current?.context.state ?? "off", () => "off");
  const [history, setHistory] = useState<RecordedSession[]>([]);
  const [selected, setSelected] = useState<RecordedSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<(typeof LIMITS)[number]>(15);
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [url, setUrl] = useState("");
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let active = true;
    listSessions().then((sessions) => { if (active) setHistory(sessions); }).catch(() => { if (active) setError("Session history is unavailable in this browser. New takes can still be exported."); });
    return () => { active = false; };
  }, [state.saving]);
  useEffect(() => { if (state.latest) setSelected(state.latest); }, [state.latest]);
  useEffect(() => {
    if (!selected) { setUrl(""); return; }
    const objectUrl = URL.createObjectURL(selected.audio);
    setUrl(objectUrl); setSeconds(0); setPlaying(false); setEnded(false);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selected]);
  useEffect(() => () => { void sessionRecorder.stop("Left recording screen").catch(() => {}); }, []);

  // The audio element is the clock. rAF only samples it, and only while playing.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const tick = () => { if (audio.current) setSeconds(audio.current.currentTime); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  const duration = selected?.duration ?? 0;
  const seek = (t: number) => {
    const el = audio.current; if (!el) return;
    el.currentTime = Math.max(0, Math.min(duration, t));
    setSeconds(el.currentTime); setEnded(false);
  };
  const stopPlayback = () => { audio.current?.pause(); seek(0); };

  const at = selected && !ended ? stateAt(selected.events, seconds) : { note: null, chord: null };
  const shown = at.chord?.kind === "chord" && at.chord.chord ? at.chord : at.note?.kind === "note" && at.note.midi !== null ? at.note : null;
  const label = !shown ? "—"
    : shown.kind === "chord" ? `${shown.chord!.symbol} · ${Math.round(shown.chord!.confidence * 100)}%`
    : `${shown.frequency?.toFixed(1)} Hz · ${Math.round(shown.confidence * 100)}%`;
  const ticks = selected?.events.filter((e) => (e.kind === "chord" ? !!e.chord : e.midi !== null)) ?? [];

  return <Panel title="Record & replay">
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--color-ink-dim)]">Record the connected input together with detected notes and chords. Takes stay in this browser and are never uploaded. Changing input ends the take.</p>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl size="sm" options={LIMITS.map((s) => ({ value: String(s) as `${typeof s}`, label: `${s}s` }))} value={String(limit) as `${typeof limit}`} onChange={(v) => setLimit(Number(v) as typeof limit)} />
        <Button disabled={state.saving || contextState !== "running" && !state.recording} variant="primary" onClick={() => {
          setError(null); audio.current?.pause();
          try { if (state.recording) void sessionRecorder.stop().catch((e) => setError(String(e))); else sessionRecorder.start(board, limit); }
          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        }}>{state.recording ? "Stop recording" : state.saving ? "Saving…" : "Record take"}</Button>
        {contextState !== "off" && contextState !== "running" && <Button onClick={() => void sharedInput.resume().catch((e) => setError(String(e)))}>Resume input</Button>}
        <span role="status" className="text-xs">{state.recording ? "Recording ●" : contextState === "off" ? "Connect input to record" : contextState}</span>
      </div>
      {(error || state.error) && <p role="alert" className="text-xs text-[var(--color-error)]">{error || state.error}</p>}
      <label className="text-xs">Session history
        <select className="ml-2 max-w-full rounded border p-2 bg-[var(--color-panel)]" value={selected?.id ?? ""} onChange={(e) => setSelected(history.find((s) => s.id === e.target.value) ?? (state.latest?.id === e.target.value ? state.latest : null))}>
          <option value="">Choose a take</option>
          {state.latest && !history.some((s) => s.id === state.latest!.id) && <option value={state.latest.id}>Latest take (export to keep)</option>}
          {history.map((s) => <option key={s.id} value={s.id}>{new Date(s.createdAt).toLocaleString()} · {s.duration.toFixed(1)}s</option>)}
        </select>
      </label>
      {selected && <>
        <audio
          ref={audio}
          src={url || undefined}
          preload="auto"
          onLoadedMetadata={(e) => {
            // Chrome reports Infinity for MediaRecorder WebM until it has scanned the file,
            // which breaks seeking. Forcing a seek past the end makes it compute the duration.
            const el = e.currentTarget;
            if (el.duration === Infinity) { el.currentTime = 1e101; el.addEventListener("timeupdate", () => { el.currentTime = 0; }, { once: true }); }
          }}
          onPlay={() => { setPlaying(true); setEnded(false); }}
          onPause={(e) => { setPlaying(false); setSeconds(e.currentTarget.currentTime); }}
          onSeeked={(e) => setSeconds(e.currentTarget.currentTime)}
          onEnded={() => { setPlaying(false); setEnded(true); setSeconds(duration); }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => { if (playing) audio.current?.pause(); else { if (ended) seek(0); void audio.current?.play().catch((e) => setError(String(e))); } }}>{playing ? "Pause" : "Play"}</Button>
          <Button size="sm" onClick={stopPlayback}>Stop</Button>
          <span className="readout text-sm">{formatEventTime(seconds)} / {formatEventTime(duration)} · {label}</span>
        </div>
        <div className="relative h-8">
          <input aria-label="Seek" type="range" min={0} max={duration || 0} step={0.01} value={Math.min(seconds, duration)} onChange={(e) => seek(Number(e.target.value))} className="absolute inset-x-0 top-1 z-10 w-full" />
          {duration > 0 && ticks.map((e, i) => (
            <span key={i} title={e.kind === "chord" ? e.chord!.symbol : `${e.frequency?.toFixed(1)} Hz`} className={`absolute bottom-0 h-2 w-0.5 ${e.kind === "chord" ? "bg-[var(--color-signal)]" : "bg-[var(--color-ink-dim)]"}`} style={{ left: `${(e.at / duration) * 100}%` }} />
          ))}
        </div>
        <Fretboard board={selected.board} toFret={12} markers={detectionMarkers(selected.board, shown)} />
        <p className="text-xs text-[var(--color-ink-faint)]">{selected.board.tuning.name}. Note markers show possible positions; chord markers show chord-tone locations, not a measured fingering. Event times are shifted by the estimated analysis delay{selected.latency ? ` (notes ${selected.latency.note * 1000} ms, chords ${Math.round(selected.latency.chord * 1000)} ms)` : ""}; device latency is not calibrated.</p>
        <p className="text-xs">{selected.stopReason} · {selected.audio.type || "unknown format"} · {(selected.audio.size / 1024).toFixed(0)} KB · {selected.events.length} events</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => downloadBlob(selected.audio, `${selected.id}.${audioExtension(selected.audio.type)}`)}>Export audio</Button>
          <Button size="sm" onClick={() => exportEvents(selected)}>Export timeline JSON</Button>
          <Button size="sm" onClick={() => { audio.current?.pause(); void deleteSession(selected.id).then(() => { setHistory((items) => items.filter((s) => s.id !== selected.id)); sessionRecorder.forget(selected.id); setSelected(null); }).catch((e) => setError(String(e))); }}>Delete take</Button>
        </div>
      </>}
    </div>
  </Panel>;
}
