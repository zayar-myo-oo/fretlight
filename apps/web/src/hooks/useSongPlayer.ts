"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Plays the song the user loaded with a plain <audio> element, entirely from a
 * local object URL. The URL is revoked when the song changes or the page
 * closes, so the audio never outlives the visit.
 */
export function useSongPlayer(blob: Blob | null) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    setTime(0);
    setPlaying(false);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  // Follow playback smoothly; `timeupdate` alone only fires a few times a second.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (audioRef.current) setTime(audioRef.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  const seek = useCallback((seconds: number, play = false) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, seconds);
    setTime(audio.currentTime);
    if (play) void audio.play();
  }, []);

  const handlers = {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onSeeked: () => audioRef.current && setTime(audioRef.current.currentTime),
  };

  return { audioRef, url, time, playing, toggle, seek, handlers };
}
