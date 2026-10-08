import type { CompanionStyle, Difficulty, FretSpot, IdeaCategory } from "@fretlight/core";

/** An idea kept on this device. Plain data, so it can be shown again without regenerating. */
export interface SavedIdea {
  readonly id: string;
  readonly savedAt: number;
  readonly progression: string;
  readonly key: string | null;
  readonly instrument: "guitar" | "bass";
  readonly style: CompanionStyle;
  readonly difficulty: Difficulty;
  readonly category: IdeaCategory;
  readonly title: string;
  readonly notes: readonly string[];
  readonly tab: readonly string[];
  readonly positions: readonly FretSpot[];
  readonly description: string;
}

const KEY = "fretlight.companion.ideas";
const LIMIT = 50;

export function loadSavedIdeas(): SavedIdea[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as SavedIdea[]) : [];
  } catch {
    return [];
  }
}

function write(ideas: readonly SavedIdea[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(ideas.slice(0, LIMIT)));
    return true;
  } catch {
    return false;
  }
}

/** Newest first. Returns the new list, or null if the browser would not store it. */
export function saveIdea(idea: SavedIdea): SavedIdea[] | null {
  const next = [idea, ...loadSavedIdeas().filter((i) => i.id !== idea.id)];
  return write(next) ? next.slice(0, LIMIT) : null;
}

export function deleteIdea(id: string): SavedIdea[] {
  const next = loadSavedIdeas().filter((i) => i.id !== id);
  write(next);
  return next;
}
