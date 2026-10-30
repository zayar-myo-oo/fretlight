"use client";

import { useEffect, useState } from "react";
import type { SmoothingLevel } from "@/lib/audio/detection-hub";
import { detectionHub } from "@/lib/audio/detection-hub";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Slider } from "@/components/ui/Slider";
import { useSession } from "@/store/session";

/**
 * Input calibration: gain, noise gate and smoothing, all live-adjustable
 * with nothing about the audio stream restarted (see `useCalibration` and
 * `detectionHub`'s calibration methods). Latency is shown, not adjustable —
 * the browser does not expose a knob for it, and faking one would be worse
 * than not having it.
 */
export function CalibrationPanel({ live }: { live: boolean }) {
  const gain = useSession((s) => s.inputGain);
  const noiseGate = useSession((s) => s.inputNoiseGate);
  const smoothing = useSession((s) => s.inputSmoothing);
  const patch = useSession((s) => s.patch);

  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    if (!live) {
      setLatencyMs(null);
      return;
    }
    const read = () => {
      const seconds = detectionHub.estimatedLatencySeconds;
      setLatencyMs(seconds === null ? null : Math.round(seconds * 1000));
    };
    read();
    const interval = setInterval(read, 2000);
    return () => clearInterval(interval);
  }, [live]);

  return (
    <div className="flex flex-col gap-4 border-t border-[var(--color-hairline)] pt-4">
      <div className="flex items-center justify-between">
        <h3 className="hud-label">Calibration</h3>
        <span className="readout text-[10px] text-[var(--color-ink-faint)]">
          {latencyMs === null ? "output latency —" : `browser output latency ~${latencyMs}ms`}
        </span>
      </div>

      <Slider
        label={`Input gain  ${gain.toFixed(1)}×`}
        min={0.5}
        max={3}
        step={0.1}
        value={gain}
        onChange={(value) => patch({ inputGain: value })}
      />

      <Slider
        label={`Noise gate  ${noiseGate === 1 ? "auto" : `${noiseGate.toFixed(2)}×`}`}
        min={1}
        max={3}
        step={0.25}
        value={noiseGate}
        onChange={(value) => patch({ inputNoiseGate: value })}
      />

      <div>
        <span className="hud-label mb-2 block">Smoothing</span>
        <SegmentedControl
          size="sm"
          options={[
            { value: "low", label: "Low", hint: "Fastest response, more jitter" },
            { value: "medium", label: "Medium", hint: "Balanced (default)" },
            { value: "high", label: "High", hint: "Steadiest, slower to respond" },
          ]}
          value={smoothing}
          onChange={(value) => patch({ inputSmoothing: value as SmoothingLevel })}
        />
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        Gain and the noise gate apply instantly, without reopening the input. Raise
        the noise gate only if a noisy room is triggering false detections — it
        cannot recover quiet playing the pipeline already filtered out.
      </p>
    </div>
  );
}
