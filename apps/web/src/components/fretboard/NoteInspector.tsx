"use client";

import { type Chord, type Scale, harmonicFunctionOf, intervalName, midiToNote, mod } from "@fretlight/core";
import { Button } from "@/components/ui/Button";
import { fretSynth } from "@/lib/audio/fret-synth";
import { playChord, playScale } from "@/lib/audio/theory-player";

export interface InspectedNote {
  readonly string: number;
  readonly fret: number;
  readonly midi: number;
}

/**
 * What a tapped note *is* and why it matters: its name, its distance from the
 * root, its degree in the scale, and its job in the chord. The point is to turn
 * "a dot on the neck" into "the 3rd, the note that makes this chord minor".
 */
export function NoteInspector({
  note,
  scale,
  chord,
  kind,
  stringName,
  onClose,
}: {
  note: InspectedNote;
  scale: Scale;
  chord: Chord;
  kind: "scale" | "chord";
  stringName: string;
  onClose: () => void;
}) {
  const pc = mod(note.midi, 12);
  const named = midiToNote(note.midi);
  const root = kind === "scale" ? scale.root : chord.root;
  const rootName = kind === "scale" ? scale.rootName : chord.rootName;
  const interval = mod(pc - root, 12);
  const scaleNote = scale.notes.find((n) => n.pitchClass === pc) ?? null;
  const chordTone = chord.tones.find((t) => t.pitchClass === pc) ?? null;
  const fn = scaleNote ? harmonicFunctionOf(scaleNote, scale.notes.length) : null;
  const name = scaleNote?.name ?? chordTone?.name ?? named.name;

  let why: string;
  if (interval === 0) why = "The root: home base. Ending a phrase here sounds finished.";
  else if (chordTone && (chordTone.degree === "3" || chordTone.degree === "b3"))
    why = `The ${chordTone.degree === "3" ? "major" : "minor"} 3rd of ${chord.symbol}: the note that makes the chord sound ${chordTone.degree === "3" ? "bright" : "dark"}. A great target.`;
  else if (chordTone && chordTone.degree.includes("5")) why = `The 5th of ${chord.symbol}: strong and stable; it never clashes.`;
  else if (chordTone) why = `A chord tone of ${chord.symbol} (${chordTone.degree}). Safe to land on.`;
  else if (scaleNote) why = `In the scale but not the chord: use it to pass between chord tones rather than to land on.`;
  else why = `Outside the scale. Use it only briefly, as a lead-in a half step from a chord tone.`;

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3 rounded-xl border border-[var(--color-signal)] bg-[rgba(34,224,214,0.05)] p-4" role="region" aria-label={`About ${name}`}>
      <div>
        <p className="hud-label">Note</p>
        <p className="readout text-3xl font-semibold text-[var(--color-signal)]">
          {name}
          <span className="ml-1 text-sm text-[var(--color-ink-faint)]">{named.octave}</span>
        </p>
        <p className="text-[11px] text-[var(--color-ink-faint)]">
          {stringName} string, fret {note.fret}
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="hud-label">From {rootName}</dt>
        <dd>{interval === 0 ? "Root (1)" : `${intervalName(interval)}`}</dd>
        <dt className="hud-label">In the scale</dt>
        <dd>{scaleNote ? `Degree ${scaleNote.degree}${fn ? ` · ${fn}` : ""}` : `Not in ${scale.rootName} ${scale.definition.name}`}</dd>
        <dt className="hud-label">In the chord</dt>
        <dd>{chordTone ? `${chordTone.degree === "1" ? "Root" : chordTone.degree} of ${chord.symbol}` : `Not in ${chord.symbol}`}</dd>
      </dl>
      <p className="min-w-[220px] flex-1 text-sm leading-relaxed text-[var(--color-ink-dim)]">
        <span className="font-medium text-[var(--color-ink)]">Why it matters: </span>
        {why}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => void fretSynth.pluck(note.midi)}>
          ▶ Note
        </Button>
        <Button size="sm" onClick={() => (kind === "scale" ? playScale(scale.notes.map((n) => n.pitchClass)) : playChord(chord.tones.map((t) => t.pitchClass)))}>
          ▶ {kind === "scale" ? "Scale" : "Chord"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close note details">
          ✕
        </Button>
      </div>
    </div>
  );
}
