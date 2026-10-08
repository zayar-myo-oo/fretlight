"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnalyzeMode } from "@/components/fretboard/modes/AnalyzeMode";
import { ExploreMode } from "@/components/fretboard/modes/ExploreMode";
import { ListenMode } from "@/components/fretboard/modes/ListenMode";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useFretboardContext } from "@/hooks/useFretboard";
import { detectionHub } from "@/lib/audio/detection-hub";
import { useSession } from "@/store/session";

type Mode = "explore" | "analyze" | "listen";

const MODES: readonly { value: Mode; label: string; hint: string; blurb: string }[] = [
  {
    value: "explore",
    label: "Explore",
    hint: "Pick a scale or chord and see it on the neck",
    blurb: "Pick a scale or chord and see it on the neck.",
  },
  {
    value: "analyze",
    label: "Analyze",
    hint: "Tap notes to find the key, scale and chords",
    blurb: "Tap notes on the neck to find the key, then explore its scale and chords.",
  },
  {
    value: "listen",
    label: "Listen",
    hint: "Play your instrument and see what it hears",
    blurb: "Plug in or use a mic and see which chord or note you're playing.",
  },
];

function parseMode(value: string | null): Mode {
  return value === "analyze" || value === "listen" ? value : "explore";
}

export default function FretboardPage() {
  // useSearchParams needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <FretboardShell />
    </Suspense>
  );
}

function FretboardShell() {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(() => parseMode(params.get("mode")));
  const { board, instrumentName } = useFretboardContext();
  const instrumentId = useSession((s) => s.instrumentId);

  // Whatever the mode, the detector must know which instrument and tuning it is hearing.
  useEffect(() => {
    detectionHub.setFretboard(board, instrumentId);
  }, [board, instrumentId]);

  // Keep the URL shareable without triggering a navigation.
  const change = useCallback((next: Mode) => {
    setMode(next);
    const url = new URL(window.location.href);
    if (next === "explore") url.searchParams.delete("mode");
    else url.searchParams.set("mode", next);
    window.history.replaceState(null, "", url);
  }, []);

  const current = MODES.find((m) => m.value === mode)!;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Fretboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-dim)]">{current.blurb}</p>
          <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
            {instrumentName} · {board.tuning.name}{" "}
            <Link href="/" className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-ink-dim)]">
              change
            </Link>
          </p>
        </div>
        <SegmentedControl
          options={MODES.map(({ value, label, hint }) => ({ value, label, hint }))}
          value={mode}
          onChange={change}
        />
      </header>

      {mode === "explore" && <ExploreMode />}
      {mode === "analyze" && <AnalyzeMode />}
      {mode === "listen" && <ListenMode />}
    </div>
  );
}
