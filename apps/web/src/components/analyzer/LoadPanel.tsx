"use client";

import type { AnalysisInstrument } from "@fretlight/core";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ACCEPT_ATTRIBUTE } from "@/lib/analyzer/audio-decoder";
import { YOUTUBE_MESSAGE, isYouTubeUrl } from "@/lib/analyzer/song-source";
import { cn } from "@/lib/ui/cn";

export function LoadPanel({
  busy,
  instrument,
  onInstrument,
  onFile,
  onUrl,
  error,
}: {
  busy: boolean;
  instrument: AnalysisInstrument;
  onInstrument: (value: AnalysisInstrument) => void;
  onFile: (file: File) => void;
  onUrl: (url: string) => void;
  error: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState("");
  const youtube = isYouTubeUrl(url);

  return (
    <Panel
      title="1 · Load a song"
      meta={
        <SegmentedControl
          size="sm"
          options={[
            { value: "guitar", label: "Guitar / chords", hint: "Detect chords from the whole mix" },
            { value: "bass", label: "Bass", hint: "Follow the bass notes and infer the chords" },
          ]}
          value={instrument}
          onChange={onInstrument}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = e.dataTransfer.files[0];
            if (file) onFile(file);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition-colors disabled:opacity-50",
            over
              ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.08)]"
              : "border-[var(--color-hairline-bright)] bg-[var(--color-void)] hover:border-[var(--color-signal)]",
          )}
        >
          <span className="text-sm font-medium">Select an audio file, or drop it here</span>
          <span className="text-xs text-[var(--color-ink-faint)]">MP3 · WAV · M4A · OGG · WebM</span>
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() && !youtube) onUrl(url);
          }}
        >
          <label className="flex min-w-[220px] flex-1 items-center gap-2">
            <span className="hud-label">or link</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… direct link to an audio file"
              disabled={busy}
              className="h-10 w-full rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)]"
            />
          </label>
          <Button type="submit" size="md" disabled={busy || !url.trim() || youtube}>
            Load link
          </Button>
        </form>

        {youtube && <p className="text-sm text-[var(--color-warning,#ffb454)]">{YOUTUBE_MESSAGE}</p>}
        {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}

        <p className="text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
          Audio is processed in your browser and is not uploaded or permanently stored. A song
          loaded from a link is fetched directly by your browser from that site.
        </p>
      </div>
    </Panel>
  );
}
