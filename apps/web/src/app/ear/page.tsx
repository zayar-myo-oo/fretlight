"use client";

import { CHORDS, type ChordId, type EarLevel, type EarModule, type EarQuestion, earIntervalName, earQuestion, weakestEarItems } from "@fretlight/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useMounted } from "@/hooks/useMounted";
import { playEvents } from "@/lib/audio/companion-player";
import { useTx } from "@/lib/i18n/locale";
import { cn } from "@/lib/ui/cn";
import { useEarTraining } from "@/store/ear-training";

const labelFor = (key: string) => {
  const [module, id] = key.split(":");
  return module === "interval" ? earIntervalName(Number(id)) : (CHORDS[id as ChordId]?.name ?? id ?? key);
};

/** Hear it, name it. Intervals and chord types, three levels, scores kept on this device. */
export default function EarTrainingPage() {
  const x = useTx();
  const mounted = useMounted();
  const [module, setModule] = useState<EarModule>("interval");
  const [level, setLevel] = useState<EarLevel>("beginner");
  const [question, setQuestion] = useState<EarQuestion | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [run, setRun] = useState({ asked: 0, right: 0, streak: 0 });
  const tallies = useEarTraining((s) => s.tallies);
  const record = useEarTraining((s) => s.record);

  const play = useCallback(async (q: EarQuestion) => {
    // playEvents drops a play that was replaced while samples were still loading, so a
    // quick "Play again" never stacks two copies.
    await playEvents(q.midi.map((midi, i) => ({ midi, at: q.harmonic ? i * 0.015 : i * 0.7 })), 2);
  }, []);

  const next = useCallback(() => {
    const q = earQuestion(module, level);
    setQuestion(q);
    setPicked(null);
    void play(q);
  }, [module, level, play]);

  // A new module or level means a fresh question; the old one may not be a valid choice any more.
  useEffect(() => {
    setQuestion(null);
    setPicked(null);
  }, [module, level]);

  const answer = (id: string) => {
    if (!question || picked) return;
    const correct = id === question.answer;
    setPicked(id);
    record(`${question.module}:${question.answer}`, correct);
    setRun((r) => ({ asked: r.asked + 1, right: r.right + (correct ? 1 : 0), streak: correct ? r.streak + 1 : 0 }));
  };

  const weak = useMemo(() => (mounted ? weakestEarItems(tallies).slice(0, 4) : []), [mounted, tallies]);
  const right = picked !== null && question !== null && picked === question.answer;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{x("Ear Training")}</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
          {x("Listen, then name what you heard. Training your ear makes it easier to find notes, learn songs by ear and improvise.")}
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <SegmentedControl<EarModule>
          options={[
            { value: "interval", label: x("Intervals") },
            { value: "chord", label: x("Chord types") },
          ]}
          value={module}
          onChange={setModule}
        />
        <SegmentedControl<EarLevel>
          options={[
            { value: "beginner", label: x("Beginner") },
            { value: "intermediate", label: x("Intermediate") },
            { value: "advanced", label: x("Advanced") },
          ]}
          value={level}
          onChange={setLevel}
        />
      </div>

      <Panel title={module === "interval" ? x("Which interval is this?") : x("Which chord type is this?")}>
        {!question ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-[var(--color-ink-dim)]">
              {module === "interval"
                ? x("You will hear two notes. Name the distance between them.")
                : x("You will hear one chord. Name its type: major, minor and so on.")}
            </p>
            <Button size="lg" variant="primary" className="min-h-12" onClick={next}>
              {x("▶ Start")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => void play(question)}>
                {x("▶ Play again")}
              </Button>
              {question.module === "interval" && (
                <span className="text-xs text-[var(--color-ink-faint)]">{question.harmonic ? x("Played together") : x("Played one after the other")}</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label={x("Answers")}>
              {question.choices.map((choice) => {
                const isAnswer = picked !== null && choice.id === question.answer;
                const isWrongPick = picked === choice.id && choice.id !== question.answer;
                return (
                  <button
                    key={choice.id}
                    onClick={() => answer(choice.id)}
                    disabled={picked !== null}
                    className={cn(
                      "min-h-12 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                      isAnswer && "border-[#39e08b] bg-[rgba(57,224,139,0.14)] text-[#39e08b]",
                      isWrongPick && "border-[var(--color-error)] bg-[rgba(255,84,112,0.12)] text-[var(--color-error)]",
                      !isAnswer && !isWrongPick && "border-[var(--color-hairline)] bg-[var(--color-void)] hover:border-[var(--color-hairline-bright)] disabled:opacity-60",
                    )}
                  >
                    {isAnswer ? "✓ " : isWrongPick ? "✗ " : ""}
                    {x(choice.label)}
                  </button>
                );
              })}
            </div>

            {picked !== null && (
              <div className="flex flex-wrap items-center gap-3" role="status">
                <span className={cn("text-sm font-medium", right ? "text-[#39e08b]" : "text-[var(--color-error)]")}>
                  {right ? x("Correct!") : x("Not quite. It was {answer}.", { answer: x(question.choices.find((c) => c.id === question.answer)?.label ?? "") })}
                </span>
                <Button variant="primary" onClick={next}>
                  {x("Next →")}
                </Button>
              </div>
            )}

            <p className="readout text-xs text-[var(--color-ink-faint)]">
              {x("This session: {right} / {asked} · streak {streak}", { right: run.right, asked: run.asked, streak: run.streak })}
            </p>
          </div>
        )}
      </Panel>

      <Panel title={x("Your weak spots")}>
        {weak.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-dim)]">
            {x("Not enough answers yet. After a few rounds, the sounds you mix up most will show here.")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {weak.map((item) => (
              <li key={item.key} className="flex items-center justify-between rounded-xl border border-[var(--color-hairline)] px-3 py-2 text-sm">
                <span>{x(labelFor(item.key))}</span>
                <span className="readout text-[var(--color-error)]">{Math.round(item.accuracy * 100)}%</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
