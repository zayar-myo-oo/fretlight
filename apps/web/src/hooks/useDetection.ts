"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { type DetectionSnapshot, detectionHub } from "@/lib/audio/detection-hub";
import {
  EMPTY_AUDIO_STATE,
  EMPTY_PITCH_STATE,
  EMPTY_POSITION_STATE,
  EMPTY_SIGNAL_STATE,
  type AudioState,
  type FretPositionStateSlice,
  type PitchStateSlice,
  type SignalStateSlice,
} from "@/lib/audio/detection-state";

const SERVER_SNAPSHOT: DetectionSnapshot = {
  listening: false,
  sourceKind: "mock",
  sourceLabel: "Virtual instrument",
  error: null,
  starting: false,
  uiState: "no_signal",
  reading: null,
  activeMidi: null,
  held: false,
  instrumentConfidence: 0,
  rejectReason: null,
  clarity: 0,
  rms: 0,
  peak: 0,
  position: null,
  candidates: [],
  noteEventId: 0,
};

/**
 * Subscribe to live detection.
 *
 * `useSyncExternalStore` rather than a context provider: the hub notifies at
 * most ~30 times a second and only components calling this hook re-render.
 */
export function useDetection(): DetectionSnapshot {
  return useSyncExternalStore(
    detectionHub.subscribe,
    detectionHub.getSnapshot,
    () => SERVER_SNAPSHOT,
  );
}

/** Start listening when a screen mounts, and release the source on unmount. */
export function useAutoListen(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    void detectionHub.start();
    return () => {
      void detectionHub.stop();
    };
  }, [enabled]);
}

/**
 * Fire a callback once per *confirmed* note, rather than on every frame.
 * This is what animations and the practice engine should listen to.
 */
export function useNoteEvent(
  callback: (midi: number, time: number) => void,
  deps: readonly unknown[] = [],
): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useCallback(callback, deps);
  const { noteEventId, activeMidi } = useDetection();

  useEffect(() => {
    if (noteEventId === 0 || activeMidi === null) return;
    stable(activeMidi, detectionHub.now());
    // Keyed on noteEventId so a repeat of the same note still fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteEventId]);
}

/**
 * Slice hooks (spec §25).
 *
 * Each subscribes to the same hub but reads a different cached object, so a
 * component showing the device picker does not re-render when cents moves, and
 * one showing the fret position does not re-render when the level meter twitches.
 */
export function useAudioState(): AudioState {
  return useSyncExternalStore(
    detectionHub.subscribe,
    detectionHub.getAudioState,
    () => EMPTY_AUDIO_STATE,
  );
}

export function usePitchState(): PitchStateSlice {
  return useSyncExternalStore(
    detectionHub.subscribe,
    detectionHub.getPitchState,
    () => EMPTY_PITCH_STATE,
  );
}

export function useFretPositionState(): FretPositionStateSlice {
  return useSyncExternalStore(
    detectionHub.subscribe,
    detectionHub.getPositionState,
    () => EMPTY_POSITION_STATE,
  );
}

export function useSignalState(): SignalStateSlice {
  return useSyncExternalStore(
    detectionHub.subscribe,
    detectionHub.getSignalState,
    () => EMPTY_SIGNAL_STATE,
  );
}
