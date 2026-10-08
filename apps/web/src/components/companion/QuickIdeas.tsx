"use client";

import {
  type CompanionStyle,
  type Difficulty,
  type Fretboard as Board,
  type Idea,
  type IdeaCategory,
  type Progression,
  generateIdeas,
  ideaTab,
} from "@fretlight/core";
import { useMemo, useState } from "react";
import { Fretboard } from "@/components/fretboard/Fretboard";
import { Button } from "@/components/ui/Button";
import { buildIdeaEvents, playEvents, stopCompanion } from "@/lib/audio/companion-player";
import { ideaMarkers } from "@/lib/companion/markers";
import { useTx } from "@/lib/i18n/locale";
import { cn } from "@/lib/ui/cn";

type Kind = "safe" | "melodic" | "interesting";

interface Pick {
  readonly kind: Kind;
  readonly idea: Idea;
}

const KIND_STYLE: Record<Kind, string> = {
  safe: "border-[#39e08b] text-[#39e08b]",
  melodic: "border-[var(--color-signal)] text-[var(--color-signal)]",
  interesting: "border-[var(--color-theory)] text-[var(--color-theory-bright)]",
};

const KIND_HINT: Record<Kind, string> = {
  safe: "Can't go wrong: chord tones only, few notes.",
  melodic: "A short line that leads into the next chord.",
  interesting: "More notes and colour. Try it once the safe one feels easy.",
};

/** The three ideas for the chosen chord change, from simplest to most adventurous. */
function pickIdeas(base: { board: Board; progression: Progression; instrument: "guitar" | "bass"; style: CompanionStyle }, chord: number): Pick[] {
  const make = (kind: Kind, category: IdeaCategory, difficulty: Difficulty, fillBeats: number, variant = 0): Pick | null => {
    const ideas = generateIdeas({ ...base, difficulty, category, fillBeats, variant });
    const idea = ideas.find((i) => i.fromChord === chord) ?? ideas[0];
    return idea ? { kind, idea } : null;
  };
  const list =
    base.instrument === "bass"
      ? [make("safe", "bass-root", "beginner", 2), make("melodic", "bass-approach", "intermediate", 2), make("interesting", "bass-walking", "advanced", 2)]
      : [make("safe", "fills", "beginner", 1), make("melodic", "fills", "intermediate", 2), make("interesting", "fills", "advanced", 4, 1)];
  return list.filter((p): p is Pick => p !== null);
}

/**
 * The beginner entry point of the Companion: one button, three playable
 * answers. Everything else on the page is the "more options" version of this.
 */
export function QuickIdeas({
  board,
  progression,
  selected,
  instrument,
  style,
  bpm,
  lowStringOnTop,
  onLooper,
  onPractice,
  onMore,
}: {
  board: Board;
  progression: Progression;
  selected: number;
  instrument: "guitar" | "bass";
  style: CompanionStyle;
  bpm: number;
  lowStringOnTop: boolean;
  onLooper: () => void;
  onPractice: () => void;
  onMore: () => void;
}) {
  const x = useTx();
  const [asked, setAsked] = useState(false);
  const [open, setOpen] = useState<Kind>("safe");
  const [view, setView] = useState<"fretboard" | "tab">("fretboard");

  const picks = useMemo(
    () => (asked && progression.chords.length ? pickIdeas({ board, progression, instrument, style }, selected) : []),
    [asked, board, progression, instrument, style, selected],
  );
  const current = progression.chords[selected];
  const next = progression.chords.length ? progression.chords[(selected + 1) % progression.chords.length] : undefined;

  if (!current || !next) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-hairline-bright)] p-6 text-center">
        <p className="text-base font-medium">{x("No progression yet.")}</p>
        <p className="mt-1 text-sm text-[var(--color-ink-dim)]">{x("Enter chords like C G Am F to get playable ideas.")}</p>
      </div>
    );
  }

  const hear = (idea: Idea, slow: boolean) => {
    stopCompanion();
    const { events, seconds } = buildIdeaEvents(idea, progression, slow ? Math.round(bpm * 0.6) : bpm, true, board);
    void playEvents(events, seconds);
  };

  const active = picks.find((p) => p.kind === open) ?? picks[0];

  return (
    <section aria-labelledby="quick-ideas" className="flex flex-col gap-4 rounded-2xl border border-[var(--color-signal)] bg-[rgba(34,224,214,0.04)] p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-baseline gap-5">
          <div>
            <p className="hud-label">{x("Now")}</p>
            <p className="readout text-4xl font-semibold text-[var(--color-signal)]">{current.symbol}</p>
          </div>
          <span aria-hidden className="text-2xl text-[var(--color-ink-faint)]">→</span>
          <div>
            <p className="hud-label">{x("Next")}</p>
            <p className="readout text-3xl text-[var(--color-ink-dim)]">{next.symbol}</p>
          </div>
        </div>
        <div className="flex min-w-[200px] flex-1 flex-col items-start gap-1">
          <h2 id="quick-ideas" className="sr-only">{x("What should I play?")}</h2>
          <Button size="lg" variant="primary" className="min-h-12 w-full sm:w-auto" onClick={() => setAsked(true)}>
            {asked ? x("⟳ Ask again for this chord") : x("What should I play?")}
          </Button>
          <span className="text-[11px] text-[var(--color-ink-faint)]">{x("Tap a chord above to choose which change to work on.")}</span>
        </div>
      </div>

      {asked && picks.length === 0 && <p className="text-sm text-[var(--color-ink-dim)]">{x("No playable idea for this progression on this instrument. Try another style, difficulty or progression.")}</p>}

      {picks.length > 0 && (
        <>
          <div role="tablist" aria-label={x("Suggestions")} className="grid gap-2 sm:grid-cols-3">
            {picks.map((pick) => (
              <button
                key={pick.kind}
                role="tab"
                aria-selected={active?.kind === pick.kind}
                onClick={() => setOpen(pick.kind)}
                className={cn(
                  "flex min-h-11 flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  active?.kind === pick.kind ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)]" : "border-[var(--color-hairline)] bg-[var(--color-void)] hover:border-[var(--color-hairline-bright)]",
                )}
              >
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase", KIND_STYLE[pick.kind])}>{x(pick.kind.toUpperCase())}</span>
                <span className="readout text-base">{x(pick.idea.what)}</span>
                <span className="text-[11px] text-[var(--color-ink-faint)]">{x(KIND_HINT[pick.kind])}</span>
              </button>
            ))}
          </div>

          {active && (
            <div className="flex flex-col gap-3" role="tabpanel">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" onClick={() => hear(active.idea, false)}>
                  {x("▶ Hear")}
                </Button>
                <Button onClick={() => hear(active.idea, true)}>{x("🐢 Slow")}</Button>
                <Button variant="ghost" onClick={() => setView(view === "tab" ? "fretboard" : "tab")}>
                  {view === "tab" ? x("Show fretboard") : x("Show tab")}
                </Button>
                <span className="mx-1 hidden h-6 w-px bg-[var(--color-hairline)] sm:block" />
                <Button size="sm" onClick={onPractice}>
                  {x("Practice it")}
                </Button>
                <Button size="sm" onClick={onLooper}>
                  {x("Play it over a loop →")}
                </Button>
              </div>

              {view === "tab" ? (
                <pre className="readout overflow-x-auto rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3 text-xs leading-relaxed">{ideaTab(board, active.idea).join("\n")}</pre>
              ) : (
                <Fretboard board={board} markers={ideaMarkers(active.idea, { numbered: true })} lowStringOnTop={lowStringOnTop} />
              )}

              <details className="group rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3">
                <summary className="cursor-pointer text-sm font-medium">{x("Why does this sound good?")}</summary>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-dim)]">{x(active.idea.why)}</p>
                <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-dim)]">{x(active.idea.where)}</p>
                <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                  {x("Avoid: holding a note that is not in {chord} on beat 1 of the new chord. It will clash with the band.", { chord: next.symbol })}
                </p>
              </details>
            </div>
          )}

          <button onClick={onMore} className="self-start text-xs text-[var(--color-ink-dim)] underline underline-offset-2 hover:text-[var(--color-ink)]">
            {x("More options: triads, melodies, rhythm, cowboy chords ↓")}
          </button>
        </>
      )}
    </section>
  );
}
