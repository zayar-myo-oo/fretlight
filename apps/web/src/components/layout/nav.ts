export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly hint: string;
  /** Inline SVG path data, so navigation costs no extra request and works offline. */
  readonly icon: string;
  /**
   * Gets a slot in the phone tab bar itself rather than behind "More".
   * The desktop rail always shows every item regardless of this flag — it
   * only exists because a phone-width bottom bar cannot fit eight tabs
   * without each one shrinking past the point of being tappable.
   */
  readonly mobilePrimary?: boolean;
  /** Which goal this tool serves; the rail and the More sheet group by it. */
  readonly group: NavGroup;
}

export type NavGroup = "home" | "learn" | "play" | "practice" | "progress" | "settings";

export const NAV_GROUPS: readonly NavGroup[] = ["home", "learn", "play", "practice", "progress", "settings"];

export const NAV_ITEMS: readonly NavItem[
  ] = [
  {
    href: "/",
    group: "home",
    label: "Home",
    hint: "Start here: choose what to do",
    icon: "M4 11.5 12 4l8 7.5M6.5 10v9.5h11V10",
    mobilePrimary: true,
  },
  {
    href: "/tuner",
    group: "learn",
    label: "Tuner",
    hint: "Chromatic tuner",
    icon: "M12 3v18M6 8v8M18 8v8M3 11v2M21 11v2",
    mobilePrimary: true,
  },
  {
    href: "/fretboard",
    group: "learn",
    label: "Fretboard",
    hint: "Explore scales and chords, find a key, listen to your playing",
    icon: "M3 6h18M3 12h18M3 18h18M8 4v16M14 4v16",
  },
  {
    href: "/song",
    group: "learn",
    label: "Song",
    hint: "Learn a piece phrase by phrase",
    icon: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  },
  {
    href: "/live",
    group: "learn",
    label: "Live",
    hint: "Camera overlay on your real neck",
    icon: "M4 7h3l1.5-2h7L17 7h3v12H4V7Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  },
  {
    href: "/companion",
    group: "play",
    label: "Companion",
    hint: "What can I play? Ideas, triads, fills and a looper",
    icon: "M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 10l10-2",
    mobilePrimary: true,
  },
  {
    href: "/bassline",
    group: "play",
    label: "Bassline",
    hint: "Turn a chord progression into a bassline to practice",
    icon: "M4 18V8l6-2v10M10 6l10-2v10M10 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  },
  {
    href: "/practice",
    group: "practice",
    label: "Practice",
    hint: "Drills that listen and score you",
    icon: "M5 12a7 7 0 1 0 14 0 7 7 0 0 0-14 0Zm7-4v4l3 2",
    mobilePrimary: true,
  },
  {
    href: "/ear",
    group: "practice",
    label: "Ear Training",
    hint: "Name intervals and chord types by ear",
    icon: "M8 18a3 3 0 0 0 3-3c0-2 3-3 3-6a5 5 0 1 0-10 0M14 9a2 2 0 1 0-4 0",
  },
  {
    href: "/analyzer",
    group: "practice",
    label: "Analyzer",
    hint: "Find the chords, key and sections of a song",
    icon: "M3 12h3l2-6 3 12 3-9 2 5 2-2h3",
  },
  {
    href: "/metronome",
    group: "practice",
    label: "Metronome",
    hint: "Tempo and rhythm",
    icon: "M12 3 7 21h10L12 3Zm0 0v12M5 21h14",
  },
  {
    href: "/progress",
    group: "progress",
    label: "Progress",
    hint: "Practice time, accuracy and streaks",
    icon: "M4 19V9m6.5 10V5m6.5 14v-7",
  },
  {
    href: "/settings",
    group: "settings",
    label: "Settings",
    hint: "Instrument, tuning, language, sound and your data",
    icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  },
];
