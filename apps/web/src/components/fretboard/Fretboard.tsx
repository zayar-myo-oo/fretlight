"use client";

import { type Fretboard as FretboardModel, noteAt } from "@fretlight/core";
import { useId, useMemo } from "react";
import { TONE_STYLES, type MarkerTone } from "@/lib/ui/tone";
import { cn } from "@/lib/ui/cn";
import { buildGeometry, stringThickness, type GeometryOptions } from "./geometry";

export interface FretMarker {
  readonly string: number;
  readonly fret: number;
  readonly label: string;
  readonly tone: MarkerTone;
  /** Drawn slightly larger and always above other markers. */
  readonly emphasis?: boolean;
  /** Small ordinal badge, used to number a practice path. */
  readonly order?: number;
}

export interface FretboardProps {
  readonly board: FretboardModel;
  readonly markers: readonly FretMarker[];
  /** Ordered positions to connect with a path line — the "follow the scale" view. */
  readonly path?: readonly { string: number; fret: number }[];
  readonly fromFret?: number;
  readonly toFret?: number;
  /** Lowest string along the top. Off by default: tab puts high E on top. */
  readonly lowStringOnTop?: boolean;
  readonly onSelect?: (position: { string: number; fret: number; midi: number }) => void;
  /** Show every chromatic position faintly behind the markers. */
  readonly showGhosts?: boolean;
  /**
   * The fret range the app believes the hand is covering. Drawn as a band so
   * the assumption behind the highlight is visible and correctable, rather than
   * something the player has to infer from wrong answers.
   */
  readonly handWindow?: { readonly from: number; readonly to: number } | null;
  readonly className?: string;
  readonly geometry?: GeometryOptions;
  /**
   * Increment this once per newly-committed note (detectionHub's
   * `noteEventId`) so the emphasised marker's pop-and-glow re-triggers on a
   * repeated note. Without it, playing the same fret twice in a row keys the
   * marker's `<g>` identically both times, React never remounts it, and the
   * one-shot entrance animation only ever plays the first time — the neck
   * would stop visibly reacting to a note the player can hear was replayed.
   */
  readonly activeEventId?: number;
}

/**
 * The interactive neck.
 *
 * Rendered as a single SVG rather than positioned DOM nodes: one element tree,
 * resolution-independent, and it scales to any container without recalculating
 * layout in JavaScript. Every visual state a marker can be in comes from the
 * `tone` field, so the tuner, the scale finder and the practice screen all draw
 * the same component with different data.
 */
export function Fretboard({
  board,
  markers,
  path,
  fromFret = 0,
  toFret,
  lowStringOnTop = false,
  onSelect,
  showGhosts = false,
  handWindow,
  className,
  geometry: geometryOptions,
  activeEventId,
}: FretboardProps) {
  const lastFret = Math.min(toFret ?? board.fretCount, board.fretCount);

  const geometry = useMemo(
    () =>
      buildGeometry(board, {
        fromFret,
        toFret: lastFret,
        lowStringOnTop,
        ...geometryOptions,
      }),
    [board, fromFret, lastFret, lowStringOnTop, geometryOptions],
  );

  const frets = useMemo(
    () => Array.from({ length: lastFret - fromFret + 1 }, (_, i) => fromFret + i),
    [fromFret, lastFret],
  );

  // Each fretboard needs its own gradient ids: with shared ids the browser resolves
  // url(#…) to the first copy on the page, and when that copy is hidden the
  // neck, frets and strings of every other fretboard stop painting.
  const uid = useId().replace(/:/g, "");
  const ref = (name: string) => `${name}-${uid}`;

  const markerIndex = useMemo(() => {
    const map = new Map<string, FretMarker>();
    for (const marker of markers) map.set(`${marker.string}:${marker.fret}`, marker);
    return map;
  }, [markers]);

  const pathPoints = useMemo(() => {
    if (!path || path.length < 2) return "";
    return path
      .map((point) => `${geometry.slotX(point.fret).toFixed(1)},${geometry.stringY(point.string).toFixed(1)}`)
      .join(" ");
  }, [path, geometry]);

  // Below this width the frets collapse into each other and the note labels stop
  // being readable, so on a phone the neck scrolls sideways instead of shrinking.
  const minWidth = Math.max(520, (lastFret - fromFret + 1) * 42);

  return (
    <div className={cn("-mx-1 overflow-x-auto px-1", className)}>
    <svg
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      className="w-full select-none"
      style={{ minWidth }}
      role="img"
      aria-label={`${board.tuning.name} fretboard, ${board.stringCount} strings`}
    >
      <defs>
        <linearGradient id={ref("neck-wood")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#141c2b" />
          <stop offset="45%" stopColor="#0d1421" />
          <stop offset="100%" stopColor="#080d17" />
        </linearGradient>
        <linearGradient id={ref("fret-wire")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5c6a83" />
          <stop offset="50%" stopColor="#9fb0cc" />
          <stop offset="100%" stopColor="#4a5670" />
        </linearGradient>
        <linearGradient id={ref("string-metal")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8c9ab5" />
          <stop offset="50%" stopColor="#c3d0e6" />
          <stop offset="100%" stopColor="#7b8aaa" />
        </linearGradient>
        <filter id={ref("marker-glow")} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* --- Neck --- */}
      <rect
        x={geometry.nutX}
        y={geometry.neckTop - 16}
        width={geometry.fretX(lastFret) - geometry.nutX}
        height={geometry.neckBottom - geometry.neckTop + 32}
        rx={6}
        fill={`url(#${ref("neck-wood")})`}
        stroke="#1e2839"
      />

      {/* --- Hand window --- */}
      {handWindow && (
        <g>
          <rect
            x={handWindow.from <= 0 ? geometry.nutX - 40 : geometry.fretX(handWindow.from - 1)}
            y={geometry.neckTop - 16}
            width={Math.max(
              10,
              geometry.fretX(Math.min(handWindow.to, lastFret)) -
                (handWindow.from <= 0 ? geometry.nutX - 40 : geometry.fretX(handWindow.from - 1)),
            )}
            height={geometry.neckBottom - geometry.neckTop + 32}
            fill="rgba(34,224,214,0.07)"
            stroke="rgba(34,224,214,0.28)"
            strokeDasharray="4 4"
            rx={4}
          />
          <text
            x={
              (handWindow.from <= 0 ? geometry.nutX - 40 : geometry.fretX(handWindow.from - 1)) + 6
            }
            y={geometry.neckTop - 22}
            className="readout"
            fontSize={9}
            fill="rgba(34,224,214,0.7)"
          >
            HAND
          </text>
        </g>
      )}

      {/* --- Inlays --- */}
      {frets.map((fret) => {
        const centreY = (geometry.neckTop + geometry.neckBottom) / 2;
        const x = geometry.slotX(fret);
        if (geometry.hasDoubleInlay(fret)) {
          return (
            <g key={`inlay-${fret}`} fill="rgba(148,176,255,0.20)">
              <circle cx={x} cy={centreY - geometry.stringGap * 0.8} r={5} />
              <circle cx={x} cy={centreY + geometry.stringGap * 0.8} r={5} />
            </g>
          );
        }
        if (geometry.hasInlay(fret)) {
          return <circle key={`inlay-${fret}`} cx={x} cy={centreY} r={5} fill="rgba(148,176,255,0.14)" />;
        }
        return null;
      })}

      {/* --- Fret wires --- */}
      {frets.map((fret) => {
        const isNut = fret === 0;
        return (
          <rect
            key={`fret-${fret}`}
            x={geometry.fretX(fret) - (isNut ? 4 : 1.25)}
            y={geometry.neckTop - 16}
            width={isNut ? 8 : 2.5}
            height={geometry.neckBottom - geometry.neckTop + 32}
            rx={isNut ? 3 : 1}
            fill={isNut ? "#d6dff0" : `url(#${ref("fret-wire")})`}
            opacity={isNut ? 0.92 : 0.65}
          />
        );
      })}

      {/* --- Strings --- */}
      {Array.from({ length: board.stringCount }, (_, stringIndex) => (
        <rect
          key={`string-${stringIndex}`}
          x={geometry.nutX - 34}
          y={geometry.stringY(stringIndex) - stringThickness(stringIndex, board.stringCount) / 2}
          width={geometry.fretX(lastFret) - geometry.nutX + 34}
          height={stringThickness(stringIndex, board.stringCount)}
          fill={`url(#${ref("string-metal")})`}
          opacity={0.55}
        />
      ))}

      {/* --- Open-string labels --- */}
      {Array.from({ length: board.stringCount }, (_, stringIndex) => {
        const open = noteAt(board, stringIndex, 0);
        if (!open) return null;
        return (
          <text
            key={`open-${stringIndex}`}
            x={geometry.nutX - 42}
            y={geometry.stringY(stringIndex) + 4}
            textAnchor="middle"
            className="readout"
            fontSize={11}
            fill="#5a6a85"
          >
            {open.name}
            <tspan fontSize={8} dy={-4}>
              {open.octave}
            </tspan>
          </text>
        );
      })}

      {/* --- Fret numbers --- */}
      {frets.map((fret) =>
        fret === 0 ? null : (
          <text
            key={`number-${fret}`}
            x={geometry.slotX(fret)}
            y={geometry.neckBottom + 38}
            textAnchor="middle"
            className="readout"
            fontSize={10}
            fill={geometry.hasInlay(fret) || geometry.hasDoubleInlay(fret) ? "#93a3bd" : "#3d4a61"}
          >
            {fret}
          </text>
        ),
      )}

      {/* --- Scale path --- */}
      {pathPoints && (
        <polyline
          points={pathPoints}
          fill="none"
          stroke="rgba(34,224,214,0.35)"
          strokeWidth={1.5}
          strokeDasharray="5 5"
          strokeLinecap="round"
        />
      )}

      {/* --- Ghost positions --- */}
      {showGhosts &&
        Array.from({ length: board.stringCount }, (_, stringIndex) =>
          frets.map((fret) => {
            if (markerIndex.has(`${stringIndex}:${fret}`)) return null;
            return (
              <circle
                key={`ghost-${stringIndex}-${fret}`}
                cx={geometry.slotX(fret)}
                cy={geometry.stringY(stringIndex)}
                r={3}
                fill="rgba(148,176,255,0.10)"
              />
            );
          }),
        )}

      {/* --- Markers --- */}
      {markers.filter((m) => m.fret >= fromFret && m.fret <= lastFret).map((marker, markerIdx) => {
        const style = TONE_STYLES[marker.tone];
        const x = geometry.slotX(marker.fret);
        const y = geometry.stringY(marker.string);
        const radius = marker.emphasis ? 14 : 11.5;
        return (
          <g
            // The emphasised marker keys on the event id, not the position, so
            // a repeated note at the same fret still remounts the element and
            // replays the pop — otherwise identical string/fret markers are
            // index-qualified: a sequence that revisits a position (an
            // up-and-back exercise) legitimately yields two for one fret.
            key={
              marker.emphasis && activeEventId !== undefined
                ? `marker-live-${activeEventId}-${marker.string}-${marker.fret}`
                : `marker-${markerIdx}-${marker.string}-${marker.fret}`
            }
            className={marker.emphasis ? "animate-note-pop" : undefined}
            style={marker.emphasis ? { transformOrigin: `${x}px ${y}px` } : undefined}
          >
            {marker.emphasis && style.glow && (
              <circle cx={x} cy={y} r={radius} fill={style.glow} opacity={0.5} filter={`url(#${ref("marker-glow")})`}>
                <animate
                  attributeName="r"
                  values={`${radius};${radius * 1.9};${radius}`}
                  dur="1.2s"
                  repeatCount="indefinite"
                />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="1.2s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={x} cy={y} r={radius} fill={style.fill} stroke={style.stroke} strokeWidth={1.25} />
            <text
              x={x}
              y={y + 3.6}
              textAnchor="middle"
              className="readout"
              fontSize={marker.label.length > 2 ? 8.5 : 10}
              fontWeight={600}
              fill={style.text}
            >
              {marker.label}
            </text>
            {marker.order !== undefined && (
              <g>
                <circle cx={x + radius * 0.82} cy={y - radius * 0.82} r={6} fill="#04060b" stroke={style.stroke} strokeWidth={0.8} />
                <text
                  x={x + radius * 0.82}
                  y={y - radius * 0.82 + 2.6}
                  textAnchor="middle"
                  className="readout"
                  fontSize={7}
                  fill={style.stroke}
                >
                  {marker.order}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* --- Hit targets, drawn last so they sit on top --- */}
      {onSelect &&
        Array.from({ length: board.stringCount }, (_, stringIndex) =>
          frets.map((fret) => {
            const position = noteAt(board, stringIndex, fret);
            if (!position) return null;
            const left = fret === 0 ? geometry.nutX - 46 : geometry.fretX(fret - 1);
            const right = fret === 0 ? geometry.nutX - 8 : geometry.fretX(fret);
            return (
              <rect
                key={`hit-${stringIndex}-${fret}`}
                x={left}
                y={geometry.stringY(stringIndex) - geometry.stringGap / 2}
                width={Math.max(8, right - left)}
                height={geometry.stringGap}
                fill="transparent"
                className="cursor-pointer transition-[fill] duration-150 hover:fill-[rgba(34,224,214,0.10)]"
                onClick={() =>
                  onSelect({ string: stringIndex, fret, midi: position.midi })
                }
              >
                <title>{`${position.name}${position.octave} · string ${stringIndex + 1}, fret ${fret}`}</title>
              </rect>
            );
          }),
        )}
    </svg>
    </div>
  );
}
