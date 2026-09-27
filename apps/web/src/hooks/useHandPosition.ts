"use client";

import { useEffect } from "react";
import { detectionHub } from "@/lib/audio/detection-hub";
import { useSession } from "@/store/session";

/**
 * Feed the player's hand position into the position estimator.
 *
 * Every screen that shows "where you played it" needs this, and every screen
 * must agree, so it lives in one hook rather than being wired three times.
 */
export function useHandPosition(enabled = true): number | null {
  const handFret = useSession((s) => s.handFret);

  useEffect(() => {
    if (!enabled) return;
    detectionHub.setPositionContext(
      handFret === null
        ? {}
        : // High confidence: the player told us directly. This has to outweigh
          // the estimator's "easiest position" bias, which is what gets mid-neck
          // playing wrong.
          { handFret: { fret: handFret, confidence: 0.95 } },
    );
  }, [handFret, enabled]);

  return handFret;
}
