"use client";

import {
  COWBOY_CHORDS,
  type CowboyChord,
  type Fretboard as Board,
  type Inversion,
  INVERSION_LABELS,
  type Progression,
  type TriadShape,
  chordPitchClasses,
  coreTriad,
  cowboyNotes,
  extractTriad,
  findCowboyChord,
  mod,
  qualityInfo,
  shapeText,
  spellPitchClass,
  supportsCowboyChords,
  targetNotes,
  triadOrder,
  triadShapes,
} from "@fretlight/core";
import { useEffect, useMemo, useState } from "react";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { playEvents } from "@/lib/audio/companion-player";
import { pitchClassMarkers } from "@/lib/companion/markers";
import { useT, useTx } from "@/lib/i18n/locale";
import { cn } from "@/lib/ui/cn";

interface ViewProps {
  board: Board;
  progression: Progression;
  selected: number;
  lowStringOnTop: boolean;
}

const names = (progression: Progression, pcs: readonly number[]) =>
  new Map(pcs.map((pc) => [mod(pc, 12), spellPitchClass(pc, progression.key.key)]));

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-[var(--color-ink-faint)]">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full", item.color)} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

const COLORS = {
  root: "bg-[rgba(255,92,138,0.92)]",
  chord: "bg-[rgba(34,224,214,0.5)]",
  scale: "bg-[rgba(139,124,255,0.5)]",
  target: "bg-[rgba(34,224,214,0.95)]",
};

/** For each chord: its notes, the next chord's notes, and the note to aim for. */
export function ChordTonesView({ board, progression, selected, lowStringOnTop }: ViewProps) {
  const summaries = useMemo(() => targetNotes(progression), [progression]);
  const summary = summaries[selected] ?? summaries[0];

  const t = useT();
  const plan = useMemo(() => (summary ? planMove(board, summary.from.pitchClasses, summary.to.root) : null), [board, summary]);

  const markers = useMemo(() => {
    if (!summary) return [];
    const { from, to } = summary;
    const nameMap = names(progression, [...from.pitchClasses, ...to.pitchClasses]);
    const current = pitchClassMarkers(board, from.pitchClasses, nameMap, (pc) => (mod(pc, 12) === mod(from.root, 12) ? "root" : "chord"));
    const target = pitchClassMarkers(board, [to.root], nameMap, () => "target");
    const byKey = new Map<string, FretMarker>();
    for (const m of [...current, ...target]) byKey.set(`${m.string}:${m.fret}`, m);
    // Number the suggested move (1 → 2) so "How to play it" points at real dots.
    if (plan) {
      const steps = plan.from ? [plan.from, plan.to] : [plan.to];
      steps.forEach((spot, i) => {
        const key = `${spot.string}:${spot.fret}`;
        const existing = byKey.get(key);
        if (existing) byKey.set(key, { ...existing, order: i + 1 });
      });
    }
    return [...byKey.values()];
  }, [board, progression, summary, plan]);

  if (!summary) return null;
  const { from, to } = summary;
  const target = summary.target.name;
  const home = progression.key.key?.rootName ?? null;
  const spell = (pc: number) => spellPitchClass(pc, progression.key.key);

  return (
    <Panel title={t("tones.title")}>
      <p className="mb-4 text-sm leading-relaxed text-[var(--color-ink-dim)]">{t("tones.intro")}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label={t("tones.current")} value={from.symbol} detail={from.names.join("  ")} />
        <Card label={t("tones.next")} value={to.symbol} detail={to.names.join("  ")} />
        <Card
          label={t("tones.shared")}
          value={summary.commonTones.join("  ") || t("tones.none")}
          detail={summary.commonTones.length ? t("tones.sharedHold") : t("tones.sharedNone")}
        />
        <Card label={t("tones.target")} value={target} detail={t("tones.targetDetail", { chord: to.symbol })} accent />
      </div>
      <p className="mt-3 text-sm text-[var(--color-ink-dim)]">{t("tones.reason", { target, chord: to.symbol })}</p>

      {home && (
        <div className="mt-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3">
          <p className="text-sm font-medium">
            {home === target ? t("tones.target") + ": " + target : t("tones.why.title", { target, home })}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-dim)]">
            {home === target ? t("tones.why.isHome", { home }) : `${t("tones.why.body", { home, target, from: from.symbol, to: to.symbol })} ${t("tones.why.home", { home })}`}
          </p>
        </div>
      )}

      {plan && (
        <div className="mt-3 rounded-xl border border-[var(--color-signal)] bg-[rgba(34,224,214,0.05)] p-3">
          <p className="hud-label">{t("tones.how.title")}</p>
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-[var(--color-ink-dim)]">
            <li>{t("tones.how.step1", { from: from.symbol, notes: from.names.join(" "), root: from.names[0] ?? "" })}</li>
            <li>{t("tones.how.step2")}</li>
            <li className="text-[var(--color-ink)]">
              {plan.from
                ? t("tones.how.move", {
                    to: to.symbol,
                    target,
                    fromNote: spell(plan.from.pitchClass),
                    fromString: stringNumber(board, plan.from.string),
                    fromFret: plan.from.fret,
                    toString: stringNumber(board, plan.to.string),
                    toFret: plan.to.fret,
                    distance:
                      plan.frets === 0 ? t("tones.sameFret") : plan.frets === 1 ? t("tones.fret") : t("tones.frets", { n: plan.frets }),
                  })
                : t("tones.how.hold", { target, from: from.symbol, to: to.symbol, string: stringNumber(board, plan.to.string), fret: plan.to.fret })}
            </li>
            <li>{t("tones.how.step4", { from: from.symbol, to: to.symbol, target })}</li>
          </ol>
          <p className="mt-2 text-xs text-[var(--color-ink-faint)]">{t("tones.how.why", { target, to: to.symbol })}</p>
        </div>
      )}

      <div className="mt-4">
        <Fretboard board={board} markers={markers} lowStringOnTop={lowStringOnTop} />
        <Legend
          items={[
            { color: COLORS.root, label: t("tones.legend.root", { chord: from.symbol }) },
            { color: COLORS.chord, label: t("tones.legend.other", { chord: from.symbol }) },
            { color: COLORS.target, label: t("tones.legend.target", { note: target }) },
          ]}
        />
      </div>
    </Panel>
  );
}

interface Spot {
  readonly string: number;
  readonly fret: number;
  readonly pitchClass: number;
}

/** Strings are numbered the way players count them: 1 is the highest-pitched string. */
function stringNumber(board: Board, string: number): number {
  const open = board.openMidi[string]!;
  return 1 + board.openMidi.filter((m) => m > open).length;
}

/**
 * The easiest concrete way to reach the target in the lower half of the neck.
 * If the target is already a note of the current chord, there is nothing to
 * move: hold it. Otherwise pick the current-chord note closest to a target
 * spot, so the hand barely moves.
 */
function planMove(board: Board, fromPcs: readonly number[], targetPc: number): { from: Spot | null; to: Spot; frets: number } | null {
  const maxFret = Math.min(board.fretCount, 12);
  const spots: Spot[] = [];
  for (let string = 0; string < board.stringCount; string++) {
    for (let fret = 0; fret <= maxFret; fret++) spots.push({ string, fret, pitchClass: mod(board.openMidi[string]! + fret, 12) });
  }
  const target = mod(targetPc, 12);
  const targets = spots.filter((s) => s.pitchClass === target);
  if (targets.length === 0) return null;
  const chordPcs = new Set(fromPcs.map((p) => mod(p, 12)));

  if (chordPcs.has(target)) {
    // Prefer a fretted note around the open position: easy to find and to sustain.
    const to = [...targets].sort((a, b) => Math.abs(a.fret - 3) - Math.abs(b.fret - 3) || a.string - b.string)[0]!;
    return { from: null, to, frets: 0 };
  }

  let best: { from: Spot; to: Spot; cost: number } | null = null;
  for (const from of spots) {
    if (!chordPcs.has(from.pitchClass)) continue;
    for (const to of targets) {
      const stringGap = Math.abs(from.string - to.string);
      if (stringGap > 1) continue;
      const cost = Math.abs(from.fret - to.fret) + stringGap * 0.5 + Math.max(from.fret, to.fret) * 0.05;
      if (!best || cost < best.cost) best = { from, to, cost };
    }
  }
  if (!best) return { from: null, to: targets[0]!, frets: 0 };
  return { from: best.from, to: best.to, frets: Math.abs(best.from.fret - best.to.fret) };
}

function Card({ label, value, detail, accent }: { label: string; value: string; detail: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-3", accent ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.08)]" : "border-[var(--color-hairline)] bg-[var(--color-void)]")}>
      <p className="hud-label">{label}</p>
      <p className="readout mt-1 text-xl font-semibold">{value}</p>
      <p className="readout mt-0.5 text-xs text-[var(--color-ink-faint)]">{detail}</p>
    </div>
  );
}

const ROLE_TONE = { R: "root", "3": "chord", "5": "scale" } as const;

/** Triads on the neck, in every inversion, for the chosen chord. */
export function TriadsView({ board, progression, selected, lowStringOnTop, onLead }: ViewProps & { onLead: () => void }) {
  const chord = progression.chords[selected] ?? progression.chords[0];
  const [inversion, setInversion] = useState<Inversion | "all">("all");
  const [shapeIndex, setShapeIndex] = useState<number | "all">("all");
  const [labels, setLabels] = useState<"names" | "degrees">("names");
  const x = useTx();

  const quality = chord ? coreTriad(chord.quality) : null;
  const shapes = useMemo(() => (chord && quality ? triadShapes(board, chord.root, quality, inversion) : []), [board, chord, quality, inversion]);

  useEffect(() => setShapeIndex("all"), [chord?.index, inversion, board]);

  if (!chord) return null;
  const visible: TriadShape[] = shapeIndex === "all" ? shapes : shapes[shapeIndex] ? [shapes[shapeIndex]!] : [];
  const nameMap = names(progression, quality ? chordPitchClasses(chord.root, quality) : []);

  const markers: FretMarker[] = [];
  const seen = new Set<string>();
  for (const shape of visible) {
    for (const spot of shape.spots) {
      const key = `${spot.string}:${spot.fret}`;
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push({
        string: spot.string,
        fret: spot.fret,
        label: labels === "names" ? (nameMap.get(spot.pitchClass) ?? "") : spot.role,
        tone: ROLE_TONE[spot.role],
      });
    }
  }

  const play = () => {
    const shape = visible[0];
    if (!shape) return;
    const events = shape.spots.map((s, i) => ({ at: i * 0.02, midi: board.openMidi[s.string]! + s.fret }));
    void playEvents(events, 1.8);
  };

  return (
    <Panel title={x("Triads")}>
      <div className="mb-4 rounded-xl border border-[rgba(34,224,214,0.3)] bg-[rgba(34,224,214,0.06)] p-3 text-sm leading-relaxed text-[var(--color-ink-dim)]">
        <span className="font-medium text-[var(--color-signal)]">{x("Triads are the secret to good lead guitar.")}</span>{" "}
        {x("A triad is a chord's root, 3rd and 5th, the three strongest notes. Great melodies keep landing on them instead of running up and down a scale.")}
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {progression.chords.map((c) => {
          const q = coreTriad(c.quality);
          const pcs = q ? chordPitchClasses(c.root, q) : [];
          return (
            <div key={c.index} className={cn("rounded-xl border px-3 py-2", c.index === chord.index ? "border-[var(--color-signal)]" : "border-[var(--color-hairline)]")}>
              <span className="readout text-sm font-semibold">{c.symbol}</span>
              <span className="readout ml-2 text-xs text-[var(--color-ink-faint)]">
                {q ? pcs.map((pc) => spellPitchClass(pc, progression.key.key)).join(" ") : x("no 3rd (suspended)")}
              </span>
            </div>
          );
        })}
      </div>

      {!quality ? (
        <p className="text-sm text-[var(--color-ink-dim)]">
          {x("{chord} is a suspended chord: it has no 3rd, so it has no triad. Pick another chord above.", { chord: chord.symbol })}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <SegmentedControl
              size="sm"
              options={[
                { value: "0", label: x("Root") },
                { value: "1", label: x("1st inversion") },
                { value: "2", label: x("2nd inversion") },
                { value: "all", label: x("All") },
              ]}
              value={String(inversion)}
              onChange={(v) => setInversion(v === "all" ? "all" : (Number(v) as Inversion))}
            />
            <SegmentedControl
              size="sm"
              options={[
                { value: "names", label: x("Notes") },
                { value: "degrees", label: "R · 3 · 5" },
              ]}
              value={labels}
              onChange={setLabels}
            />
            <Button size="sm" onClick={play} disabled={visible.length === 0}>
              {x("▶ Play shape")}
            </Button>
          </div>

          <p className="mb-2 text-sm text-[var(--color-ink-dim)]">
            {x("{chord} triad:", { chord: chord.symbol })}{" "}
            {(inversion === "all" ? ([0, 1, 2] as Inversion[]) : [inversion]).map((inv) => (
              <span key={inv} className="readout mr-4 whitespace-nowrap">
                <span className="text-[var(--color-ink-faint)]">{x(INVERSION_LABELS[inv])}</span>{" "}
                {triadOrder(chord.root, quality, inv).map((n) => spellPitchClass(n.pitchClass, progression.key.key)).join(" ")}
              </span>
            ))}
          </p>

          <div className="mb-3 flex flex-wrap gap-1.5">
            <ShapeChip active={shapeIndex === "all"} onClick={() => setShapeIndex("all")}>
              {x("Whole neck")}
            </ShapeChip>
            {shapes.slice(0, 14).map((shape, i) => (
              <ShapeChip key={i} active={shapeIndex === i} onClick={() => setShapeIndex(i)}>
                {shape.minFret === 0 ? x("open") : x("fret {n}", { n: shape.minFret })} · {["R", "1st", "2nd"][shape.inversion]} · str {shape.spots[0]!.string + 1}-{shape.spots[2]!.string + 1}
              </ShapeChip>
            ))}
          </div>

          <Fretboard board={board} markers={markers} lowStringOnTop={lowStringOnTop} />
          <Legend
            items={[
              { color: COLORS.root, label: x("Root") },
              { color: COLORS.chord, label: "3rd" },
              { color: COLORS.scale, label: "5th" },
            ]}
          />
          <div className="mt-4">
            <Button variant="primary" onClick={onLead}>
              {x("Build melody from triads →")}
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

function ShapeChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "readout rounded-lg border px-2 py-1 text-[11px] transition-colors",
        active ? "border-[var(--color-theory)] bg-[rgba(139,124,255,0.14)] text-[var(--color-theory-bright)]" : "border-[var(--color-hairline)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]",
      )}
    >
      {children}
    </button>
  );
}

/** Open-position chord shapes, each linked to the triad hiding inside. */
export function CowboyView({ board, progression, selected, lowStringOnTop, onLead }: ViewProps & { onLead: () => void }) {
  const supported = supportsCowboyChords(board);
  const inProgression = (c: CowboyChord) => progression.chords.some((p) => p.root === c.root && p.quality === c.quality);
  const initial = useMemo(() => {
    const wanted = progression.chords[selected];
    return (wanted && findCowboyChord(wanted.root, wanted.quality)) ?? COWBOY_CHORDS[0]!;
  }, [progression, selected]);
  const [chord, setChord] = useState<CowboyChord>(initial);
  const [view, setView] = useState<"shape" | "neck" | "triad">("shape");
  const x = useTx();
  useEffect(() => setChord(initial), [initial]);

  if (!supported) {
    return (
      <Panel title={x("Cowboy chords")}>
        <p className="text-sm text-[var(--color-ink-dim)]">
          {x("Cowboy chords are open shapes for a 6-string guitar in standard tuning. Switch to Guitar (standard tuning) to see them. Triads work on any instrument.")}
        </p>
      </Panel>
    );
  }

  const played = cowboyNotes(board, chord);
  const triad = extractTriad(chord);
  const nameMap = names(progression, chordPitchClasses(chord.root, chord.quality));
  const triadPcs = new Set(triad?.notes ?? []);

  let markers: FretMarker[];
  if (view === "neck") {
    markers = pitchClassMarkers(board, chordPitchClasses(chord.root, chord.quality), nameMap, (pc) => (pc === chord.root ? "root" : "chord"));
  } else {
    markers = played
      .filter((n) => view === "shape" || triadPcs.has(n.pitchClass))
      .map((n) => ({
        string: n.string,
        fret: n.fret,
        label: nameMap.get(n.pitchClass) ?? "",
        tone: n.role === "R" ? "root" : n.role === "5" || n.role === "b5" ? "scale" : "chord",
      }));
  }

  const open = played.filter((n) => n.open).length;
  const muted = chord.frets.filter((f) => f === null).length;
  const play = () => void playEvents(played.map((n, i) => ({ at: i * 0.03, midi: n.midi })), 2.2);

  const groups: [string, CowboyChord["group"]][] = [["Major", "major"], ["Minor", "minor"], ["7th", "seventh"], ["Suspended / add", "suspended"]];

  return (
    <Panel title={x("Cowboy chords")} meta={<span className="text-[11px] text-[var(--color-ink-faint)]">{x("Common open shapes on 6-string guitar")}</span>}>
      <div className="mb-4 flex flex-col gap-2">
        {groups.map(([label, group]) => (
          <div key={group} className="flex flex-wrap items-center gap-1.5">
            <span className="hud-label w-24 shrink-0">{x(label)}</span>
            {COWBOY_CHORDS.filter((c) => c.group === group).map((c) => (
              <button
                key={c.symbol}
                onClick={() => setChord(c)}
                className={cn(
                  "readout rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                  c.symbol === chord.symbol
                    ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.12)] text-[var(--color-ink)]"
                    : inProgression(c)
                      ? "border-[var(--color-theory)] text-[var(--color-theory-bright)]"
                      : "border-[var(--color-hairline)] text-[var(--color-ink-dim)] hover:border-[var(--color-hairline-bright)]",
                )}
              >
                {c.symbol}
              </button>
            ))}
          </div>
        ))}
        <p className="text-[11px] text-[var(--color-ink-faint)]">{x("Purple chords are in your progression.")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_2fr]">
        <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-4">
          <h3 className="readout text-2xl font-semibold text-[var(--color-signal)]">{chord.symbol}</h3>
          <p className="text-sm text-[var(--color-ink-dim)]">{x(qualityInfo(chord.quality).name)}</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="hud-label">{x("Shape")}</dt>
            <dd className="readout">{shapeText(chord)}</dd>
            <dt className="hud-label">{x("Fingers")}</dt>
            <dd className="readout">{chord.fingers.map((f) => (f === 0 ? "–" : f)).join(" ")}</dd>
            <dt className="hud-label">{x("Notes")}</dt>
            <dd className="readout">{played.map((n) => nameMap.get(n.pitchClass)).join(" ")}</dd>
            <dt className="hud-label">{x("Roles")}</dt>
            <dd className="readout">{played.map((n) => n.role).join(" ")}</dd>
            <dt className="hud-label">{x("Strings")}</dt>
            <dd className="text-xs text-[var(--color-ink-dim)]">{x("{open} open · {muted} not played", { open, muted })}</dd>
          </dl>
          <p className="mt-3 text-[11px] text-[var(--color-ink-faint)]">{x("Strings are listed low E to high e. x or – means not played or no finger.")}</p>
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={play}>
              {x("▶ Play")}
            </Button>
            <SegmentedControl
              size="sm"
              options={[
                { value: "shape", label: x("Open shape") },
                { value: "neck", label: x("Show fretboard") },
                { value: "triad", label: x("Show triad"), hint: x("Extract the root, 3rd and 5th") },
              ]}
              value={view}
              onChange={setView}
            />
          </div>
          <Fretboard board={board} markers={markers} lowStringOnTop={lowStringOnTop} {...(view === "neck" ? {} : { toFret: 5 })} />
          <Legend items={[{ color: COLORS.root, label: x("Root") }, { color: COLORS.chord, label: x("3rd / other") }, { color: COLORS.scale, label: "5th" }]} />
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-4">
        <p className="hud-label mb-2">{x("From cowboy chord to melody")}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Step>{x("{chord} shape: {notes}", { chord: chord.symbol, notes: played.map((n) => nameMap.get(n.pitchClass)).join(" ") })}</Step>
          <Arrow />
          <Step>{x("Chord tones: {notes}", { notes: [...new Set(chordPitchClasses(chord.root, chord.quality))].map((pc) => nameMap.get(pc)).join(" ") })}</Step>
          <Arrow />
          <Step>{triad ? x("Triad: {notes}", { notes: triad.notes.map((pc) => nameMap.get(pc)).join(" ") }) : x("No triad (no 3rd)")}</Step>
          <Arrow />
          <button onClick={onLead} className="rounded-lg border border-[var(--color-signal)] px-2.5 py-1.5 text-xs text-[var(--color-signal)] hover:bg-[rgba(34,224,214,0.1)]">
            {x("Lead melody →")}
          </button>
        </div>
        {triad && view !== "triad" && (
          <button onClick={() => setView("triad")} className="mt-3 text-xs underline text-[var(--color-ink-dim)]">
            {x("Extract triad")}
          </button>
        )}
      </div>
    </Panel>
  );
}

const Step = ({ children }: { children: React.ReactNode }) => (
  <span className="readout rounded-lg border border-[var(--color-hairline)] px-2.5 py-1.5 text-xs text-[var(--color-ink-dim)]">{children}</span>
);
const Arrow = () => <span className="text-[var(--color-ink-faint)]">→</span>;
