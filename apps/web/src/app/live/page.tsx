"use client";

import {
  type MotionResult,
  type TrackingStatus,
  createNeckProjection,
  getInstrument,
  getScalePositions,
  unprojectPosition,
} from "@fretlight/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraStage, DETECT_H, DETECT_W, type OverlayMode } from "@/components/vision/CameraStage";
import { FallbackFretboard } from "@/components/vision/FallbackFretboard";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Stat } from "@/components/ui/Stat";
import { useDetection } from "@/hooks/useDetection";
import { useFretboardContext } from "@/hooks/useFretboard";
import { useMounted } from "@/hooks/useMounted";
import { detectionHub } from "@/lib/audio/detection-hub";
import { fretSynth } from "@/lib/audio/fret-synth";
import {
  CameraPermissionError,
  listVideoInputs,
  openCamera,
} from "@/lib/vision/camera";
import {
  type CalibrationCorners,
  type StoredCalibration,
  defaultCalibration,
  loadCalibration,
  saveCalibration,
} from "@/lib/vision/calibration";
import { useSession } from "@/store/session";
import { cn } from "@/lib/ui/cn";

interface NoteLogEntry {
  readonly id: number;
  readonly label: string;
  readonly octave: number;
  readonly cents: number;
  readonly degree: string | null;
}

export default function LivePage() {
  const mounted = useMounted();
  const { board, scale } = useFretboardContext();
  const instrumentId = useSession((s) => s.instrumentId);
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);

  const {
    activeMidi,
    reading,
    position,
    uiState,
    sourceKind,
    listening,
    error: audioError,
    starting,
    noteEventId,
  } = useDetection();

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [mirrored, setMirrored] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [showScale, setShowScale] = useState(true);
  const [calibration, setCalibration] = useState<StoredCalibration>(() => defaultCalibration());
  const [motion, setMotion] = useState<{ result: MotionResult; rate: number | null } | null>(null);
  const [tracking, setTracking] = useState<TrackingStatus | null>(null);
  // Auto-only. Manual four-corner alignment still exists in CameraStage and can
  // be brought back by passing mode="manual", but it is not the experience the
  // screen is for: the point is to pick the instrument up and have the overlay
  // find it.
  const mode: OverlayMode = "auto";
  const [showPanels, setShowPanels] = useState(false);
  const [log, setLog] = useState<NoteLogEntry[]>([]);

  const instrument = getInstrument(instrumentId);
  const logId = useRef(0);

  // Calibration is per instrument: a bass neck and a guitar neck are not the
  // same shape, and switching between them should not mean recalibrating.
  useEffect(() => {
    if (!mounted) return;
    setCalibration(loadCalibration(instrumentId) ?? defaultCalibration());
  }, [instrumentId, mounted]);

  const updateCorners = useCallback(
    (corners: CalibrationCorners) => {
      setCalibration((previous) => {
        const next = { ...previous, corners };
        saveCalibration(instrumentId, next);
        return next;
      });
    },
    [instrumentId],
  );

  const patchCalibration = useCallback(
    (partial: Partial<StoredCalibration>) => {
      setCalibration((previous) => {
        const next = { ...previous, ...partial };
        saveCalibration(instrumentId, next);
        return next;
      });
    },
    [instrumentId],
  );

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const next = await openCamera({
        ...(deviceId ? { deviceId } : { facingMode: "environment" as const }),
      });
      setStream((previous) => {
        for (const track of previous?.getTracks() ?? []) track.stop();
        return next;
      });
      setDevices(await listVideoInputs());
    } catch (error) {
      setCameraError(
        error instanceof CameraPermissionError
          ? error.message
          : `Could not open the camera: ${(error as Error)?.message ?? "unknown error"}`,
      );
    }
  }, [deviceId]);

  const stopCamera = useCallback(() => {
    setStream((previous) => {
      for (const track of previous?.getTracks() ?? []) track.stop();
      return null;
    });
    setCalibrating(false);
  }, []);

  // Release the camera when leaving the screen — a live capture indicator that
  // stays on after you navigate away is alarming, and rightly so.
  useEffect(() => stopCamera, [stopCamera]);

  const enableMicrophone = useCallback(async () => {
    if (!instrument) return;
    await detectionHub.useMicrophone({
      minFrequency: instrument.minFrequency,
      maxFrequency: instrument.maxFrequency,
    });
  }, [instrument]);

  useEffect(() => {
    void detectionHub.start();
  }, []);

  // Keep the position estimator pointed at the current neck.
  useEffect(() => {
    detectionHub.setFretboard(board, instrumentId);
  }, [board, instrumentId]);

  /**
   * Camera + audio fusion.
   *
   * There is no finger-landmark model in this pipeline — only neck-plane
   * tracking and frame-differencing motion (see `vision/motion.ts`'s own
   * doc comment on why). So this cannot say "the fingertip is here"; what it
   * can honestly say is "the scene has been moving around here, and here is
   * where that projects onto the fretboard we're tracking". That is real
   * information — a hand doing something is usually the only thing moving
   * in frame — just coarse, so it is handed to the estimator as a capped,
   * confidence-scaled hint, exactly like the manual "Hand at" control, and
   * never as a claimed measurement.
   *
   * Audio-only detection is unaffected when the camera is off, tracking is
   * lost, or the scene is still: the context is cleared and the estimator
   * falls back to its own inferred hand position, same as on every other
   * page. Nothing here can block a note from being detected.
   */
  useEffect(() => {
    const corners = tracking?.corners ?? null;
    const trackingConfidence = tracking?.confidence ?? 0;
    const centroid = motion?.result.active ? motion.result.centroid : null;

    if (!corners || !centroid || trackingConfidence < 0.5) {
      detectionHub.setPositionContext({});
      return;
    }

    const projection = createNeckProjection(corners, board.fretCount, board.stringCount);
    const estimate =
      projection &&
      unprojectPosition(projection, { x: centroid.x * DETECT_W, y: centroid.y * DETECT_H });

    if (!estimate) {
      detectionHub.setPositionContext({});
      return;
    }

    // Capped well below what real hand evidence would earn — this is a
    // proxy for "something is moving near here", not a hand measurement.
    const confidence = Math.min(0.5, trackingConfidence * 0.6);
    detectionHub.setPositionContext({
      handFret: { fret: estimate.fret, confidence },
      stringHint: { string: estimate.string, confidence },
    });

    return () => detectionHub.setPositionContext({});
  }, [tracking, motion, board]);

  /** Append to the note log on each newly confirmed note. */
  useEffect(() => {
    if (activeMidi === null || !reading) return;
    const degree = scale.notes.find((note) => note.pitchClass === reading.note.pitchClass);
    setLog((previous) =>
      [
        {
          id: logId.current++,
          label: reading.note.name,
          octave: reading.note.octave,
          cents: reading.cents,
          degree: degree?.degree ?? null,
        },
        ...previous,
      ].slice(0, 14),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMidi]);

  const scalePositions = useMemo(() => getScalePositions(board, scale), [board, scale]);

  const markers = useMemo<FretMarker[]>(() => {
    const out: FretMarker[] = scalePositions.map((p) => ({
      string: p.string,
      fret: p.fret,
      label: p.name,
      tone: p.isRoot ? "root" : "scale",
    }));
    if (!position) return out;

    // Exactly one live marker, at the estimated position. Lighting up every
    // place the pitch exists tells the player nothing about what they played.
    const key = `${position.string}:${position.fret}`;
    return [
      ...out.filter((marker) => `${marker.string}:${marker.fret}` !== key),
      {
        string: position.string,
        fret: position.fret,
        label: position.name,
        tone: "live" as const,
        emphasis: true,
      },
    ];
  }, [scalePositions, position]);

  const micLive = sourceKind === "microphone" && listening;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Live camera practice</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-dim)]">
            Point a camera at your instrument, line the overlay up with the neck once, and the
            scale is drawn onto the real fretboard.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={micLive ? "signal" : "warn"}>{micLive ? "mic live" : "virtual audio"}</Badge>
          <Badge tone={stream ? "signal" : "neutral"}>{stream ? "camera on" : "camera off"}</Badge>
        </div>
      </header>

      <div
        className={cn(
          "grid gap-5",
          // The camera is the point of this screen, so it gets the width by
          // default. The read-outs are available but not competing with it.
          showPanels ? "xl:grid-cols-[1fr_280px]" : "grid-cols-1",
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="relative">
            <CameraStage
              stream={stream}
              board={board}
              scale={scale}
              activeMidi={activeMidi}
              playedPosition={position}
              calibration={calibration}
              calibrating={calibrating}
              mode={mode}
              onCalibrationChange={updateCorners}
              onMotion={(result, rate) => setMotion({ result, rate })}
              onTracking={setTracking}
              showScaleOverlay={showScale}
              mirrored={mirrored}
            />

            {/* Tracking badge, so the state is never a mystery. */}
            {stream && mode === "auto" && (
              <span
                className={cn(
                  "readout absolute top-3 left-3 rounded-full border px-2.5 py-1 text-[10px] tracking-wider uppercase backdrop-blur-md",
                  tracking?.state === "tracking"
                    ? "border-[rgba(57,224,139,0.5)] bg-[rgba(57,224,139,0.14)] text-[var(--color-correct)]"
                    : tracking?.state === "degraded"
                      ? "border-[rgba(255,194,71,0.5)] bg-[rgba(255,194,71,0.12)] text-[var(--color-warn)]"
                      : "border-[var(--color-hairline-bright)] bg-black/60 text-[var(--color-ink-faint)]",
                )}
              >
                {trackingLabel(tracking)}
              </span>
            )}

            {/* No fallback fretboard over the video: the neck reference below this
                panel already shows one, and stacking two on the same screen was
                just noise. When tracking is lost the badge says so. */}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {stream ? (
              <>
                <Button variant="ghost" onClick={stopCamera}>
                  Stop camera
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={() => void startCamera()}>
                Start camera
              </Button>
            )}

            {!micLive && (
              <Button onClick={() => void enableMicrophone()} disabled={starting}>
                {starting ? "Opening…" : "Use microphone"}
              </Button>
            )}

            <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-dim)]">
              <input
                type="checkbox"
                checked={showScale}
                onChange={(event) => setShowScale(event.target.checked)}
                className="h-4 w-4 accent-[var(--color-signal)]"
              />
              Scale overlay
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-dim)]">
              <input
                type="checkbox"
                checked={showPanels}
                onChange={(event) => setShowPanels(event.target.checked)}
                className="h-4 w-4 accent-[var(--color-signal)]"
              />
              Read-outs
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-dim)]">
              <input
                type="checkbox"
                checked={mirrored}
                onChange={(event) => setMirrored(event.target.checked)}
                className="h-4 w-4 accent-[var(--color-signal)]"
              />
              Mirror
            </label>
          </div>


          {(cameraError || audioError) && (
            <div className="rounded-xl border border-[rgba(255,84,112,0.35)] bg-[rgba(255,84,112,0.08)] p-3 text-xs leading-relaxed text-[var(--color-ink-dim)]">
              {cameraError ?? audioError}
            </div>
          )}

          {devices.length > 1 && (
            <select
              value={deviceId}
              onChange={(event) => {
                setDeviceId(event.target.value);
                void startCamera();
              }}
              className="h-9 w-fit rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-xs text-[var(--color-ink-dim)]"
            >
              <option value="">Default camera</option>
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || "Camera"}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Read-outs, off by default so nothing competes with the instrument. */}
        {showPanels && (
        <div className="flex flex-col gap-5">
          <Panel title="Heard" tight>
            <div className="flex flex-col gap-1">
              {log.length === 0 && (
                <p className="p-2 text-xs text-[var(--color-ink-faint)]">
                  Notes appear here as they are confirmed.
                </p>
              )}
              {log.map((entry, index) => (
                <div
                  key={entry.id}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-opacity",
                    index === 0 && "bg-[rgba(34,224,214,0.1)]",
                  )}
                  style={{ opacity: Math.max(0.25, 1 - index * 0.07) }}
                >
                  <span className="readout text-sm font-semibold">
                    {entry.label}
                    <span className="text-[10px] text-[var(--color-ink-faint)]">{entry.octave}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {entry.degree && (
                      <span className="readout text-[10px] text-[var(--color-theory-bright)]">
                        {entry.degree}
                      </span>
                    )}
                    <span
                      className={cn(
                        "readout text-[10px]",
                        Math.abs(entry.cents) <= 5
                          ? "text-[var(--color-correct)]"
                          : "text-[var(--color-ink-faint)]",
                      )}
                    >
                      {entry.cents > 0 ? "+" : ""}
                      {entry.cents.toFixed(0)}¢
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Movement">
            {motion ? (
              <div className="flex flex-col gap-4">
                <Stat
                  label="Picking rate"
                  value={motion.rate === null ? "—" : Math.round(motion.rate)}
                  unit="/min"
                  tone="signal"
                />
                <div>
                  <span className="hud-label mb-2 block">Activity</span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-hairline)]">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-100",
                        motion.result.active
                          ? "bg-[var(--color-signal)]"
                          : "bg-[var(--color-hairline-bright)]",
                      )}
                      style={{ width: `${Math.min(100, motion.result.energy * 900)}%` }}
                    />
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
                  Frame differencing, computed on this device at 12 fps. Supporting
                  information only — the note you played is decided by audio.
                </p>
              </div>
            ) : (
              <p className="text-xs text-[var(--color-ink-faint)]">
                Start the camera to measure picking movement.
              </p>
            )}
          </Panel>
        </div>
        )}
      </div>

      <Panel title="Neck reference">
        <Fretboard
          board={board}
          markers={mounted ? markers : []}
          activeEventId={noteEventId}
          lowStringOnTop={lowStringOnTop}
          onSelect={(position) => {
            detectionHub.mock?.pluck(position.midi);
            void fretSynth.pluck(position.midi);
          }}
        />
      </Panel>
    </div>
  );
}

function trackingLabel(status: TrackingStatus | null): string {
  if (!status) return "starting";
  switch (status.state) {
    case "tracking":
      return `tracking ${Math.round(status.confidence * 100)}%`;
    case "degraded":
      return "holding pose";
    case "acquiring":
      return "acquiring";
    case "fallback":
      return "lost — using panel";
    default:
      return "looking for neck";
  }
}
