"use client";

import {
  type ChordMatch,
  BASS_CATEGORIES,
  CATEGORY_LABELS,
  type CompanionStyle,
  DIFFICULTIES,
  type Difficulty,
  GUITAR_CATEGORIES,
  type IdeaCategory,
  STYLE_IDS,
  coreTriad,
  chordPitchClasses,
  generateIdeas,
  progressionFromText,
  spellPitchClass,
  targetNotes,
} from "@fretlight/core";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LiveChordPanel } from "@/components/audio/LiveChordPanel";
import { IdeaView } from "@/components/companion/IdeaView";
import { LearningGuide } from "@/components/companion/LearningGuide";
import { LooperPanel } from "@/components/looper/LooperPanel";
import { SoundMenu } from "@/components/fretboard/SoundMenu";
import { Button } from "@/components/ui/Button";
import { PracticePanel } from "@/components/companion/PracticePanel";
import { ProgressionPanel } from "@/components/companion/ProgressionPanel";
import { SavedIdeas } from "@/components/companion/SavedIdeas";
import { ChordTonesView, CowboyView, TriadsView } from "@/components/companion/TheoryViews";
import { Panel } from "@/components/ui/Panel";
import { useCompanionBoard } from "@/hooks/useCompanionBoard";
import { useFretboardContext } from "@/hooks/useFretboard";
import { stopCompanion } from "@/lib/audio/companion-player";
import { type SavedIdea, loadSavedIdeas } from "@/lib/companion/saved-ideas";
import { cn } from "@/lib/ui/cn";
import { useSession } from "@/store/session";

type View = "tones" | "triads" | "cowboy" | IdeaCategory;

const GUITAR_VIEWS: { view: View; label: string }[] = [
  { view: "tones", label: "Chord tones" },
  { view: "triads", label: "Triads" },
  { view: "cowboy", label: "Cowboy chords" },
  { view: "lead", label: "Lead melody" },
  { view: "fills", label: "Fills" },
  { view: "counter", label: "Counter melody" },
  { view: "rhythm", label: "Rhythm" },
];
const BASS_VIEWS: { view: View; label: string }[] = [
  { view: "tones", label: "Chord tones" },
  { view: "triads", label: "Triads" },
  ...BASS_CATEGORIES.map((view) => ({ view: view as View, label: CATEGORY_LABELS[view] })),
];

export default function CompanionPage() {
  return (
    <Suspense fallback={null}>
      <Companion />
    </Suspense>
  );
}

const isStyle = (v: string | null): v is CompanionStyle => !!v && (STYLE_IDS as string[]).includes(v);
const isDifficulty = (v: string | null): v is Difficulty => !!v && (DIFFICULTIES as readonly string[]).includes(v);

function Companion() {
  const params = useSearchParams();
  const { instrumentKind } = useFretboardContext();
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);

  const [text, setText] = useState(params.get("prog") || "C G Am F");
  const [instrument, setInstrument] = useState<"guitar" | "bass">(params.get("instrument") === "bass" ? "bass" : params.get("instrument") === "guitar" ? "guitar" : instrumentKind);
  const [style, setStyle] = useState<CompanionStyle>(isStyle(params.get("style")) ? (params.get("style") as CompanionStyle) : "popPunk");
  const [difficulty, setDifficulty] = useState<Difficulty>(isDifficulty(params.get("difficulty")) ? (params.get("difficulty") as Difficulty) : "intermediate");
  const [view, setView] = useState<View>("tones");
  const [selected, setSelected] = useState(0);
  const [variant, setVariant] = useState(0);
  const [fillBeats, setFillBeats] = useState(2);
  const [saved, setSaved] = useState<SavedIdea[]>([]);
  const [heard, setHeard] = useState<string[]>([]);
  const [follow, setFollow] = useState(false);
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const heardRef = useRef<string[]>([]);
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => setSaved(loadSavedIdeas()), []);
  useEffect(() => () => stopCompanion(), []);

  const board = useCompanionBoard(instrument);
  const progression = useMemo(() => progressionFromText(text), [text]);
  const chosen = Math.min(selected, Math.max(0, progression.chords.length - 1));
  const views = instrument === "bass" ? BASS_VIEWS : GUITAR_VIEWS;
  const activeView = views.some((v) => v.view === view) ? view : "tones";
  const isIdea = activeView !== "tones" && activeView !== "triads" && activeView !== "cowboy";

  const ideas = useMemo(
    () =>
      isIdea
        ? generateIdeas({ board, progression, instrument, style, difficulty, category: activeView as IdeaCategory, variant, fillBeats })
        : [],
    [isIdea, board, progression, instrument, style, difficulty, activeView, variant, fillBeats],
  );
  const practiceFills = useMemo(
    () => generateIdeas({ board, progression, instrument, style, difficulty, category: instrument === "bass" ? "bass-fills" : "fills", fillBeats: 2 }),
    [board, progression, instrument, style, difficulty],
  );

  useEffect(() => setVisited((v) => new Set(v).add(activeView)), [activeView]);

  // A chord heard through the microphone or interface joins the list; with "follow" on it becomes the progression.
  const onHeard = useCallback((match: ChordMatch) => {
    const list = heardRef.current;
    if (list[list.length - 1] === match.symbol) return;
    heardRef.current = [...list, match.symbol].slice(-16);
    setHeard(heardRef.current);
    if (followRef.current) {
      setText(heardRef.current.slice(-4).join(" "));
      setVariant(0);
    }
  }, []);

  const goGuide = (target: string) => {
    if (target === "practice") {
      setVisited((v) => new Set(v).add("practice"));
      document.getElementById("practice")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    choose(target as View);
    setTimeout(() => document.getElementById("ideas")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const choose = (next: View) => {
    stopCompanion();
    setView(next);
    setVariant(0);
  };

  const useSaved = (idea: SavedIdea) => {
    setText(idea.progression);
    setInstrument(idea.instrument);
    setStyle(idea.style);
    setDifficulty(idea.difficulty);
    setView(idea.category);
    setVariant(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const current = progression.chords[chosen];
  const summary = progression.chords.length ? targetNotes(progression)[chosen] : undefined;
  const triadQuality = current ? coreTriad(current.quality) : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Guitar &amp; Bass Companion</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-dim)]">
          Your bandmate is playing a progression. Type it in and get ideas that fit: which notes are strong, why they work,
          where they should land, and exactly where to play them.
          </p>
        </div>
        <SoundMenu />
      </header>

      <LearningGuide instrument={instrument} active={activeView} visited={visited} onGo={goGuide} />

      <ProgressionPanel
        text={text}
        onText={(value) => {
          stopCompanion();
          setText(value);
          setVariant(0);
        }}
        progression={progression}
        selected={chosen}
        onSelect={setSelected}
        instrument={instrument}
        onInstrument={(value) => {
          stopCompanion();
          setInstrument(value);
          setVariant(0);
        }}
        style={style}
        onStyle={(value) => {
          setStyle(value);
          setVariant(0);
        }}
        difficulty={difficulty}
        onDifficulty={(value) => {
          setDifficulty(value);
          setVariant(0);
        }}
      />

      <LooperPanel
        progression={progression}
        style={style}
        difficulty={difficulty}
        instrument={instrument}
        board={board}
        lowStringOnTop={lowStringOnTop}
        selectedChord={chosen}
      />

      <LiveChordPanel
        title="Or listen to your band"
        activeKey={progression.key.key}
        onChord={onHeard}
        footer={
          <div className="flex flex-col gap-3 border-t border-[var(--color-hairline)] pt-4">
            <p className="hud-label">Chords heard</p>
            {heard.length === 0 ? (
              <p className="text-xs text-[var(--color-ink-faint)]">
                Start listening and play or hum along; each new chord is added here. Then use them as the progression for ideas.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {heard.map((symbol, i) => (
                  <span key={`-`} className="readout rounded-lg border border-[var(--color-hairline)] bg-[var(--color-void)] px-2.5 py-1 text-sm">
                    {symbol}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" disabled={heard.length === 0} onClick={() => setText(heard.slice(-4).join(" "))}>
                Use last 4 as progression
              </Button>
              <Button size="sm" disabled={heard.length === 0} onClick={() => setText(heard.slice(-8).join(" "))}>
                Use last 8
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={heard.length === 0}
                onClick={() => {
                  heardRef.current = [];
                  setHeard([]);
                }}
              >
                Clear
              </Button>
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-dim)]">
                <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[var(--color-signal)]" />
                Follow live: always use the last 4 chords
              </label>
            </div>
          </div>
        }
      />

      {current && (
        <Panel title="How it fits together">
          <div className="flex flex-wrap items-stretch gap-1.5">
            <Chain label="Key" value={progression.key.key?.name ?? "uncertain"} />
            <Chain label="Scale" value={progression.key.key ? progression.key.key.notes.join(" ") : "–"} />
            <Chain label="Progression" value={progression.chords.map((c) => c.symbol).join(" ")} />
            <Chain label="Chord tones" value={current.names.join(" ")} onClick={() => choose("tones")} active={activeView === "tones"} />
            <Chain
              label="Triad"
              value={triadQuality ? chordPitchClasses(current.root, triadQuality).map((pc) => spellPitchClass(pc, progression.key.key)).join(" ") : "–"}
              onClick={() => choose("triads")}
              active={activeView === "triads"}
            />
            <Chain label="Target" value={summary?.target.name ?? "–"} onClick={() => choose("tones")} />
            <Chain label="Fill" value="into the next chord" onClick={() => choose(instrument === "bass" ? "bass-fills" : "fills")} active={activeView === "fills" || activeView === "bass-fills"} />
            <Chain label="Melody" value="through every chord" onClick={() => choose(instrument === "bass" ? "bass-melodic" : "lead")} active={activeView === "lead" || activeView === "bass-melodic"} />
          </div>
        </Panel>
      )}

      <div id="ideas" className="scroll-mt-20" />
      <Panel title="2 · What can I play?">
        <div className="flex flex-wrap gap-2">
          {views.map((item) => (
            <button
              key={item.view}
              onClick={() => choose(item.view)}
              className={cn(
                "rounded-xl border px-3.5 py-2 text-sm transition-colors",
                item.view === activeView
                  ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.12)] text-[var(--color-ink)]"
                  : "border-[var(--color-hairline)] bg-[var(--color-void)] text-[var(--color-ink-dim)] hover:border-[var(--color-hairline-bright)]",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Panel>

      {progression.chords.length === 0 ? null : (
        <>
          {activeView === "tones" && <ChordTonesView board={board} progression={progression} selected={chosen} lowStringOnTop={lowStringOnTop} />}
          {activeView === "triads" && (
            <TriadsView board={board} progression={progression} selected={chosen} lowStringOnTop={lowStringOnTop} onLead={() => choose(instrument === "bass" ? "bass-melodic" : "lead")} />
          )}
          {activeView === "cowboy" && (
            <CowboyView board={board} progression={progression} selected={chosen} lowStringOnTop={lowStringOnTop} onLead={() => choose("lead")} />
          )}
          {isIdea && (
            <IdeaView
              key={`${activeView}-${instrument}`}
              ideas={ideas}
              board={board}
              progression={progression}
              instrument={instrument}
              style={style}
              difficulty={difficulty}
              progressionText={text}
              bpm={100}
              lowStringOnTop={lowStringOnTop}
              onAnother={() => setVariant((v) => v + 1)}
              fillBeats={fillBeats}
              onFillBeats={setFillBeats}
              onSaved={setSaved}
            />
          )}
          <div id="practice" className="scroll-mt-20" />
          <PracticePanel progression={progression} board={board} fills={practiceFills} lowStringOnTop={lowStringOnTop} instrument={instrument} />
        </>
      )}

      <SavedIdeas ideas={saved} onChange={setSaved} onUse={useSaved} />
    </div>
  );
}

function Chain({ label, value, onClick, active }: { label: string; value: string; onClick?: () => void; active?: boolean }) {
  const content = (
    <>
      <span className="hud-label block">{label}</span>
      <span className="readout text-sm">{value}</span>
    </>
  );
  const base = "rounded-xl border px-3 py-2 text-left";
  return (
    <div className="flex items-center gap-1.5">
      {onClick ? (
        <button onClick={onClick} className={cn(base, "transition-colors", active ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)]" : "border-[var(--color-hairline)] bg-[var(--color-void)] hover:border-[var(--color-hairline-bright)]")}>
          {content}
        </button>
      ) : (
        <div className={cn(base, "border-[var(--color-hairline)] bg-[var(--color-void)]")}>{content}</div>
      )}
      <span className="text-[var(--color-ink-faint)] last:hidden">→</span>
    </div>
  );
}
