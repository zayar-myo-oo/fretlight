import type { ChordId } from "@fretlight/core";

/**
 * Suggested guitar fingerings for standard tuning (E2 A2 D3 G3 B3 E4).
 *
 * `frets[0]` is the low E string, matching core's "0 === lowest string".
 * -1 means the string is muted. These are recommendations only — audio cannot
 * tell which voicing was actually played.
 */
export interface ChordShape {
  readonly name: string;
  readonly frets: readonly number[];
}

const OPEN: Record<string, readonly ChordShape[]> = {
  "7:major": [{ name: "Open G", frets: [3, 2, 0, 0, 0, 3] }],
  "2:major": [{ name: "Open D", frets: [-1, -1, 0, 2, 3, 2] }],
  "4:minor": [{ name: "Open Em", frets: [0, 2, 2, 0, 0, 0] }],
  "0:major": [{ name: "Open C", frets: [-1, 3, 2, 0, 1, 0] }],
  "9:minor": [{ name: "Open Am", frets: [-1, 0, 2, 2, 1, 0] }],
  "4:major": [{ name: "Open E", frets: [0, 2, 2, 1, 0, 0] }],
  "9:major": [{ name: "Open A", frets: [-1, 0, 2, 2, 2, 0] }],
  "2:minor": [{ name: "Open Dm", frets: [-1, -1, 0, 2, 3, 1] }],
  "7:dom7": [{ name: "Open G7", frets: [3, 2, 0, 0, 0, 1] }],
  "2:dom7": [{ name: "Open D7", frets: [-1, -1, 0, 2, 1, 2] }],
  "4:dom7": [{ name: "Open E7", frets: [0, 2, 0, 1, 0, 0] }],
  "9:dom7": [{ name: "Open A7", frets: [-1, 0, 2, 0, 2, 0] }],
  "0:maj7": [{ name: "Open Cmaj7", frets: [-1, 3, 2, 0, 0, 0] }],
  "9:min7": [{ name: "Open Am7", frets: [-1, 0, 2, 0, 1, 0] }],
  "4:min7": [{ name: "Open Em7", frets: [0, 2, 0, 0, 0, 0] }],
  "2:sus2": [{ name: "Open Dsus2", frets: [-1, -1, 0, 2, 3, 0] }],
  "2:sus4": [{ name: "Open Dsus4", frets: [-1, -1, 0, 2, 3, 3] }],
  "9:sus2": [{ name: "Open Asus2", frets: [-1, 0, 2, 2, 0, 0] }],
  "9:sus4": [{ name: "Open Asus4", frets: [-1, 0, 2, 2, 3, 0] }],
};

/** Movable shapes relative to the root fret, on the E (low) or A string. */
const MOVABLE: Partial<Record<ChordId, { e?: readonly number[]; a?: readonly number[] }>> = {
  major: { e: [0, 2, 2, 1, 0, 0], a: [-1, 0, 2, 2, 2, 0] },
  minor: { e: [0, 2, 2, 0, 0, 0], a: [-1, 0, 2, 2, 1, 0] },
  power: { e: [0, 2, 2, -1, -1, -1], a: [-1, 0, 2, 2, -1, -1] },
  dom7: { e: [0, 2, 0, 1, 0, 0], a: [-1, 0, 2, 0, 2, 0] },
  maj7: { e: [0, -1, 1, 1, 0, -1], a: [-1, 0, 2, 1, 2, 0] },
  min7: { e: [0, 2, 0, 0, 0, 0], a: [-1, 0, 2, 0, 1, 0] },
  sus2: { a: [-1, 0, 2, 2, 0, 0] },
  sus4: { e: [0, 2, 2, 2, 0, 0], a: [-1, 0, 2, 2, 3, 0] },
};

const E_PC = 4;
const A_PC = 9;

/** Recommended shapes for a chord, open shapes first, within frets 0–12. */
export function chordShapes(root: number, chordId: ChordId): ChordShape[] {
  const out: ChordShape[] = [...(OPEN[`${root}:${chordId}`] ?? [])];
  const movable = MOVABLE[chordId];
  if (movable) {
    for (const [key, base, open] of [["e", movable.e, E_PC], ["a", movable.a, A_PC]] as const) {
      if (!base) continue;
      let fret = (root - open + 12) % 12;
      if (fret === 0) fret = 12; // open version already covered (or played at 12)
      const frets = base.map((f) => (f < 0 ? -1 : f + fret));
      if (Math.max(...frets) > 12) continue;
      if (out.some((s) => s.frets.join() === frets.join())) continue;
      out.push({ name: `${key === "e" ? "E" : "A"}-shape, fret ${fret}`, frets });
    }
  }
  return out;
}
