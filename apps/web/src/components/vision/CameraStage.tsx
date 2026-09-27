"use client";

import {
  type Fretboard,
  MotionAccumulator,
  MotionDetector,
  type MotionResult,
  type Point,
  type Scale,
  StrokeCounter,
  type TrackingStatus,
  createNeckProjection,
  getScalePositions,
  projectFretLine,
  projectPosition,
  projectStringLine,
} from "@fretlight/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GreyscaleSampler } from "@/lib/vision/camera";
import { NeckTrackingClient } from "@/lib/vision/neck-tracking-client";
import type { CalibrationCorners, StoredCalibration } from "@/lib/vision/calibration";
import { cn } from "@/lib/ui/cn";

/** Detection resolution. Higher costs more and helps surprisingly little. */
/**
 * Detection resolution.
 *
 * 160x120 was too coarse for a real instrument: a neck a metre from a webcam is
 * about twenty pixels across at that size, so the strings and fret wires that
 * identify it as a fretboard are sub-pixel and there is nothing left to find.
 * At 320x240 they resolve, and the work still fits comfortably in a worker.
 */
const DETECT_W = 320;
const DETECT_H = 240;

export type OverlayMode = "auto" | "manual";

export interface CameraStageProps {
  readonly stream: MediaStream | null;
  readonly board: Fretboard;
  readonly scale: Scale;
  readonly activeMidi: number | null;
  /** The one position the note was most likely played at — not every match. */
  readonly playedPosition?: { string: number; fret: number } | null;
  readonly target?: { string: number; fret: number } | null;
  readonly calibration: StoredCalibration;
  readonly calibrating: boolean;
  readonly mode: OverlayMode;
  readonly onCalibrationChange: (corners: CalibrationCorners) => void;
  readonly onMotion?: (result: MotionResult, strokesPerMinute: number | null) => void;
  readonly onTracking?: (status: TrackingStatus) => void;
  readonly showScaleOverlay?: boolean;
  readonly mirrored?: boolean;
  readonly className?: string;
}

const CORNER_LABELS = [
  "Nut · low string",
  "Far fret · low string",
  "Far fret · high string",
  "Nut · high string",
];

/**
 * The camera view and everything drawn on top of it.
 *
 * Two ways the overlay can be positioned:
 *
 *  - **auto** — a worker detects the neck, a tracker smooths and defends the
 *    pose, and the overlay follows the instrument as it moves.
 *  - **manual** — four corners the player drags, which is exact and never fails,
 *    and is the right answer when the camera angle or lighting defeats detection.
 *
 * When automatic tracking cannot hold a lock, the overlay is *removed* rather
 * than left floating in the wrong place, and the parent shows a stable fallback
 * fretboard instead. An overlay that is confidently wrong is worse than no
 * overlay at all.
 *
 * Rendering is capped at ~30 fps and motion analysis at ~12; detection runs at
 * an adaptive rate the tracker decides. None of it is allowed to compete with
 * the audio path.
 */
export function CameraStage({
  stream,
  board,
  scale,
  activeMidi,
  playedPosition,
  target,
  calibration,
  calibrating,
  mode,
  onCalibrationChange,
  onMotion,
  onTracking,
  showScaleOverlay = true,
  mirrored = false,
  className,
}: CameraStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const stateRef = useRef({
    calibration, activeMidi, playedPosition, target, showScaleOverlay, scale, board, mode,
  });
  stateRef.current = {
    calibration, activeMidi, playedPosition, target, showScaleOverlay, scale, board, mode,
  };

  const scalePositions = useMemo(() => getScalePositions(board, scale), [board, scale]);
  const scaleRef = useRef(scalePositions);
  scaleRef.current = scalePositions;

  const trackerRef = useRef<NeckTrackingClient | null>(null);
  const onMotionRef = useRef(onMotion);
  onMotionRef.current = onMotion;
  const onTrackingRef = useRef(onTracking);
  onTrackingRef.current = onTracking;
  /**
   * Last reported tracking state, so the parent is only notified when something
   * it would actually display has changed. Calling back on every drawn frame
   * would re-render the page 30 times a second to move a percentage readout —
   * the overlay itself is drawn on canvas and needs no React involvement at all.
   */
  const reportedRef = useRef<string>("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
  }, [stream]);

  /** Seed the tracker from a manual alignment so the two modes agree. */
  useEffect(() => {
    if (mode !== "manual") return;
    trackerRef.current?.seedFromFractions(calibration.corners);
  }, [mode, calibration.corners]);

  useEffect(() => {
    if (!stream) return;

    let frame = 0;
    let lastDraw = 0;
    let lastMotion = 0;
    const DRAW_INTERVAL = 1000 / 30;
    const MOTION_INTERVAL = 1000 / 12;

    let sampler: GreyscaleSampler;
    let motion: MotionDetector;
    let activity: MotionAccumulator;
    let strokes: StrokeCounter;
    let tracker: NeckTrackingClient;
    try {
      sampler = new GreyscaleSampler(DETECT_W, DETECT_H);
      motion = new MotionDetector({ width: DETECT_W, height: DETECT_H });
      // Builds up over a few seconds, then tells the detector which parts of the
      // picture are alive. The room is not.
      activity = new MotionAccumulator(DETECT_W, DETECT_H);
      strokes = new StrokeCounter();
      tracker = new NeckTrackingClient(DETECT_W, DETECT_H, {
        detectWidth: DETECT_W,
        detectHeight: DETECT_H,
      });
    } catch {
      // Nothing here needs the network or a worker, so a failure means the
      // browser is missing something fundamental. Bail rather than starting a
      // loop that would throw on every frame.
      return;
    }
    // Must never abort the loop: the camera preview, the motion analysis and the
    // manual overlay all live in here, and none of them need the worker.
    try {
      tracker.start();
    } catch {
      // The client records its own failure; nothing more to do here.
    }
    trackerRef.current = tracker;

    // Refs outlive the effect, so a remount (StrictMode does one on every mount
    // in development) would otherwise pair a brand-new tracker with the previous
    // run's signature — they match, no callback fires, and the parent never
    // learns the tracking state at all.
    reportedRef.current = "";

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);

      const canvas = canvasRef.current;
      const container = containerRef.current;
      const video = videoRef.current;
      if (!canvas || !container || !video) return;

      // One greyscale sample serves both detection and motion — no reason to
      // pull pixels out of the video twice.
      const needsMotion = now - lastMotion >= MOTION_INTERVAL;
      const grey = needsMotion ? sampler.sample(video) : null;

      if (grey) {
        lastMotion = now;
        const result = motion.process(grey);
        strokes.push(result.energy, now / 1000);
        onMotionRef.current?.(result, strokes.rate());
        // The tracker declines most of these; it decides its own rate.
        const activityMap = activity.push(grey);
        tracker.offer(grey, now, sampler.warmth, activity.isWarm ? activityMap : undefined);
      }

      if (now - lastDraw < DRAW_INTERVAL) return;
      lastDraw = now;

      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;

      const status = tracker.current(width, height);
      // Confidence is bucketed to 10% so a jittering value does not defeat this.
      const signature = `${status.state}:${Math.round(status.confidence * 10)}:${status.usingFallback}`;
      if (signature !== reportedRef.current) {
        reportedRef.current = signature;
        onTrackingRef.current?.(status);
      }

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const state = stateRef.current;
      const corners =
        state.mode === "manual"
          ? (state.calibration.corners.map((corner) => ({
              x: corner.x * width,
              y: corner.y * height,
            })) as [Point, Point, Point, Point])
          : status.corners;

      // No pose means no overlay. The parent shows the fallback fretboard.
      if (corners) {
        drawOverlay(context, state, scaleRef.current, corners, status.confidence);
      }
    };

    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      tracker.stop();
      trackerRef.current = null;
      sampler.dispose();
    };
  }, [stream]);

  const handlePointer = useCallback((event: React.PointerEvent, index: number) => {
    const container = containerRef.current;
    if (!container) return;
    event.preventDefault();
    (event.target as Element).setPointerCapture(event.pointerId);
    setDragging(index);
  }, []);

  const handleMove = useCallback(
    (event: React.PointerEvent) => {
      if (dragging === null) return;
      const container = containerRef.current;
      if (!container) return;
      const box = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
      const y = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
      const next = [...calibration.corners] as CalibrationCorners;
      next[dragging] = { x, y };
      onCalibrationChange(next);
    },
    [dragging, calibration.corners, onCalibrationChange],
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-2xl border border-[var(--color-hairline)] bg-black",
        className,
      )}
      onPointerMove={handleMove}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        className={cn("h-full w-full object-cover", mirrored && "scale-x-[-1]")}
      />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {calibrating &&
        calibration.corners.map((corner, index) => (
          <button
            key={index}
            onPointerDown={(event) => handlePointer(event, index)}
            title={CORNER_LABELS[index]}
            style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
            className={cn(
              "absolute z-10 h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 transition-transform active:cursor-grabbing",
              dragging === index
                ? "scale-125 border-[var(--color-signal-bright)] bg-[rgba(34,224,214,0.4)]"
                : "border-[var(--color-signal)] bg-[rgba(34,224,214,0.18)]",
            )}
          >
            <span className="readout absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded bg-black/75 px-1.5 py-0.5 text-[9px] whitespace-nowrap text-[var(--color-signal)]">
              {index + 1}
            </span>
          </button>
        ))}

      {!stream && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="hud-label">camera off</span>
        </div>
      )}
    </div>
  );
}

interface DrawState {
  calibration: StoredCalibration;
  activeMidi: number | null;
  playedPosition?: { string: number; fret: number } | null;
  target?: { string: number; fret: number } | null;
  showScaleOverlay: boolean;
  scale: Scale;
  board: Fretboard;
  mode: OverlayMode;
}

function drawOverlay(
  context: CanvasRenderingContext2D,
  state: DrawState,
  scalePositions: ReturnType<typeof getScalePositions>,
  corners: [Point, Point, Point, Point],
  confidence: number,
): void {
  const { calibration, board, scale, playedPosition, target, showScaleOverlay } = state;

  const projection = createNeckProjection(corners, calibration.lastFret, board.stringCount);
  if (!projection) return;

  const stringOf = (index: number) =>
    calibration.lowStringOnTop ? index : board.stringCount - 1 - index;

  // Fade the whole overlay with tracking confidence, so a shaky lock looks
  // uncertain instead of asserting a position it is not sure about.
  const alpha = state.mode === "manual" ? 1 : 0.35 + confidence * 0.65;

  context.save();
  context.globalAlpha = alpha;

  context.strokeStyle = "rgba(34, 224, 214, 0.55)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) context.lineTo(corners[i]!.x, corners[i]!.y);
  context.closePath();
  context.stroke();

  context.strokeStyle = "rgba(180, 205, 255, 0.26)";
  context.lineWidth = 1;
  for (let fret = 0; fret <= calibration.lastFret; fret++) {
    const [a, b] = projectFretLine(projection, fret);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }

  context.strokeStyle = "rgba(180, 205, 255, 0.16)";
  for (let s = 0; s < board.stringCount; s++) {
    const [a, b] = projectStringLine(projection, s);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }

  if (showScaleOverlay) {
    for (const position of scalePositions) {
      if (position.fret > calibration.lastFret) continue;
      const point = projectPosition(projection, stringOf(position.string), position.fret);
      drawMarker(context, point, {
        radius: position.isRoot ? 9 : 7,
        fill: position.isRoot ? "rgba(255, 92, 138, 0.85)" : "rgba(139, 124, 255, 0.5)",
        stroke: position.isRoot ? "#ff9ab5" : "rgba(184,174,255,0.75)",
        label: position.name,
        textColor: position.isRoot ? "#1a0710" : "#efeaff",
      });
    }
  }

  // The played note: one marker, at the position actually estimated — not every
  // place on the neck where that pitch happens to exist.
  if (playedPosition && playedPosition.fret <= calibration.lastFret) {
    context.globalAlpha = 1;
    const point = projectPosition(projection, stringOf(playedPosition.string), playedPosition.fret);
    const pulse = 1 + Math.sin(performance.now() / 150) * 0.1;
    drawMarker(context, point, {
      radius: 13 * pulse,
      fill: "rgba(255,255,255,0.96)",
      stroke: "#ffffff",
      glow: "rgba(255,255,255,0.75)",
      label: "",
      textColor: "#05070c",
    });
    context.globalAlpha = alpha;
  }

  if (target && target.fret <= calibration.lastFret) {
    const point = projectPosition(projection, stringOf(target.string), target.fret);
    const pulse = 1 + Math.sin(performance.now() / 220) * 0.18;
    drawMarker(context, point, {
      radius: 14 * pulse,
      fill: "rgba(34, 224, 214, 0.9)",
      stroke: "#7efff6",
      glow: "rgba(34,224,214,0.7)",
      label: "",
      textColor: "#022523",
    });
  }

  // Scale name, rotated to follow the neck — legible at any instrument angle.
  const [nutTop] = projectFretLine(projection, 0);
  const [farTop] = projectFretLine(projection, calibration.lastFret);
  const angle = Math.atan2(farTop.y - nutTop.y, farTop.x - nutTop.x);
  context.translate(nutTop.x, nutTop.y - 14);
  context.rotate(angle);
  context.font = "600 15px ui-monospace, monospace";
  context.fillStyle = "rgba(34, 224, 214, 0.9)";
  context.shadowColor = "rgba(0,0,0,0.85)";
  context.shadowBlur = 6;
  context.fillText(`${scale.rootName} ${scale.definition.name}`.toUpperCase(), 6, 0);
  context.restore();
}

function drawMarker(
  context: CanvasRenderingContext2D,
  point: Point,
  options: {
    radius: number;
    fill: string;
    stroke: string;
    label: string;
    textColor: string;
    glow?: string;
  },
): void {
  context.save();
  if (options.glow) {
    context.shadowColor = options.glow;
    context.shadowBlur = 18;
  }
  context.beginPath();
  context.arc(point.x, point.y, options.radius, 0, Math.PI * 2);
  context.fillStyle = options.fill;
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = 1.2;
  context.strokeStyle = options.stroke;
  context.stroke();

  if (options.label) {
    context.font = "600 9px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = options.textColor;
    context.fillText(options.label, point.x, point.y);
  }
  context.restore();
}
