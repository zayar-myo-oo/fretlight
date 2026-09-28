export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly hint: string;
  /** Inline SVG path data, so navigation costs no extra request and works offline. */
  readonly icon: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/",
    label: "Home",
    hint: "Instrument and session",
    icon: "M4 11.5 12 4l8 7.5M6.5 10v9.5h11V10",
  },
  {
    href: "/tuner",
    label: "Tuner",
    hint: "Chromatic tuner",
    icon: "M12 3v18M6 8v8M18 8v8M3 11v2M21 11v2",
  },
  {
    href: "/fretboard",
    label: "Fretboard",
    hint: "Scales, chords, note finder",
    icon: "M3 6h18M3 12h18M3 18h18M8 4v16M14 4v16",
  },
  {
    href: "/metronome",
    label: "Metronome",
    hint: "Tempo and rhythm",
    icon: "M12 3 7 21h10L12 3Zm0 0v12M5 21h14",
  },
  {
    href: "/live",
    label: "Live",
    hint: "Camera overlay on your real neck",
    icon: "M4 7h3l1.5-2h7L17 7h3v12H4V7Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  },
  {
    href: "/practice",
    label: "Practice",
    hint: "Guided scale trainer",
    icon: "M5 12a7 7 0 1 0 14 0 7 7 0 0 0-14 0Zm7-4v4l3 2",
  },
  {
    href: "/song",
    label: "Song",
    hint: "Learn a piece phrase by phrase",
    icon: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  },
  {
    href: "/bassline",
    label: "Bassline",
    hint: "Turn a chord progression into a bassline to practice",
    icon: "M4 18V8l6-2v10M10 6l10-2v10M10 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  },
];
