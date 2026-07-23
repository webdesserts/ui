import { MenuItem } from "../../src";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

/** Full-height rail + 2px seam recipe (ui#7 round 4) — mirrors OpenPanel in
 *  select-trigger-candidates.test.tsx/SelectCandidatesPage.tsx: the
 *  first-child absolute column paints the panel's own border instead of
 *  relying on each row's fragmented resting bar; rows neutralize their
 *  resting bar via the inherited --spread-bg-rest, and fills clear the
 *  column via the inherited --spread-fill-left. Page-only mirror, no
 *  baselines here — rides commit 2's regen without adding screenshot
 *  surface. */
const PANEL_STYLE = {
  "--spread-bg-rest": "transparent",
  "--spread-fill-left": "4px",
} as React.CSSProperties;

export function MenuItemPage() {
  return (
    <div className="p-8 max-w-3xl space-y-10">
      <header>
        <h1 className="text-3xl font-light">MenuItem</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Dropdown list items with selected state and left-side spread bar.
        </p>
      </header>

      <section className="space-y-3">
        <SectionLabel>Default</SectionLabel>
        <div
          className="w-64 rounded-md border border-rule-subtle bg-surface-raised relative overflow-hidden"
          style={PANEL_STYLE}
        >
          <div aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-interactive-border" />
          <MenuItem selected style={{ "--spread-fill-left": "0px" } as React.CSSProperties}>
            Built-in Microphone
          </MenuItem>
          <MenuItem>USB Headset</MenuItem>
          <MenuItem>Bluetooth Speaker</MenuItem>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>No selection</SectionLabel>
        <div
          className="w-64 rounded-md border border-rule-subtle bg-surface-raised relative overflow-hidden"
          style={PANEL_STYLE}
        >
          <div aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-interactive-border" />
          <MenuItem>Option A</MenuItem>
          <MenuItem>Option B</MenuItem>
          <MenuItem>Option C</MenuItem>
        </div>
      </section>
    </div>
  );
}
