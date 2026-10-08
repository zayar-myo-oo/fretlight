"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";

const STORAGE_KEY = "fretlight.introDismissed";

const FEATURES = [
  { href: "/tuner", title: "Tuner", text: "Tune your guitar or bass with a live needle." },
  { href: "/fretboard", title: "Fretboard", text: "See scales and chords on the neck, find the key of notes you pick, or play and see which chord you're playing." },
  { href: "/practice", title: "Practice", text: "Guided scale exercises. Play along and get scored on accuracy." },
  { href: "/analyzer", title: "Analyzer", text: "Load a song file and get its chords, key, tempo and sections, then follow along as it plays." },
  { href: "/companion", title: "Companion", text: "Type the chords your band is playing and get fills, melodies, triads and bass lines that fit." },
  { href: "/song", title: "Song", text: "Learn a piece phrase by phrase." },
  { href: "/bassline", title: "Bassline", text: "Turn a chord progression into a bassline to practise." },
  { href: "/metronome", title: "Metronome", text: "Keep time at any tempo." },
] as const;

const STEPS = [
  "Choose your instrument and tuning below.",
  "Open the Tuner and tune up.",
  "Open Fretboard or Practice and start playing. Tap the neck, or switch on your microphone or audio interface.",
] as const;

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(value: boolean): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: the intro simply shows again next visit.
  }
}

/**
 * Plain-language "what is this app for" on the home screen. Open on a first
 * visit; "Got it" folds it away and it can be reopened any time.
 */
export function AppIntro() {
  // Start closed so the server render and first paint match, then open on a first visit.
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setOpen(!readDismissed());
    setReady(true);
  }, []);

  if (!ready) return <div className="h-12" />;

  if (!open) {
    return (
      <div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            writeDismissed(false);
            setOpen(true);
          }}
        >
          ? What is Fretlight?
        </Button>
      </div>
    );
  }

  return (
    <Panel title="Welcome to Fretlight" className="animate-rise">
      <div className="flex flex-col gap-5">
        <p className="max-w-3xl text-sm leading-relaxed text-[var(--color-ink-dim)] md:text-base">
          Fretlight is a free practice companion for <strong className="text-[var(--color-ink)]">guitar and bass</strong>.
          It listens through your microphone or audio interface, works out what you&apos;re playing, and shows it on a
          fretboard, so you can tune up, learn scales and chords, and practise with feedback.
        </p>

        <div>
          <h3 className="hud-label mb-2.5">Get started in 3 steps</h3>
          <ol className="flex flex-col gap-2">
            {STEPS.map((step, i) => (
              <li key={step} className="flex items-start gap-3 text-sm text-[var(--color-ink-dim)]">
                <span className="readout flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-signal)] text-xs text-[var(--color-signal)]">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <h3 className="hud-label mb-2.5">What you can do</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Link
                key={f.href}
                href={f.href}
                className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3 transition-colors hover:border-[var(--color-hairline-bright)] hover:bg-[var(--color-panel-raised)]"
              >
                <span className="text-sm font-medium">{f.title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-ink-faint)]">{f.text}</span>
              </Link>
            ))}
          </div>
        </div>

        <p className="text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Private by design: your audio is analysed on this device and never recorded or uploaded. No account needed.
        </p>

        <div>
          <Button
            variant="primary"
            onClick={() => {
              writeDismissed(true);
              setOpen(false);
            }}
          >
            Got it
          </Button>
        </div>
      </div>
    </Panel>
  );
}
