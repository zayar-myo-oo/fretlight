"use client";

import {
  BASS_CATEGORIES,
  CATEGORY_LABELS,
  type ChordMatch,
  type CompanionStyle,
  DIFFICULTIES,
  type Difficulty,
  type IdeaCategory,
  STYLE_IDS,
  chordPitchClasses,
  coreTriad,
  generateIdeas,
  progressionFromText,
  spellPitchClass,
  targetNotes,
} from "@fretlight/core";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveChordPanel } from "@/components/audio/LiveChordPanel";
import { IdeaView } from "@/components/companion/IdeaView";
import { LearningGuide } from "@/components/companion/LearningGuide";
import { PracticePanel } from "@/components/companion/PracticePanel";
import { QuickIdeas } from "@/components/companion/QuickIdeas";
import { ProgressionPanel } from "@/components/companion/ProgressionPanel";
import { SavedIdeas } from "@/components/companion/SavedIdeas";
import { ChordTonesView, CowboyView, TriadsView } from "@/components/companion/TheoryViews";
import { SoundMenu } from "@/components/fretboard/SoundMenu";
import { LooperPanel } from "@/components/looper/LooperPanel";
import { RecordingBanner } from "@/components/looper/RecordingBanner";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { Panel } from "@/components/ui/Panel";
import { useCompanionBoard } from "@/hooks/useCompanionBoard";
import { useFretboardContext } from "@/hooks/useFretboard";
import { useLooper } from "@/hooks/useLooper";
import { stopCompanion } from "@/lib/audio/companion-player";
import { type SavedIdea, loadSavedIdeas } from "@/lib/companion/saved-ideas";
import { useTx } from "@/lib/i18n/locale";
import { cn } from "@/lib/ui/cn";
import { useSession } from "@/store/session";

type View = "tones" | "triads" | "cowboy" | IdeaCategory;
type Tab = "loop" | "ideas" | "listen";

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
const isTab = (v: string | null): v is Tab => v === "loop" || v === "ideas" || v === "listen";

function Companion() {
  const params = useSearchParams();
  const { instrumentKind } = useFretboardContext();
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);
  const { engine, state: looper } = useLooper();
  const x = useTx();

  const [tab, setTab] = useState<Tab>(() => {
    const requested = params.get("tab");
    return isTab(requested) ? requested : "ideas";
  });
  const [text, setText] = useState(params.get("prog") || "C G Am F");
  // The instrument is app-wide (Home, Tuner, Fretboard all share it), not a Companion-only setting.
  const instrument = instrumentKind;
  const setGlobalInstrument = useSession((s) => s.setInstrument);
  const setInstrument = useCallback(
    (kind: "guitar" | "bass") => {
      if (kind !== instrumentKind) setGlobalInstrument(kind === "bass" ? "bass-4" : "guitar-6");
    },
    [instrumentKind, setGlobalInstrument],
  );
  const setBpm = useSession((s) => s.setBpm);
  const sessionBpm = useSession((s) => s.bpm);
  // Links from the Analyzer / Bassline carry the instrument and tempo along.
  useEffect(() => {
    const wanted = params.get("instrument");
    if (wanted === "guitar" || wanted === "bass") setInstrument(wanted);
    const bpm = Number(params.get("bpm"));
    if (bpm >= 40 && bpm <= 240) setBpm(bpm);
    if (params.get("focus") === "practice") setTimeout(() => document.getElementById("practice")?.scrollIntoView({ behavior: "smooth" }), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [applied, setApplied] = useState(false);
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
  const recordingNow = looper.phase === "counting" || looper.phase === "recording";

  const ideas = useMemo(
    () =>
      isIdea && tab === "ideas"
        ? generateIdeas({ board, progression, instrument, style, difficulty, category: activeView as IdeaCategory, variant, fillBeats })
        : [],
    [isIdea, tab, board, progression, instrument, style, difficulty, activeView, variant, fillBeats],
  );
  const practiceFills = useMemo(
    () =>
      tab === "ideas"
        ? generateIdeas({ board, progression, instrument, style, difficulty, category: instrument === "bass" ? "bass-fills" : "fills", fillBeats: 2 })
        : [],
    [tab, board, progression, instrument, style, difficulty],
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

  const choose = (next: View) => {
    stopCompanion();
    setView(next);
    setVariant(0);
  };

  const goGuide = (target: string) => {
    if (target === "looper") {
      setVisited((v) => new Set(v).add("looper"));
      setTab("loop");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (target === "practice") {
      setVisited((v) => new Set(v).add("practice"));
      document.getElementById("practice")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    choose(target as View);
    setTimeout(() => document.getElementById("ideas-views")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const useSaved = (idea: SavedIdea) => {
    setText(idea.progression);
    setInstrument(idea.instrument);
    setStyle(idea.style);
    setDifficulty(idea.difficulty);
    setView(idea.category);
    setVariant(0);
    setTab("ideas");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const useHeard = (count: number) => {
    setText(heard.slice(-count).join(" "));
    setApplied(true);
  };

  const current = progression.chords[chosen];
  const summary = progression.chords.length ? targetNotes(progression)[chosen] : undefined;
  const triadQuality = current ? coreTriad(current.quality) : null;

  const tabOptions: { value: Tab; label: string; hint: string }[] = [
    { value: "loop", label: recordingNow ? "● Looper" : "Looper", hint: x("Record yourself, loop it, and add more lines") },
    { value: "ideas", label: x("Ideas"), hint: x("Triads, fills, melodies, rhythm and bass lines for your chords") },
    { value: "listen", label: x("Listen"), hint: x("Let the app hear your band's chords") },
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{x("Guitar & Bass Companion")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-dim)]">
            {x("Type the chords your band is playing, then practise over a loop, get ideas that fit, or let the app listen.")}
          </p>
        </div>
        <SoundMenu />
      </header>

      {/* Pinned while recording, whichever tab is open. */}
      {recordingNow && <RecordingBanner engine={engine} state={looper} onStop={() => (looper.phase === "recording" && looper.recording?.master ? void engine.stopMaster() : engine.cancelRecording())} />}

      <ProgressionPanel
        text={text}
        onText={(value) => {
          stopCompanion();
          setText(value);
          setVariant(0);
          setApplied(false);
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

      <div role="tablist" className="grid grid-cols-3 gap-2 rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-chassis)] p-1.5">
        {tabOptions.map((option) => (
          <button
            key={option.value}
            role="tab"
            aria-selected={tab === option.value}
            title={option.hint}
            onClick={() => setTab(option.value)}
            className={cn(
              "rounded-xl px-3 py-3 text-center transition-colors",
              tab === option.value
                ? "bg-[rgba(34,224,214,0.14)] text-[var(--color-ink)] shadow-[inset_0_0_0_1px_var(--color-signal)]"
                : "text-[var(--color-ink-dim)] hover:bg-[rgba(255,255,255,0.04)]",
            )}
          >
            <span className="block text-base font-semibold">{option.label}</span>
            <span className="mt-0.5 hidden text-[11px] font-normal text-[var(--color-ink-faint)] sm:block">{option.hint}</span>
          </button>
        ))}
      </div>

      {/* The looper stays mounted when hidden, so switching tabs never loses a recording. */}
      <div className={cn(tab !== "loop" && "hidden")}>
        <LooperPanel
          active={tab === "loop"}
          engine={engine}
          state={looper}
          progression={progression}
          style={style}
          difficulty={difficulty}
          instrument={instrument}
          board={board}
          lowStringOnTop={lowStringOnTop}
          selectedChord={chosen}
        />
      </div>

      {tab === "ideas" && (
        <div className="flex flex-col gap-6">
          <QuickIdeas
            board={board}
            progression={progression}
            selected={chosen}
            instrument={instrument}
            style={style}
            bpm={sessionBpm}
            lowStringOnTop={lowStringOnTop}
            onLooper={() => { setTab("loop"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            onPractice={() => goGuide("practice")}
            onMore={() => document.getElementById("ideas-views")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          />

          <LearningGuide instrument={instrument} active={activeView} visited={visited} onGo={goGuide} />

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] px-4 py-3 text-sm">
            <span className="min-w-[200px] flex-1 text-[var(--color-ink-dim)]">
              {x("Ideas work best over real music. Record {chords} in the Looper and play these on top.", { chords: progression.chords.map((c) => c.symbol).join(" ") || x("your chords") })}
            </span>
            <Button size="sm" onClick={() => { setTab("loop"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
              {x("Open the Looper →")}
            </Button>
          </div>

          {current && (
            <Disclosure
              title={x("How it fits together")}
              summary={`${progression.key.key?.name ?? x("key uncertain")} → ${progression.chords.map((c) => c.symbol).join(" ")} → ${x("triad → target → fill → melody")}`}
            >
              <div className="flex flex-wrap items-stretch gap-1.5">
                <Chain label={x("Key")} value={progression.key.key?.name ?? x("uncertain")} />
                <Chain label={x("Scale")} value={progression.key.key ? progression.key.key.notes.join(" ") : "–"} />
                <Chain label={x("Progression")} value={progression.chords.map((c) => c.symbol).join(" ")} />
                <Chain label={x("Chord tones")} value={current.names.join(" ")} onClick={() => choose("tones")} active={activeView === "tones"} />
                <Chain
                  label={x("Triad")}
                  value={triadQuality ? chordPitchClasses(current.root, triadQuality).map((pc) => spellPitchClass(pc, progression.key.key)).join(" ") : "–"}
                  onClick={() => choose("triads")}
                  active={activeView === "triads"}
                />
                <Chain label={x("Target")} value={summary?.target.name ?? "–"} onClick={() => choose("tones")} />
                <Chain label={x("Fill")} value={x("into the next chord")} onClick={() => choose(instrument === "bass" ? "bass-fills" : "fills")} active={activeView === "fills" || activeView === "bass-fills"} />
                <Chain label={x("Melody")} value={x("through every chord")} onClick={() => choose(instrument === "bass" ? "bass-melodic" : "lead")} active={activeView === "lead" || activeView === "bass-melodic"} />
              </div>
            </Disclosure>
          )}

          <div id="ideas-views" className="scroll-mt-20" />
          <Panel title={x("What can I play?")}>
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
                  {x(item.label)}
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
                  bpm={sessionBpm}
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
      )}

      {tab === "listen" && (
        <LiveChordPanel
          title={x("Let the app hear your chords")}
          activeKey={progression.key.key}
          onChord={onHeard}
          footer={
            <div className="flex flex-col gap-3 border-t border-[var(--color-hairline)] pt-4">
              <p className="hud-label">{x("Chords heard")}</p>
              {heard.length === 0 ? (
                <p className="text-xs text-[var(--color-ink-faint)]">
                  {x("Start listening and play. Each new chord is added here, then you can use them as your progression.")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {heard.map((symbol, i) => (
                    <span key={`${symbol}-${i}`} className="readout rounded-lg border border-[var(--color-hairline)] bg-[var(--color-void)] px-2.5 py-1 text-sm">
                      {symbol}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" disabled={heard.length === 0} onClick={() => useHeard(4)}>
                  {x("Use last 4 as my progression")}
                </Button>
                <Button size="sm" disabled={heard.length === 0} onClick={() => useHeard(8)}>
                  {x("Use last 8")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={heard.length === 0}
                  onClick={() => {
                    heardRef.current = [];
                    setHeard([]);
                    setApplied(false);
                  }}
                >
                  {x("Clear")}
                </Button>
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-dim)]">
                  <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[var(--color-signal)]" />
                  {x("Follow live: always use the last 4 chords")}
                </label>
              </div>
              {applied && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#39e08b] bg-[rgba(57,224,139,0.08)] px-4 py-3 text-sm">
                  <span className="text-[#39e08b]">{x("✓ Progression set to {chords}.", { chords: progression.chords.map((c) => c.symbol).join(" ") })}</span>
                  <Button size="sm" onClick={() => setTab("ideas")}>
                    {x("See ideas →")}
                  </Button>
                  <Button size="sm" onClick={() => setTab("loop")}>
                    {x("Record over it →")}
                  </Button>
                </div>
              )}
            </div>
          }
        />
      )}
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
