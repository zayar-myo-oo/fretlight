/**
 * Semantic tones for anything drawn on the neck.
 *
 * Colour carries meaning here rather than decoration: root notes are the anchor
 * a player orients from, the target is what to play next, and a live note is the
 * one thing on screen that is actually happening.
 */
export type MarkerTone =
  | "root"
  | "scale"
  | "chord"
  | "target"
  | "next"
  | "played"
  | "wrong"
  | "ghost"
  | "live";

export interface ToneStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly text: string;
  readonly glow?: string;
}

export const TONE_STYLES: Record<MarkerTone, ToneStyle> = {
  root:   { fill: "rgba(255, 92, 138, 0.92)",  stroke: "#ff9ab5", text: "#1a0710", glow: "rgba(255,92,138,0.55)" },
  scale:  { fill: "rgba(139, 124, 255, 0.24)", stroke: "rgba(184,174,255,0.75)", text: "#dcd6ff" },
  chord:  { fill: "rgba(34, 224, 214, 0.24)",  stroke: "rgba(126,255,246,0.8)",  text: "#c8fffb" },
  target: { fill: "rgba(34, 224, 214, 0.95)",  stroke: "#7efff6", text: "#022523", glow: "rgba(34,224,214,0.6)" },
  next:   { fill: "rgba(34, 224, 214, 0.14)",  stroke: "rgba(34,224,214,0.5)",  text: "#8fe8e2" },
  played: { fill: "rgba(57, 224, 139, 0.92)",  stroke: "#7bf3b4", text: "#022613", glow: "rgba(57,224,139,0.55)" },
  wrong:  { fill: "rgba(255, 84, 112, 0.9)",   stroke: "#ff97a9", text: "#2a040c", glow: "rgba(255,84,112,0.5)" },
  ghost:  { fill: "rgba(148, 176, 255, 0.07)", stroke: "rgba(148,176,255,0.2)", text: "#7c8ba5" },
  live:   { fill: "rgba(255, 255, 255, 0.96)", stroke: "#ffffff", text: "#05070c", glow: "rgba(255,255,255,0.7)" },
};
