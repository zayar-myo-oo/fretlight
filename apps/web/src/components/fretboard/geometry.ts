import { DOUBLE_INLAY_FRETS, INLAY_FRETS, type Fretboard } from "@fretlight/core";

export interface FretboardGeometry {
  readonly width: number;
  readonly height: number;
  readonly nutX: number;
  readonly neckTop: number;
  readonly neckBottom: number;
  readonly stringGap: number;
  /** x of the fret wire at index i (0 = nut). */
  readonly fretX: (fret: number) => number;
  /** x at the centre of the fret slot — where a finger actually goes. */
  readonly slotX: (fret: number) => number;
  /** y of a string, honouring the low-string-on-top preference. */
  readonly stringY: (stringIndex: number) => number;
  readonly hasInlay: (fret: number) => boolean;
  readonly hasDoubleInlay: (fret: number) => boolean;
}

export interface GeometryOptions {
  readonly fromFret?: number;
  readonly toFret?: number;
  /**
   * Draw the lowest-pitched string along the top edge.
   *
   * Off by default, because every piece of written guitar material — tab, chord
   * charts, scale diagrams — puts the *high* E on the top line. Matching that is
   * not a preference; a diagram drawn the other way up is silently wrong to
   * anyone who has read tab before.
   */
  readonly lowStringOnTop?: boolean;
  readonly stringGap?: number;
  readonly width?: number;
  /**
   * 0 = evenly spaced frets (easiest to read), 1 = true 12th-root-of-2 spacing
   * (looks like the instrument). A blend keeps the high frets legible while the
   * neck still tapers the way a player expects.
   */
  readonly taper?: number;
}

const NUT_PADDING = 58;
const RIGHT_PADDING = 22;
const VERTICAL_PADDING = 34;

export function buildGeometry(board: Fretboard, options: GeometryOptions = {}): FretboardGeometry {
  const fromFret = options.fromFret ?? 0;
  const toFret = Math.min(options.toFret ?? board.fretCount, board.fretCount);
  const stringGap = options.stringGap ?? 34;
  const width = options.width ?? 1180;
  const taper = options.taper ?? 0.45;
  const lowStringOnTop = options.lowStringOnTop ?? false;

  const fretSpan = Math.max(1, toFret - fromFret);
  const usableWidth = width - NUT_PADDING - RIGHT_PADDING;

  // Real scale length: distance from nut to fret n is L(1 - 2^(-n/12)).
  const scalePosition = (fret: number) => 1 - Math.pow(2, -fret / 12);
  const realFrom = scalePosition(fromFret);
  const realTo = scalePosition(toFret);
  const realRange = realTo - realFrom || 1;

  /**
   * Coordinates are rounded to 2 decimals before they reach the DOM.
   *
   * Not cosmetic: an unrounded double renders as a 17-significant-digit string,
   * and the server and client can disagree on the last digit, which React
   * reports as a hydration mismatch on every marker. Rounding also cuts the
   * size of the serialised SVG noticeably on a 24-fret neck.
   */
  const round = (value: number) => Math.round(value * 100) / 100;

  const fretX = (fret: number) => {
    const clamped = Math.max(fromFret, Math.min(toFret, fret));
    const uniform = (clamped - fromFret) / fretSpan;
    const real = (scalePosition(clamped) - realFrom) / realRange;
    return round(NUT_PADDING + (uniform * (1 - taper) + real * taper) * usableWidth);
  };

  const slotX = (fret: number) => {
    if (fret <= fromFret) return NUT_PADDING - 30; // open string, behind the nut
    return round((fretX(fret - 1) + fretX(fret)) / 2);
  };

  const neckTop = VERTICAL_PADDING;
  const neckBottom = neckTop + (board.stringCount - 1) * stringGap;

  const stringY = (stringIndex: number) => {
    const index = lowStringOnTop ? stringIndex : board.stringCount - 1 - stringIndex;
    return neckTop + index * stringGap;
  };

  return {
    width,
    height: neckBottom + VERTICAL_PADDING + 26,
    nutX: NUT_PADDING,
    neckTop,
    neckBottom,
    stringGap,
    fretX,
    slotX,
    stringY,
    hasInlay: (fret) => (INLAY_FRETS as readonly number[]).includes(fret),
    hasDoubleInlay: (fret) => (DOUBLE_INLAY_FRETS as readonly number[]).includes(fret),
  };
}

/** Thicker line for the lower strings, the way a wound E looks next to a plain high E. */
export function stringThickness(stringIndex: number, stringCount: number): number {
  const t = stringCount <= 1 ? 0 : stringIndex / (stringCount - 1);
  return 3.4 - t * 2.0;
}
