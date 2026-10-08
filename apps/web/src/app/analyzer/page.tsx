"use client";

import {
  type AnalysisInstrument,
  type AnalysisProgress,
  type ChordDetection,
  type SongAnalysis,
  analyzeKey,
  buildChart,
  chordAt,
  editChord,
  formatTimestamp,
  sectionAt,
} from "@fretlight/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChordChart } from "@/components/analyzer/ChordChart";
import { ChordPanel } from "@/components/analyzer/ChordPanel";
import { LoadPanel } from "@/components/analyzer/LoadPanel";
import { Timeline } from "@/components/analyzer/Timeline";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { useSongPlayer } from "@/hooks/useSongPlayer";
import { type AnalysisJob, startAnalysis } from "@/lib/analyzer/analysis-client";
import { AnalyzerError, decodeToMono, hasSupportedExtension } from "@/lib/analyzer/audio-decoder";
import { bpmLabel, downloadJson, downloadPng, downloadText } from "@/lib/analyzer/export-chart";
import { loadFromUrl } from "@/lib/analyzer/song-source";

type Phase = "idle" | "decoding" | "analyzing" | "done";

const STAGE_LABEL: Record<AnalysisProgress["stage"], string> = {
  rhythm: "Analyzing rhythm…",
  chords: "Detecting chords…",
  sections: "Finding sections…",
  finalizing: "Finalizing…",
};

export default function AnalyzerPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [instrument, setInstrument] = useState<AnalysisInstrument>("guitar");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [analysis, setAnalysis] = useState<SongAnalysis | null>(null);
  const [chords, setChords] = useState<readonly ChordDetection[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [showOnBoard, setShowOnBoard] = useState(true);
  const job = useRef<AnalysisJob | null>(null);

  const player = useSongPlayer(blob);

  // Stop any running analysis if the page is left.
  useEffect(() => () => job.current?.cancel(), []);

  const run = useCallback(
    async (data: Blob, songName: string, which: AnalysisInstrument) => {
      job.current?.cancel();
      setError(null);
      setAnalysis(null);
      setChords([]);
      setSelected(null);
      setName(songName);
      setBlob(data);
      setPhase("decoding");
      setProgress(0.03);
      setStatus("Decoding…");
      try {
        // The bytes only live in this scope; once decoded they can be collected.
        const decoded = await decodeToMono(await data.arrayBuffer());
        setPhase("analyzing");
        const started = startAnalysis(decoded, which, (p) => {
          setProgress(0.1 + p.fraction * 0.9);
          setStatus(STAGE_LABEL[p.stage]);
        });
        job.current = started;
        const result = await started.result;
        setAnalysis(result);
        setChords(result.chords);
        setProgress(1);
        setPhase("done");
      } catch (e) {
        setBlob(null);
        setPhase("idle");
        setError(e instanceof AnalyzerError || e instanceof Error ? e.message : "Unable to read this audio file.");
      }
    },
    [],
  );

  const onFile = (file: File) => {
    if (!hasSupportedExtension(file.name) && !file.type.startsWith("audio/")) {
      setError("Unsupported file. Use MP3, WAV, M4A, OGG or WebM.");
      return;
    }
    void run(file, file.name, instrument);
  };

  const onUrl = async (url: string) => {
    setError(null);
    setPhase("decoding");
    setStatus("Fetching…");
    setProgress(0.02);
    try {
      const song = await loadFromUrl(url);
      await run(song.blob, song.name, instrument);
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Couldn't load that link.");
    }
  };

  const busy = phase === "decoding" || phase === "analyzing";
  const edited = chords.some((c) => c.edited);

  // The key is re-estimated from the chords once the user corrects any of them.
  const keyInfo = useMemo(() => {
    if (!analysis) return null;
    return edited ? (analyzeKey(chords).key ?? null) : analysis.keyInfo;
  }, [analysis, chords, edited]);

  const chart = useMemo(
    () => (analysis ? buildChart(chords, analysis.sections, analysis.bpm, analysis.beats) : []),
    [analysis, chords],
  );

  const activeChord = chordAt(chords, player.time);
  const activeSection = analysis ? sectionAt(analysis.sections, player.time) : -1;
  const shown = player.playing ? activeChord : (selected ?? activeChord);
  const anyChord = chords.some((c) => c.chord);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Song Analyzer</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-dim)]">
          Load a song and Fretlight estimates its key, tempo, sections and chords, then follows along as it plays.
        </p>
      </header>

      <LoadPanel
        busy={busy}
        instrument={instrument}
        onInstrument={(value) => {
          setInstrument(value);
          // Re-run on the same song with the other mode.
          if (blob && phase === "done") void run(blob, name, value);
        }}
        onFile={onFile}
        onUrl={(url) => void onUrl(url)}
        error={error}
      />

      {busy && (
        <Panel title="Working…">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-ink-dim)]">{phase === "decoding" ? status || "Decoding…" : status}</span>
              <span className="readout text-xs text-[var(--color-ink-faint)]">{Math.round(progress * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--color-void)]">
              <div
                className="h-full rounded-full bg-[var(--color-signal)] transition-[width] duration-200"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-[var(--color-ink-faint)]">Long songs take a little while. You can keep using the page.</p>
          </div>
        </Panel>
      )}

      {/* The element is always mounted so playback survives re-renders. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={player.audioRef} src={player.url ?? undefined} preload="auto" {...player.handlers} />

      {analysis && phase === "done" && (
        <>
          <Panel
            title="2 · Result"
            meta={
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">estimated</Badge>
                <ExportMenu
                  onText={() => downloadText(name, analysis, chords)}
                  onJson={() => downloadJson(name, analysis, chords)}
                  onPng={() => void downloadPng(name, analysis, chords)}
                />
              </div>
            }
          >
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="hud-label">Song</p>
                  <p className="text-lg font-semibold">{name}</p>
                </div>
                <Stat label="Key">
                  {keyInfo ? (
                    <>
                      {keyInfo.name}
                      {!edited && analysis.keyLevel && (
                        <span className="ml-2 text-xs text-[var(--color-ink-faint)]">{analysis.keyLevel} confidence</span>
                      )}
                    </>
                  ) : (
                    <span className="text-[var(--color-ink-faint)]">Key uncertain</span>
                  )}
                </Stat>
                <Stat label="BPM">{bpmLabel(analysis)}</Stat>
                <Stat label="Duration">{formatTimestamp(analysis.duration)}</Stat>
              </div>

              {!anyChord && (
                <p className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3 text-sm text-[var(--color-ink-dim)]">
                  No reliable chord progression detected. Try the other instrument mode, or a recording with clearer chords.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={player.toggle} aria-label={player.playing ? "Pause" : "Play"}>
                  {player.playing ? "❚❚ Pause" : "▶ Play"}
                </Button>
                <span className="readout text-sm tabular-nums">
                  {formatTimestamp(player.time)} / {formatTimestamp(analysis.duration)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={analysis.duration}
                  step={0.1}
                  value={player.time}
                  onChange={(e) => player.seek(Number(e.target.value))}
                  aria-label="Playback position"
                  className="min-w-[160px] flex-1 accent-[var(--color-signal)]"
                />
              </div>

              <Timeline
                duration={analysis.duration}
                time={player.time}
                sections={analysis.sections}
                chords={chords}
                keyInfo={keyInfo}
                activeChord={activeChord}
                onSeek={(t) => player.seek(t, true)}
                onSelectChord={setSelected}
              />

              <p className="text-[11px] text-[var(--color-ink-faint)]">
                {analysis.sections.length > 1 ? "Sections estimated from repeating audio, not lyrics. " : ""}
                Chords are estimates; tap one to hear it, see it on the neck, or correct it.
                {edited && (
                  <button className="ml-2 underline" onClick={() => setChords(analysis.chords)}>
                    Undo my corrections
                  </button>
                )}
              </p>
            </div>
          </Panel>

          <ChordChart
            chart={chart}
            chords={chords}
            keyInfo={keyInfo}
            activeChord={activeChord}
            activeSection={activeSection}
            onSeek={(t) => player.seek(t, true)}
            onSelectChord={setSelected}
          />

          <ChordPanel
            chord={shown >= 0 ? (chords[shown] ?? null) : null}
            keyInfo={keyInfo}
            showOnBoard={showOnBoard}
            onShowOnBoard={setShowOnBoard}
            live={player.playing}
            onEdit={(root, quality) => {
              if (shown >= 0) setChords((current) => editChord(current, shown, root, quality));
            }}
          />
        </>
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="hud-label">{label}</p>
      <p className="readout text-lg font-semibold">{children}</p>
    </div>
  );
}

function ExportMenu({ onText, onJson, onPng }: { onText: () => void; onJson: () => void; onPng: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="hud-label mr-1">Export</span>
      <Button size="sm" onClick={onPng}>
        PNG
      </Button>
      <Button size="sm" onClick={onText}>
        TXT
      </Button>
      <Button size="sm" onClick={onJson}>
        JSON
      </Button>
    </div>
  );
}
