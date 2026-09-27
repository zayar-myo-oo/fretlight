"use client";

import { useEffect } from "react";
import { detectionHub } from "@/lib/audio/detection-hub";
import { useSession } from "@/store/session";

/**
 * Keeps `detectionHub`'s live calibration in sync with the persisted session
 * values.
 *
 * The hub is the source of truth while the app is running — it is what
 * `handleFrame` actually reads — and the session store is only where the
 * player's choice is remembered between visits. This hook is the one place
 * that pushes stored values into the hub, on mount and whenever they change,
 * so any component with input controls just needs to write to the store.
 */
export function useCalibration(): void {
  const gain = useSession((s) => s.inputGain);
  const noiseGate = useSession((s) => s.inputNoiseGate);
  const smoothing = useSession((s) => s.inputSmoothing);

  useEffect(() => {
    detectionHub.setGain(gain);
  }, [gain]);

  useEffect(() => {
    detectionHub.setNoiseGateMultiplier(noiseGate);
  }, [noiseGate]);

  useEffect(() => {
    detectionHub.setSmoothing(smoothing);
  }, [smoothing]);
}
