export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/fretboard", label: "Fretboard", icon: "M3 6h18M3 12h18M3 18h18M8 4v16M14 4v16" },
  { href: "/tuner", label: "Tuner", icon: "M12 3v18M6 8v8M18 8v8M3 11v2M21 11v2" },
  { href: "/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" },
];
