"use client";

import {
  CATEGORY_LABELS,
  type CompanionStyle,
  type Difficulty,
  type Fretboard as Board,
  type Idea,
  type Progression,
  STYLE_PROFILES,
  ideaTab,
} from "@fretlight/core";
import { useMemo, useRef, useState } from "react";
import { Fretboard } from "@/components/fretboard/Fretboard";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { buildIdeaEvents, playEvents, stopCompanion } from "@/lib/audio/companion-player";
import { ROLE_LABEL, ROLE_TONE, ideaMarkers } from "@/lib/companion/markers";
import { type SavedIdea, saveIdea } from "@/lib/companion/saved-ideas";
import { downloadAnalysisPng } from "@/lib/ui/export-analysis";
import { cn } from "@/lib/ui/cn";

const TONE_DOT: Record<string, string> = {
  root: "bg-[rgba(255,92,138,0.92)]",
  chord: "bg-[rgba(34,224,214,0.5)]",
  target: "bg-[rgba(34,224,214,0.95)]",
  scale: "bg-[rgba(139,124,255,0.5)]",
  played: "bg-[rgba(57,224,139,0.92)]",
};

export function IdeaView({
  ideas,
  board,
  progression,
  instrument,
  style,
  difficulty,
  progressionText,
  bpm,
  lowStringOnTop,
  onAnother,
  fillBeats,
  onFillBeats,
  onSaved,
}: {
  ideas: readonly Idea[];
  board: Board;
  progression: Progression;
  instrument: "guitar" | "bass";
  style: CompanionStyle;
  difficulty: Difficulty;
  progressionText: string;
  bpm: number;
  lowStringOnTop: boolean;
  onAnother: () => void;
  fillBeats: number;
  onFillBeats: (beats: number) => void;
  onSaved: (list: SavedIdea[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [showTab, setShowTab] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  const idea = ideas[Math.min(index, ideas.length - 1)];
  const isRhythm = idea?.category === "rhythm";
  const [chordFocus, setChordFocus] = useState(0);

  const markers = useMemo(
    () => (idea ? ideaMarkers(idea, { numbered: !isRhythm, ...(isRhythm ? { chordIndex: chordFocus } : {}) }) : []),
    [idea, isRhythm, chordFocus],
  );
  const path = useMemo(() => (idea && !isRhythm ? idea.notes.flatMap((n) => (n.position ? [n.position] : [])) : undefined), [idea, isRhythm]);
  const tab = useMemo(() => (idea ? ideaTab(board, idea) : []), [idea, board]);
  const rolesUsed = useMemo(() => [...new Set(markers.map((m) => m.tone))], [markers]);

  if (!idea) {
    return (
      <Panel title="Suggestion">
        <p className="text-sm text-[var(--color-ink-dim)]">
          No playable idea for this progression on this instrument. Try another style, difficulty or progression.
        </p>
      </Panel>
    );
  }

  const play = async (withProgression: boolean) => {
    const { events, seconds } = buildIdeaEvents(idea, progression, bpm, withProgression, board);
    setPlaying(true);
    await playEvents(events, seconds, () => setPlaying(false));
  };
  const stop = () => {
    stopCompanion();
    setPlaying(false);
  };

  const noteList = idea.notes.map((n) => n.name).join(" ");
  const isMelodic = !isRhythm;

  const saveCurrent = () => {
    const entry: SavedIdea = {
      id: `${Date.now()}`,
      savedAt: Date.now(),
      progression: progressionText,
      key: progression.key.key?.name ?? null,
      instrument,
      style,
      difficulty,
      category: idea.category,
      title: idea.title,
      notes: idea.notes.map((n) => n.name),
      tab,
      positions: idea.notes.flatMap((n) => (n.position ? [n.position] : [])),
      description: `${idea.what}. ${idea.why} ${idea.where}`,
    };
    const list = saveIdea(entry);
    if (list) {
      onSaved(list);
      setMessage("Saved on this device.");
    } else setMessage("Couldn't save: browser storage is unavailable.");
  };

  const saveImage = async () => {
    const svg = boardRef.current?.querySelector("svg");
    if (!svg) return;
    await downloadAnalysisPng({
      svg,
      title: `${idea.title}`,
      lines: [
        { label: "Progression", value: progression.chords.map((c) => c.symbol).join(" → ") },
        { label: "Key", value: progression.key.key?.name ?? "uncertain" },
        { label: "Style", value: `${STYLE_PROFILES[style].label} · ${instrument} · ${difficulty}` },
        { label: "Notes", value: noteList },
        ...(idea.target ? [{ label: "Target note", value: idea.target.name }] : []),
        { label: "Why", value: idea.why },
      ],
      preformatted: tab,
      filename: `fretlight-companion-${idea.category}.png`,
    });
  };

  return (
    <Panel
      title={`3 · ${CATEGORY_LABELS[idea.category]}`}
      meta={
        idea.category === "fills" ? (
          <label className="flex items-center gap-2 text-xs text-[var(--color-ink-dim)]">
            Length
            <select
              value={fillBeats}
              onChange={(e) => onFillBeats(Number(e.target.value))}
              className="h-8 rounded-lg border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-2 text-xs"
            >
              <option value={1}>1 beat</option>
              <option value={2}>2 beats</option>
              <option value={4}>1 bar</option>
              <option value={8}>2 bars</option>
            </select>
          </label>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {ideas.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {ideas.map((item, i) => (
              <button
                key={item.id}
                onClick={() => setIndex(i)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-left transition-colors",
                  i === index ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)]" : "border-[var(--color-hairline)] bg-[var(--color-void)] hover:border-[var(--color-hairline-bright)]",
                )}
              >
                <span className="block text-sm font-medium">{item.title}</span>
                <span className="readout text-[11px] text-[var(--color-ink-faint)]">{item.what.length > 34 ? `${item.what.slice(0, 34)}…` : item.what}</span>
              </button>
            ))}
          </div>
        )}

        <div>
          <h3 className="text-lg font-semibold">{idea.title}</h3>
          <p className="readout mt-1 text-xl text-[var(--color-signal)]">{idea.what}</p>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-5">
          <Row label="What">{isRhythm ? idea.what : `Play ${noteList}.`}</Row>
          <Row label="Why">{idea.why}</Row>
          <Row label="Where">{idea.where}</Row>
          {idea.target && isMelodic && <Row label="Target">{idea.target.name}</Row>}
          {idea.tip && <Row label="Tip">{idea.tip}</Row>}
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void play(false)}>
            ▶ Play
          </Button>
          <Button onClick={() => void play(true)}>▶ Play with progression</Button>
          {playing && (
            <Button variant="ghost" onClick={stop}>
              ■ Stop
            </Button>
          )}
          <Button variant="ghost" onClick={onAnother}>
            ⟳ Another version
          </Button>
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-dim)]">
            <input type="checkbox" checked={showTab} onChange={(e) => setShowTab(e.target.checked)} className="accent-[var(--color-signal)]" />
            Show tab
          </label>
        </div>

        {isRhythm && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-dim)]">
            Show shape for
            {progression.chords.map((c) => (
              <button
                key={c.index}
                onClick={() => setChordFocus(c.index)}
                className={cn("readout rounded-lg border px-2 py-1", c.index === chordFocus ? "border-[var(--color-signal)] text-[var(--color-ink)]" : "border-[var(--color-hairline)]")}
              >
                {c.symbol}
              </button>
            ))}
          </div>
        )}

        <div ref={boardRef}>
          <Fretboard board={board} markers={markers} {...(path && path.length > 1 ? { path } : {})} lowStringOnTop={lowStringOnTop} />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-[var(--color-ink-faint)]">
          {rolesUsed.map((tone) => {
            const role = (Object.keys(ROLE_TONE) as (keyof typeof ROLE_TONE)[]).find((r) => ROLE_TONE[r] === tone)!;
            return (
              <span key={tone} className="flex items-center gap-1.5">
                <span className={cn("h-2.5 w-2.5 rounded-full", TONE_DOT[tone])} />
                {ROLE_LABEL[role]}
              </span>
            );
          })}
          {isMelodic && <span>Numbers show the order to play.</span>}
        </div>

        {showTab && (
          <div>
            <p className="hud-label mb-1.5">Tab</p>
            <pre className="readout overflow-x-auto rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3 text-xs leading-relaxed">{tab.join("\n")}</pre>
            {idea.pattern && (
              <pre className="readout mt-2 overflow-x-auto rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3 text-xs leading-relaxed">{idea.pattern.join("\n")}</pre>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={saveCurrent}>
            Save idea
          </Button>
          <Button size="sm" onClick={() => void saveImage()}>
            Save image
          </Button>
          {message && <span className="text-xs text-[var(--color-ink-dim)]">{message}</span>}
        </div>
      </div>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="hud-label pt-0.5">{label}</dt>
      <dd className="text-[var(--color-ink-dim)]">{children}</dd>
    </>
  );
}
