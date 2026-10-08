import { describe, expect, it } from "vitest";
import { createFretboard } from "../instrument/fretboard";
import { getTuning } from "../instrument/tunings";
import { chordPitchClasses } from "../song-analysis/chord-templates";
import { mod } from "../theory/pitch";
import { parseChordSymbol, parseProgressionText } from "./chord-parser";
import { COWBOY_CHORDS, cowboyNotes, extractTriad, findCowboyChord, supportsCowboyChords } from "./cowboy";
import { BASS_CATEGORIES, GUITAR_CATEGORIES, generateIdeas, ideaTab, isPlayable } from "./ideas";
import { progressionFromText } from "./progression";
import { STYLE_IDS, DIFFICULTIES } from "./styles";
import { triadOrder, triadShapes } from "./triads";
import { renderTab } from "./tab";

const board = (id: string, frets = 22) => createFretboard(getTuning(id)!, frets);
const guitar = board("guitar-6-standard");
const bass = board("bass-4-standard");

const names = (pcs: readonly number[]) => pcs.map((p) => ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][p]);

describe("progression parsing", () => {
  it("reads every common way of writing a progression", () => {
    for (const text of ["C G Am F", "C | G | Am | F", "C → G → Am → F", "C, G, Am, F", "C -> G -> Am -> F"]) {
      expect(parseProgressionText(text).chords.map((c) => c.text)).toEqual(["C", "G", "Am", "F"]);
    }
  });
  it("understands qualities and flats", () => {
    expect(parseChordSymbol("Bbmaj7")).toMatchObject({ root: 10, quality: "maj7" });
    expect(parseChordSymbol("F#m7")).toMatchObject({ root: 6, quality: "m7" });
    expect(parseChordSymbol("Gsus4")).toMatchObject({ root: 7, quality: "sus4" });
    expect(parseChordSymbol("C/E")).toMatchObject({ root: 0, quality: "maj" });
    expect(parseChordSymbol("Xyz")).toBeNull();
  });
  it("reports tokens that are not chords", () => {
    const parsed = parseProgressionText("C G hello F");
    expect(parsed.chords).toHaveLength(3);
    expect(parsed.errors).toEqual(["hello"]);
  });
});

describe("key and chord tones", () => {
  it("finds the key", () => {
    expect(progressionFromText("C G Am F").key.key?.name).toBe("C Major");
    expect(progressionFromText("G D Em C").key.key?.name).toBe("G Major");
    expect(["A Minor", "C Major"]).toContain(progressionFromText("Am F C G").key.key?.name);
  });
  it("recognises chord tones of seventh chords", () => {
    const p = progressionFromText("Cmaj7 → Am7 → Fmaj7 → G7");
    expect(p.chords.map((c) => names(c.pitchClasses).join(" "))).toEqual(["C E G B", "A C E G", "F A C E", "G B D F"]);
    expect(p.chords.map((c) => c.roman)).toEqual(["Imaj7", "vi7", "IVmaj7", "V7"]);
  });
  it("spells names for the key", () => {
    expect(progressionFromText("F Bb C F").chords[1]!.symbol).toBe("Bb");
  });
});

describe("triads", () => {
  it("builds all four qualities", () => {
    expect(names(chordPitchClasses(0, "maj"))).toEqual(["C", "E", "G"]);
    expect(names(chordPitchClasses(0, "min"))).toEqual(["C", "D#", "G"]);
    expect(names(chordPitchClasses(0, "dim"))).toEqual(["C", "D#", "F#"]);
    expect(names(chordPitchClasses(0, "aug"))).toEqual(["C", "E", "G#"]);
  });
  it("orders inversions from the bass up", () => {
    expect(triadOrder(0, "maj", 0).map((n) => n.pitchClass)).toEqual([0, 4, 7]);
    expect(triadOrder(0, "maj", 1).map((n) => n.pitchClass)).toEqual([4, 7, 0]);
    expect(triadOrder(0, "maj", 2).map((n) => n.pitchClass)).toEqual([7, 0, 4]);
  });
  it("finds shapes that really sound the triad, on guitar and bass", () => {
    for (const b of [guitar, bass]) {
      for (const inversion of [0, 1, 2] as const) {
        const shapes = triadShapes(b, 0, "maj", inversion);
        expect(shapes.length).toBeGreaterThan(0);
        const wanted = triadOrder(0, "maj", inversion).map((n) => n.pitchClass);
        for (const shape of shapes) {
          expect(shape.spots.map((s) => mod(b.openMidi[s.string]! + s.fret, 12))).toEqual(wanted);
          expect(shape.maxFret - shape.minFret).toBeLessThanOrEqual(4 + (shape.minFret === 0 ? shape.maxFret : 0));
        }
      }
    }
  });
});

describe("cowboy chords", () => {
  it("includes the basics", () => {
    for (const symbol of ["C", "G", "D", "A", "E", "Am", "Em", "Dm", "C7", "G7", "D7", "A7", "E7", "Am7", "Em7", "Dm7", "Asus2", "Dsus2", "Esus4", "Gsus4"]) {
      expect(COWBOY_CHORDS.some((c) => c.symbol === symbol), symbol).toBe(true);
    }
  });
  it("sounds only chord tones, starting with the root, in standard tuning", () => {
    for (const chord of COWBOY_CHORDS) {
      const notes = cowboyNotes(guitar, chord);
      const wanted = new Set(chordPitchClasses(chord.root, chord.quality));
      expect(notes.every((n) => wanted.has(n.pitchClass)), chord.symbol).toBe(true);
      expect(notes[0]!.pitchClass, chord.symbol).toBe(chord.root);
      expect(chord.frets).toHaveLength(6);
    }
  });
  it("C is x 3 2 0 1 0 = C E G C E", () => {
    const c = findCowboyChord(0, "maj")!;
    expect(c.frets).toEqual([null, 3, 2, 0, 1, 0]);
    expect(names(cowboyNotes(guitar, c).map((n) => n.pitchClass))).toEqual(["C", "E", "G", "C", "E"]);
    expect(extractTriad(c)!.notes).toEqual([0, 4, 7]);
  });
  it("is only offered for six-string standard guitar", () => {
    expect(supportsCowboyChords(guitar)).toBe(true);
    expect(supportsCowboyChords(bass)).toBe(false);
    expect(supportsCowboyChords(board("guitar-6-drop-d"))).toBe(false);
  });
});

function request(text: string, over: Partial<Parameters<typeof generateIdeas>[0]> = {}) {
  return {
    board: guitar,
    progression: progressionFromText(text),
    instrument: "guitar" as const,
    style: "popPunk" as const,
    difficulty: "intermediate" as const,
    category: "fills" as const,
    ...over,
  };
}

describe("fills and target notes", () => {
  it("C -> G ends on a G chord tone", () => {
    const [fill] = generateIdeas(request("C G"));
    const last = fill!.notes[fill!.notes.length - 1]!;
    expect(last.role).toBe("target");
    expect([7, 11, 2]).toContain(mod(last.midi, 12));
    expect(fill!.target!.chordIndex).toBe(1);
  });
  it("C -> Am aims at A C E", () => {
    const [fill] = generateIdeas(request("C Am"));
    expect([9, 0, 4]).toContain(mod(fill!.notes.at(-1)!.midi, 12));
  });
  it("puts chord tones of the current chord on the strong beats", () => {
    const p = progressionFromText("C G Am F");
    for (const style of STYLE_IDS) {
      for (const difficulty of DIFFICULTIES) {
        for (const fill of generateIdeas(request("C G Am F", { style, difficulty }))) {
          for (const n of fill.notes.slice(0, -1)) {
            if (!Number.isInteger(n.startBeat)) continue;
            const chord = p.chords[n.chordIndex]!;
            const tones = chord.pitchClasses.map((x) => mod(x, 12));
            const extras = [mod(chord.root + 2, 12), mod(chord.root + 9, 12)];
            expect(tones.includes(mod(n.midi, 12)) || extras.includes(mod(n.midi, 12)), `${style}/${difficulty} ${n.name}`).toBe(true);
          }
        }
      }
    }
  });
  it("moves by small intervals (voice leading)", () => {
    for (const fill of generateIdeas(request("C G Am F", { difficulty: "beginner" }))) {
      for (let i = 1; i < fill.notes.length; i++) {
        expect(Math.abs(fill.notes[i]!.midi - fill.notes[i - 1]!.midi)).toBeLessThanOrEqual(9);
      }
    }
  });
  it("is deterministic and variants differ", () => {
    const a = generateIdeas(request("C G Am F"));
    const b = generateIdeas(request("C G Am F"));
    expect(a).toEqual(b);
    const c = generateIdeas(request("C G Am F", { variant: 2 }));
    expect(c.map((i) => i.what)).not.toEqual(a.map((i) => i.what));
  });
  it("explains what, why and where", () => {
    for (const fill of generateIdeas(request("C G Am F"))) {
      expect(fill.what.length).toBeGreaterThan(2);
      expect(fill.why.length).toBeGreaterThan(10);
      expect(fill.where).toContain("Resolve on");
    }
  });
});

describe("every idea is playable on the instrument", () => {
  const boards = [
    ["guitar", guitar],
    ["drop D guitar", board("guitar-6-drop-d")],
    ["7-string guitar", board("guitar-7-standard")],
    ["bass", bass],
    ["5-string bass", board("bass-5-standard")],
  ] as const;

  it("covers all categories, styles and difficulties", () => {
    const progressions = ["C G Am F", "G D Em C", "Cmaj7 Am7 Fmaj7 G7", "Am F C G"];
    let checked = 0;
    for (const [label, b] of boards) {
      const isBass = label.includes("bass");
      const categories = isBass ? BASS_CATEGORIES : GUITAR_CATEGORIES;
      for (const text of progressions) {
        for (const style of STYLE_IDS) {
          for (const difficulty of DIFFICULTIES) {
            for (const category of categories) {
              const ideas = generateIdeas({
                board: b,
                progression: progressionFromText(text),
                instrument: isBass ? "bass" : "guitar",
                style,
                difficulty,
                category,
              });
              expect(ideas.length, `${label} ${text} ${style} ${difficulty} ${category}`).toBeGreaterThan(0);
              for (const idea of ideas) {
                expect(isPlayable(b, idea), `${label} ${style} ${difficulty} ${category}: ${idea.what}`).toBe(true);
                expect(idea.why.length).toBeGreaterThan(5);
                checked++;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe("bass lines", () => {
  const ask = (category: Parameters<typeof generateIdeas>[0]["category"], style: Parameters<typeof generateIdeas>[0]["style"] = "rock") =>
    generateIdeas({
      board: bass,
      progression: progressionFromText("C G Am F"),
      instrument: "bass",
      style,
      difficulty: "intermediate",
      category,
    })[0]!;

  it("root + 5th plays root then fifth for each chord", () => {
    const idea = ask("bass-rootfifth");
    expect(idea.notes.map((n) => n.name)).toEqual(["C", "G", "G", "D", "A", "E", "F", "C"]);
  });
  it("root notes are the chord roots", () => {
    expect(ask("bass-root").notes.map((n) => n.name)).toEqual(["C", "G", "A", "F"]);
  });
  it("pop punk bass drives eighths on root and fifth", () => {
    const idea = ask("bass-style", "popPunk");
    expect(idea.notes.slice(0, 8).map((n) => n.name).join("")).toBe("CCGGCCGG");
  });
  it("approach note sits a half step from the next root", () => {
    const idea = ask("bass-approach");
    const approach = idea.notes[1]!;
    const nextRoot = idea.notes[2]!;
    expect(Math.abs(approach.midi - nextRoot.midi)).toBe(1);
  });
});

describe("tab", () => {
  it("draws strings highest first with matching frets", () => {
    const tab = renderTab(guitar, [
      { startBeat: 0, spots: [{ string: 1, fret: 3 }] },
      { startBeat: 1, spots: [{ string: 2, fret: 2 }] },
    ]);
    expect(tab).toHaveLength(6);
    expect(tab[0]!.startsWith("e")).toBe(true);
    expect(tab[5]!.startsWith("E")).toBe(true);
    expect(tab[4]).toContain("-3-");
    expect(tab[3]).toContain("-2-");
    expect(new Set(tab.map((l) => l.length)).size).toBe(1);
  });
  it("produces a tab for generated ideas", () => {
    const [idea] = generateIdeas(request("C G Am F", { category: "lead" }));
    expect(ideaTab(guitar, idea!)).toHaveLength(6);
  });
});

describe("chord names from other parts of the app", () => {
  it("reads the symbols the Bassline and Analyzer produce", () => {
    for (const symbol of ["Bm7b5", "Cdim7", "Am6", "G9", "Fmaj9", "Dm9", "C#m", "Ebmaj7", "Gsus2", "Cadd9", "E5"]) {
      expect(parseChordSymbol(symbol), symbol).not.toBeNull();
    }
    expect(parseChordSymbol("Bm7b5")).toMatchObject({ root: 11, quality: "dim" });
  });
});
