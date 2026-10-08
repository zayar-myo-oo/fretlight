"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/ui/cn";

export type GuideTarget = string;

interface Step {
  readonly view: GuideTarget;
  readonly title: string;
  readonly learn: string;
  readonly cta: string;
}

const GUITAR_STEPS: readonly Step[] = [
  { view: "cowboy", title: "Know your chords", learn: "Play each chord of the progression as an open shape. This is the foundation: you can hear the harmony before adding anything.", cta: "Open cowboy chords" },
  { view: "triads", title: "Find the triad inside", learn: "Every chord hides three strong notes: the root, 3rd and 5th. Learn where they sit on the neck, in three different orders.", cta: "Show triads" },
  { view: "tones", title: "Aim for the target note", learn: "When the chord changes, ending on the right note makes your line sound planned. See which note to aim for, and which notes the two chords share.", cta: "Show chord tones and targets" },
  { view: "fills", title: "Add a short fill", learn: "Fill the gap before a chord change with a few notes that start on the current chord and land on the next chord's target.", cta: "Try a fill" },
  { view: "lead", title: "Build a melody", learn: "Chain chord tones through every chord, joined by passing notes. This is the lead-guitar idea: land on triad notes instead of running up and down a scale.", cta: "Build a melody" },
  { view: "practice", title: "Practice over the loop", learn: "Let the progression repeat and improvise with the triad lit up. When it feels easy, switch on the fill, then take the highlights away.", cta: "Go to practice" },
];

const BASS_STEPS: readonly Step[] = [
  { view: "bass-root", title: "Lock in the roots", learn: "Play the root of each chord, held for the whole bar. This is the bass's main job: tell everyone which chord this is.", cta: "Play root notes" },
  { view: "bass-rootfifth", title: "Add the 5th", learn: "Root then 5th gives movement without ever sounding wrong, in major or minor.", cta: "Try root + 5th" },
  { view: "bass-passing", title: "Connect with passing notes", learn: "Chord tones go on the strong beats; short notes in between connect them.", cta: "Try passing notes" },
  { view: "bass-approach", title: "Lead into the next chord", learn: "A note a half step from the next root pulls the ear toward it. It is the simplest fill there is.", cta: "Try approach notes" },
  { view: "bass-walking", title: "Walk through the chords", learn: "Four even notes a bar that climb or fall through the chord and arrive on the next root.", cta: "Try walking bass" },
  { view: "practice", title: "Practice over the loop", learn: "Play along with the progression on repeat, and turn on the bass fill once the basic line feels solid.", cta: "Go to practice" },
];

const KEY = "fretlight.companion.guideHidden";

/**
 * A step-by-step route through the Companion, for people who are not sure where
 * to start. It follows the idea the whole screen is built on: chords, then the
 * triad inside, then the target note, then a fill, then a melody.
 */
export function LearningGuide({
  instrument,
  active,
  visited,
  onGo,
}: {
  instrument: "guitar" | "bass";
  active: string;
  visited: ReadonlySet<string>;
  onGo: (view: GuideTarget) => void;
}) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "1") setOpen(false);
    } catch {
      // keep it open when storage is unavailable
    }
  }, []);

  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      if (next) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, "1");
    } catch {
      // not persisted in private mode
    }
  };

  const steps = instrument === "bass" ? BASS_STEPS : GUITAR_STEPS;

  if (!open) {
    return (
      <div>
        <Button size="sm" variant="ghost" onClick={() => toggle(true)}>
          ? How do I learn with this?
        </Button>
      </div>
    );
  }

  return (
    <Panel
      title="How to learn with the Companion"
      meta={
        <Button size="sm" variant="ghost" onClick={() => toggle(false)}>
          Hide
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="max-w-3xl text-sm leading-relaxed text-[var(--color-ink-dim)]">
          Not sure where to start? Type the chords your band is playing (or listen to them below), then work down
          these steps one at a time. Each step builds on the one before it, and there is no need to do them all in one
          sitting.
        </p>
        <ol className="flex flex-col gap-2">
          {steps.map((step, i) => {
            const done = visited.has(step.view);
            const current = step.view === active;
            return (
              <li
                key={step.view + i}
                className={cn(
                  "flex flex-wrap items-start gap-3 rounded-xl border p-3 transition-colors",
                  current ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.06)]" : "border-[var(--color-hairline)] bg-[var(--color-void)]",
                )}
              >
                <span
                  className={cn(
                    "readout flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs",
                    done ? "border-[var(--color-correct,#39e08b)] text-[var(--color-correct,#39e08b)]" : "border-[var(--color-hairline-bright)] text-[var(--color-ink-faint)]",
                  )}
                  aria-label={done ? "visited" : `step ${i + 1}`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <div className="min-w-[220px] flex-1">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-dim)]">{step.learn}</p>
                </div>
                <Button size="sm" variant={current ? "primary" : "secondary"} onClick={() => onGo(step.view)}>
                  {step.cta}
                </Button>
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}
