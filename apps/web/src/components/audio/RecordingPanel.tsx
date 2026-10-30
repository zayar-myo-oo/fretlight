"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Fretboard } from "@/components/fretboard/Fretboard";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { useFretboardContext } from "@/hooks/useFretboard";
import { sharedInput } from "@/lib/audio/shared-input";
import { detectionMarkers } from "@/lib/audio/detection-markers";
import { deleteSession, downloadBlob, eventAt, exportEvents, listSessions, sessionRecorder, SERVER_RECORDER_STATE, type RecordedSession } from "@/lib/audio/session-recording";

export function RecordingPanel() {
  const { board } = useFretboardContext();
  const state = useSyncExternalStore(sessionRecorder.subscribe, sessionRecorder.getSnapshot, () => SERVER_RECORDER_STATE);
  const contextState = useSyncExternalStore(sharedInput.subscribe, () => sharedInput.current?.context.state ?? "off", () => "off");
  const [history, setHistory] = useState<RecordedSession[]>([]);
  const [selected, setSelected] = useState<RecordedSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
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
    setUrl(objectUrl); setSeconds(0);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selected]);
  useEffect(() => {
    let id = 0;
    const tick = () => { if (audio.current) setSeconds(audio.current.currentTime); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(id); void sessionRecorder.stop("Left recording screen").catch(() => {}); };
  }, []);
  const current = selected ? eventAt(selected.events, seconds) : null;
  const label = current?.kind === "chord" ? current.chord?.symbol ?? "No confident chord" : current?.midi != null ? `${current.frequency?.toFixed(1)} Hz · ${Math.round(current.confidence * 100)}% confidence` : "No confident note";
  return <Panel title="Record & replay">
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--color-ink-dim)]">Record the connected input and detected notes or chords together. Takes stay in this browser. Up to five minutes per take; changing input or listening mode ends the take.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={state.saving || contextState !== "running" && !state.recording} variant="primary" onClick={() => {
          setError(null); audio.current?.pause();
          try { if (state.recording) void sessionRecorder.stop().catch((e) => setError(String(e))); else sessionRecorder.start(board); }
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
        <audio ref={audio} src={url || undefined} controls className="w-full" onSeeked={(e) => setSeconds(e.currentTarget.currentTime)} onTimeUpdate={(e) => setSeconds(e.currentTarget.currentTime)} onEnded={() => setSeconds(selected.duration)} />
        <p className="readout text-sm">{seconds.toFixed(2)}s · {label}</p>
        <Fretboard board={selected.board} toFret={12} markers={detectionMarkers(selected.board, seconds >= selected.duration ? null : current)} />
        <p className="text-xs text-[var(--color-ink-faint)]">{selected.board.tuning.name}. Note markers show possible positions for the detected octave. Chord markers show chord-tone locations, not measured fingering. Events follow detection decisions; input and codec delay have not been calibrated.</p>
        <p className="text-xs">{selected.stopReason}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => downloadBlob(selected.audio, `${selected.id}.${selected.audio.type.includes("mp4") ? "m4a" : selected.audio.type.includes("ogg") ? "ogg" : "webm"}`)}>Export audio</Button>
          <Button size="sm" onClick={() => exportEvents(selected)}>Export timeline JSON</Button>
          <Button size="sm" onClick={() => { void deleteSession(selected.id).then(() => { setHistory((items) => items.filter((s) => s.id !== selected.id)); sessionRecorder.forget(selected.id); setSelected(null); }).catch((e) => setError(String(e))); }}>Delete take</Button>
        </div>
      </>}
    </div>
  </Panel>;
}
