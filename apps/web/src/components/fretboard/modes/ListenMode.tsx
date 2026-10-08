"use client";

import { type MusicKey, getKey, type KeyMode } from "@fretlight/core";
import { useEffect, useMemo, useState } from "react";
import { InputBar } from "@/components/audio/InputBar";
import { LiveChordPanel } from "@/components/audio/LiveChordPanel";
import { DisplayMenu } from "@/components/fretboard/DisplayMenu";
import { Fretboard, type FretMarker } from "@/components/fretboard/Fretboard";
import { PositionReadout } from "@/components/fretboard/PositionReadout";
import { NotePicker } from "@/components/ui/NotePicker";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { CameraStage } from "@/components/vision/CameraStage";
import { useDetection } from "@/hooks/useDetection";
import { useFretboardContext } from "@/hooks/useFretboard";
import { useHandPosition } from "@/hooks/useHandPosition";
import { detectionHub } from "@/lib/audio/detection-hub";
import { defaultCalibration } from "@/lib/vision/calibration";
import { openCamera } from "@/lib/vision/camera";
import { useSession } from "@/store/session";

type Target = "chords" | "notes";

/**
 * Listen to your instrument. Two separate jobs share one tab, and only one
 * input is ever open at a time: whole chords (name them), or single notes
 * (show where on the neck they were played).
 */
export function ListenMode() {
  const [target, setTarget] = useState<Target>("chords");

  // Only one microphone consumer at a time: leaving "notes" releases its input.
  const choose = (next: Target) => {
    if (next === "chords") void detectionHub.disable();
    setTarget(next);
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="What should I listen for?"
        meta={
          <SegmentedControl
            options={[
              { value: "chords", label: "Chords", hint: "Strum a chord and get its name" },
              { value: "notes", label: "Single notes", hint: "Play a note and see where it is on the neck" },
            ]}
            value={target}
            onChange={choose}
          />
        }
      >
        <p className="text-sm text-[var(--color-ink-dim)]">
          {target === "chords"
            ? "Strum a chord on your guitar or bass and see its name, notes and place in a key."
            : "Play one note at a time and see exactly where on the neck it was played."}
        </p>
      </Panel>

      {target === "chords" ? <ChordListening /> : <NoteListening />}
    </div>
  );
}

function ChordListening() {
  const [mode, setMode] = useState<KeyMode>("major");
  const [root, setRoot] = useState<number | null>(null);
  const activeKey: MusicKey | null = useMemo(() => (root === null ? null : getKey(root, mode)), [root, mode]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <LiveChordPanel activeKey={activeKey} />
      <Panel
        title="Key context (optional)"
        meta={
          <SegmentedControl
            size="sm"
            options={[
              { value: "major", label: "Major" },
              { value: "minor", label: "Minor" },
            ]}
            value={mode}
            onChange={setMode}
          />
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-[var(--color-ink-dim)]">
          Pick the key you&apos;re playing in and each detected chord also shows its Roman numeral
          (like V7 in C Major).
        </p>
        <NotePicker value={root ?? -1} onChange={(pc) => setRoot(pc === root ? null : pc)} />
        <p className="mt-2 text-[11px] text-[var(--color-ink-faint)]">
          {activeKey ? `${activeKey.name} — tap the note again to clear` : "No key selected"}
        </p>
      </Panel>
    </div>
  );
}

function NoteListening() {
  const { board, scale } = useFretboardContext();
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);
  const { position, noteEventId } = useDetection();
  const handFret = useHandPosition();
  const [cameraOn, setCameraOn] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  // Camera lifecycle, kept separate from the microphone: turning one off must
  // never affect the other. Audio says *what* was played; the camera only helps
  // with *where*.
  useEffect(() => {
    let cancelled = false;
    if (!cameraOn) {
      setStream((previous) => {
        for (const track of previous?.getTracks() ?? []) track.stop();
        return null;
      });
      return;
    }
    void openCamera({ facingMode: "environment" })
      .then((next) => {
        if (cancelled) {
          for (const track of next.getTracks()) track.stop();
          return;
        }
        setStream(next);
      })
      .catch(() => setCameraOn(false));
    return () => {
      cancelled = true;
    };
  }, [cameraOn]);

  // A capture indicator that stays lit after you leave the screen is alarming.
  useEffect(
    () => () => {
      setStream((previous) => {
        for (const track of previous?.getTracks() ?? []) track.stop();
        return null;
      });
    },
    [],
  );

  const markers = useMemo<FretMarker[]>(
    () =>
      position
        ? [{ string: position.string, fret: position.fret, label: position.name, tone: "live", emphasis: true }]
        : [],
    [position],
  );

  return (
    <div className="flex flex-col gap-6">
      <InputBar cameraOn={cameraOn} onCameraChange={setCameraOn} />

      {cameraOn && (
        <Panel title="Camera" tight>
          <CameraStage
            stream={stream}
            board={board}
            scale={scale}
            activeMidi={null}
            playedPosition={position ? { string: position.string, fret: position.fret } : null}
            calibration={defaultCalibration()}
            calibrating={false}
            mode="auto"
            onCalibrationChange={() => {}}
            showScaleOverlay={false}
          />
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            The camera helps decide <em>where</em> a note was played. What pitch it was is always decided by audio.
          </p>
        </Panel>
      )}

      <Panel title="What you played">
        <PositionReadout board={board} />
      </Panel>

      <Panel title="Where on the neck" meta={<DisplayMenu showLabels={false} />}>
        <Fretboard
          board={board}
          markers={markers}
          activeEventId={noteEventId}
          {...(handFret !== null ? { handWindow: { from: handFret, to: handFret + 4 } } : {})}
          lowStringOnTop={lowStringOnTop}
        />
      </Panel>
    </div>
  );
}
