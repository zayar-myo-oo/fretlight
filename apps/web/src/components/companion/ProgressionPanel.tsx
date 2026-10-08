"use client";

import {
  type CompanionStyle,
  DIFFICULTIES,
  DIFFICULTY_INFO,
  type Difficulty,
  type Progression,
  STYLE_IDS,
  STYLE_PROFILES,
} from "@fretlight/core";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cn } from "@/lib/ui/cn";

const PRESETS = ["C G Am F", "G D Em C", "Am F C G", "Cmaj7 Am7 Fmaj7 G7"];

export function ProgressionPanel({
  text,
  onText,
  progression,
  selected,
  onSelect,
  instrument,
  onInstrument,
  style,
  onStyle,
  difficulty,
  onDifficulty,
}: {
  text: string;
  onText: (text: string) => void;
  progression: Progression;
  selected: number;
  onSelect: (index: number) => void;
  instrument: "guitar" | "bass";
  onInstrument: (value: "guitar" | "bass") => void;
  style: CompanionStyle;
  onStyle: (value: CompanionStyle) => void;
  difficulty: Difficulty;
  onDifficulty: (value: Difficulty) => void;
}) {
  const key = progression.key;
  const profile = STYLE_PROFILES[style];

  return (
    <Panel title="1 · Your progression" meta={<Badge tone="theory">built in the browser</Badge>}>
      <div className="flex flex-col gap-5">
        <div>
          <label className="hud-label mb-1.5 block" htmlFor="progression">
            Chords the band is playing
          </label>
          <input
            id="progression"
            value={text}
            onChange={(e) => onText(e.target.value)}
            placeholder="C | G | Am | F"
            className="h-11 w-full rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-base text-[var(--color-ink)]"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => onText(preset)}
                className="readout rounded-lg border border-[var(--color-hairline)] px-2 py-1 text-[11px] text-[var(--color-ink-faint)] hover:border-[var(--color-hairline-bright)] hover:text-[var(--color-ink-dim)]"
              >
                {preset}
              </button>
            ))}
          </div>
          {progression.errors.length > 0 && (
            <p className="mt-2 text-xs text-[var(--color-error)]">
              Couldn&apos;t read: {progression.errors.join(", ")}. Try names like C, Am, F#m7, Bbmaj7, Gsus4.
            </p>
          )}
        </div>

        {progression.chords.length > 0 ? (
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex flex-wrap gap-2">
              {progression.chords.map((chord) => (
                <button
                  key={chord.index}
                  onClick={() => onSelect(chord.index)}
                  className={cn(
                    "flex min-w-[64px] flex-col items-center rounded-xl border px-3 py-2 transition-colors",
                    chord.index === selected
                      ? "border-[var(--color-signal)] bg-[rgba(34,224,214,0.1)]"
                      : "border-[var(--color-hairline)] bg-[var(--color-void)] hover:border-[var(--color-hairline-bright)]",
                  )}
                >
                  <span className="readout text-lg font-semibold">{chord.symbol}</span>
                  <span className="readout text-[10px] text-[var(--color-ink-faint)]">{chord.roman ?? "–"}</span>
                </button>
              ))}
            </div>
            <div className="min-w-[180px]">
              <p className="hud-label">Key</p>
              {key.key ? (
                <>
                  <p className="readout text-lg font-semibold text-[var(--color-signal)]">{key.key.name}</p>
                  <p className="text-xs text-[var(--color-ink-dim)]">
                    Confidence: {key.level}
                    {key.relative && key.level !== "High" ? ` · could also be ${key.relative.name}` : ""}
                  </p>
                </>
              ) : (
                <p className="text-sm text-[var(--color-ink-dim)]">Key uncertain. Ideas use the notes of your chords.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-ink-dim)]">Type at least one chord to start.</p>
        )}

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <Field label="Instrument">
            <SegmentedControl
              size="sm"
              options={[
                { value: "guitar", label: "Guitar" },
                { value: "bass", label: "Bass" },
              ]}
              value={instrument}
              onChange={onInstrument}
            />
          </Field>
          <Field label="Style">
            <select
              value={style}
              onChange={(e) => onStyle(e.target.value as CompanionStyle)}
              className="h-9 rounded-xl border border-[var(--color-hairline-bright)] bg-[var(--color-panel-raised)] px-3 text-sm"
            >
              {STYLE_IDS.map((id) => (
                <option key={id} value={id}>
                  {STYLE_PROFILES[id].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Difficulty">
            <SegmentedControl
              size="sm"
              options={DIFFICULTIES.map((d) => ({ value: d, label: d[0]!.toUpperCase() + d.slice(1), hint: DIFFICULTY_INFO[d] }))}
              value={difficulty}
              onChange={onDifficulty}
            />
          </Field>
        </div>

        <p className="text-xs leading-relaxed text-[var(--color-ink-faint)]">
          <span className="text-[var(--color-ink-dim)]">{profile.label}:</span> {profile.blurb} A generic style vocabulary
          ({profile.vocabulary.join(", ")}), not a copy of any song. {DIFFICULTY_INFO[difficulty]}
        </p>
      </div>
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="hud-label">{label}</span>
      {children}
    </div>
  );
}
