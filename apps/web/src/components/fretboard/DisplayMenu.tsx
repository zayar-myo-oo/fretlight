"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useSession } from "@/store/session";

/**
 * Every "how should the neck look" switch in one collapsible place, so the
 * screens can spend their space on what to learn instead of on toggles.
 */
export function DisplayMenu({
  showLabels = true,
  view,
  onViewChange,
}: {
  readonly showLabels?: boolean;
  readonly view?: "2d" | "3d";
  readonly onViewChange?: (view: "2d" | "3d") => void;
}) {
  const [open, setOpen] = useState(false);
  const labelMode = useSession((s) => s.labelMode);
  const setLabelMode = useSession((s) => s.setLabelMode);
  const lowStringOnTop = useSession((s) => s.lowStringOnTop);
  const patch = useSession((s) => s.patch);

  return (
    <div className="flex flex-col items-end gap-2">
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        ⚙ Display {open ? "▴" : "▾"}
      </Button>
      {open && (
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-void)] p-3">
          {showLabels && (
            <Group label="Show on notes">
              <SegmentedControl
                size="sm"
                options={[
                  { value: "note", label: "Names" },
                  { value: "degree", label: "Degrees" },
                  { value: "interval", label: "Intervals" },
                ]}
                value={labelMode}
                onChange={setLabelMode}
              />
            </Group>
          )}
          <Group label="Strings">
            <SegmentedControl
              size="sm"
              options={[
                { value: "tab", label: "High E on top", hint: "As written tab and chord charts show it" },
                { value: "player", label: "Low E on top", hint: "As you see it looking down at the instrument" },
              ]}
              value={lowStringOnTop ? "player" : "tab"}
              onChange={(value) => patch({ lowStringOnTop: value === "player" })}
            />
          </Group>
          {view && onViewChange && (
            <Group label="View">
              <SegmentedControl
                size="sm"
                options={[
                  { value: "2d", label: "2D" },
                  { value: "3d", label: "3D" },
                ]}
                value={view}
                onChange={(value) => onViewChange(value as "2d" | "3d")}
              />
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="hud-label">{label}</span>
      {children}
    </div>
  );
}
