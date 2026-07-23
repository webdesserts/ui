import { MenuItem, cn } from "../../src";
import {
  spreadSetupBase,
  spreadBarClasses,
  interactiveRing,
} from "@/src/components/shared";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

const TRIGGER_WIDTH = 280;

// ---------------------------------------------------------------------------
// Trigger candidate class strings — byte-identical to
// tests/visual/select-trigger-candidates.test.tsx's TRIGGER_B / PLACEHOLDER_B
// / TRIGGER_C / TRIGGER_C_STYLE / TRIGGER_C_RESTING / TRIGGER_C_OPEN /
// PLACEHOLDER_C, that file's permanent record of the ui#7 verdict
// screenshots. Duplicated here (not imported from the test file) so this
// page renders the exact same candidates live; both files import the same
// shared primitives, so they stay byte-identical automatically rather than
// drifting as a hand-copied snapshot.
// ---------------------------------------------------------------------------

const TRIGGER_B = cn(
  "group flex w-full items-center justify-between rounded-t-sm",
  "bg-surface-input",
  spreadSetupBase,
  spreadBarClasses.bottom,
  interactiveRing,
  "cursor-pointer outline-none",
  "h-10 px-4 text-sm text-text-primary",
  "transition-[color,opacity] duration-200",
  "not-disabled:hover:text-surface-base",
  "not-disabled:hover:after:inset-0 not-disabled:hover:after:w-full not-disabled:hover:after:h-full not-disabled:hover:after:m-0",
  "not-disabled:hover:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "not-disabled:hover:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
  "not-disabled:focus-visible:text-surface-base",
  "not-disabled:focus-visible:after:inset-0 not-disabled:focus-visible:after:w-full not-disabled:focus-visible:after:h-full not-disabled:focus-visible:after:m-0",
  "not-disabled:focus-visible:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "not-disabled:focus-visible:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
);

const PLACEHOLDER_B = cn(
  "text-text-secondary transition-[color,opacity] duration-200",
  "group-hover:text-surface-base group-hover:opacity-60",
  "group-focus-visible:text-surface-base group-focus-visible:opacity-60",
);

const TRIGGER_C = cn(
  "group flex w-full items-center justify-between rounded-t-sm",
  "bg-surface-input",
  spreadSetupBase,
  interactiveRing,
  "cursor-pointer outline-none",
  "h-10 px-4 text-sm text-text-primary",
  "transition-[color,opacity] duration-200",
  "border-b-2 transition-[border-color] duration-200",
  "not-disabled:hover:border-interactive-bg",
  "not-disabled:hover:after:inset-0 not-disabled:hover:after:w-full not-disabled:hover:after:h-full not-disabled:hover:after:m-0",
  "not-disabled:hover:after:bg-surface-raised",
  "not-disabled:hover:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
  "not-disabled:focus-visible:text-surface-base",
  "not-disabled:focus-visible:after:inset-0 not-disabled:focus-visible:after:w-full not-disabled:focus-visible:after:h-full not-disabled:focus-visible:after:m-0",
  "not-disabled:focus-visible:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "not-disabled:focus-visible:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
);

const TRIGGER_C_STYLE = {
  "--spread-bg-rest": "transparent",
} as React.CSSProperties;

const TRIGGER_C_RESTING = cn(spreadBarClasses.bottom, "border-interactive-border");

const TRIGGER_C_OPEN = cn(
  "border-interactive-bg",
  "after:inset-0 after:w-full after:h-full after:m-0 after:bg-surface-raised",
);

const PLACEHOLDER_C = cn(
  "text-text-secondary transition-[color,opacity] duration-200",
  "group-focus-visible:text-surface-base group-focus-visible:opacity-60",
);

/** Mirrors the test fixture's local CaretDownIcon (Phosphor's CaretDown path
 *  data, kept local rather than imported so both candidates render identically
 *  to what the ui#7 verdict screenshots captured). */
function CaretDownIcon({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width={size} height={size} aria-hidden="true" className={className}>
      <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
    </svg>
  );
}

function CandidateB({ hasValue, open = false }: { hasValue: boolean; open?: boolean }) {
  return (
    <button type="button" role="combobox" aria-expanded={open} aria-haspopup="listbox" className={TRIGGER_B}>
      <span className={cn("truncate", !hasValue && PLACEHOLDER_B)}>
        {hasValue ? "USB Headset" : "Select…"}
      </span>
      <CaretDownIcon size={12} className={cn("shrink-0 ml-2 transition-transform", open && "rotate-180")} />
    </button>
  );
}

function CandidateC({ hasValue, open = false }: { hasValue: boolean; open?: boolean }) {
  return (
    <button
      type="button"
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      className={cn(TRIGGER_C, open ? TRIGGER_C_OPEN : TRIGGER_C_RESTING)}
      style={TRIGGER_C_STYLE}
    >
      <span className={cn("truncate", !hasValue && PLACEHOLDER_C)}>
        {hasValue ? "USB Headset" : "Select…"}
      </span>
      <CaretDownIcon size={12} className={cn("shrink-0 ml-2 transition-transform", open && "rotate-180")} />
    </button>
  );
}

/** Mirrors the test fixture's OpenPanel — no selected glyph, Michael's ruling
 *  (feed 1658): selected state renders via MenuItem's `selected` prop alone
 *  here; the MenuItem restyle candidates are the page's other section below. */
function OpenPanel({ width }: { width: number }) {
  return (
    <div className="glass-panel rounded-b-md py-1 mt-1" style={{ width }}>
      <MenuItem>
        <span className="truncate">Built-in Microphone</span>
      </MenuItem>
      <MenuItem selected>
        <span className="truncate">USB Headset</span>
      </MenuItem>
      <MenuItem>
        <span className="truncate">Bluetooth Speaker</span>
      </MenuItem>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu timing compare (ui#16) — 2x2 A/B grid for Michael's timing verdict.
// Page-only (no fixture, no baselines — timing is unphotographable). Columns
// are the two timing candidates; the "Previous" column overrides MenuItem's
// own --spread-in/--spread-out defaults per-item, proving the merge order
// (Button.tsx's MenuItem: {...props} spreads first, so this wins). Rows are
// the two row shapes Michael asked to compare (single-line vs a
// description-style two-line child) — the description row uses plain
// children, no MenuItem API change.
// ---------------------------------------------------------------------------

const PREVIOUS_TIMING_STYLE = {
  "--spread-in": "250ms",
  "--spread-out": "400ms",
} as React.CSSProperties;

const TIMING_COMPARE_ITEMS = [
  { title: "Built-in Microphone", description: "Internal speaker and mic" },
  { title: "USB Headset", description: "Wired, connected via USB-C" },
  { title: "Bluetooth Speaker", description: "Paired, currently active" },
];

function TimingCompareLabel({ title }: { title: string }) {
  return <span className="truncate">{title}</span>;
}

function TimingCompareDescriptionLabel({ title, description }: { title: string; description: string }) {
  return (
    <span className="flex flex-col min-w-0">
      <span className="truncate">{title}</span>
      <span className="truncate text-xs text-text-muted">{description}</span>
    </span>
  );
}

function TimingComparePanel({
  descriptionStyle,
  timingOverride,
}: {
  descriptionStyle: boolean;
  timingOverride?: React.CSSProperties;
}) {
  return (
    <div className="glass-panel rounded-md py-1" style={{ width: TRIGGER_WIDTH }}>
      {TIMING_COMPARE_ITEMS.map((item, i) => (
        <MenuItem key={item.title} selected={i === 1} style={timingOverride}>
          {descriptionStyle ? (
            <TimingCompareDescriptionLabel title={item.title} description={item.description} />
          ) : (
            <TimingCompareLabel title={item.title} />
          )}
        </MenuItem>
      ))}
    </div>
  );
}

export function SelectCandidatesPage() {
  return (
    <div className="p-8 max-w-3xl space-y-10">
      <header>
        <h1 className="text-3xl font-light">Select (candidates)</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Temporary review page for the ui#7 select trigger verdict and the
          ui#16 menu timing compare — replaced by the real components when
          they ship.
        </p>
      </header>

      <section className="space-y-3">
        <SectionLabel>Candidate B (TextInput chrome + chevron) — rest</SectionLabel>
        <div className="flex flex-wrap gap-6">
          <div style={{ width: TRIGGER_WIDTH }}>
            <CandidateB hasValue={false} />
          </div>
          <div style={{ width: TRIGGER_WIDTH }}>
            <CandidateB hasValue />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Candidate B — open</SectionLabel>
        <div style={{ width: TRIGGER_WIDTH }}>
          <CandidateB hasValue open />
          <OpenPanel width={TRIGGER_WIDTH} />
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Candidate C (border-invert + subtle fill) — rest</SectionLabel>
        <div className="flex flex-wrap gap-6">
          <div style={{ width: TRIGGER_WIDTH }}>
            <CandidateC hasValue={false} />
          </div>
          <div style={{ width: TRIGGER_WIDTH }}>
            <CandidateC hasValue />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Candidate C — open</SectionLabel>
        <div style={{ width: TRIGGER_WIDTH }}>
          <CandidateC hasValue open />
          <OpenPanel width={TRIGGER_WIDTH} />
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Menu timing compare (ui#16)</SectionLabel>
        <p className="text-xs text-text-muted">
          Columns: Tuned (400ms in / 600ms out, the component defaults) vs
          Previous (250ms in / 400ms out, per-item override). Rows:
          single-line vs description-style.
        </p>

        <div className="space-y-2">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
            Single-line rows
          </p>
          <div className="flex flex-wrap gap-6">
            <div style={{ width: TRIGGER_WIDTH }} className="space-y-1">
              <p className="text-xs text-text-muted">Tuned — 400ms in / 600ms out</p>
              <TimingComparePanel descriptionStyle={false} />
            </div>
            <div style={{ width: TRIGGER_WIDTH }} className="space-y-1">
              <p className="text-xs text-text-muted">Previous — 250ms in / 400ms out</p>
              <TimingComparePanel descriptionStyle={false} timingOverride={PREVIOUS_TIMING_STYLE} />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
            Description-style rows
          </p>
          <div className="flex flex-wrap gap-6">
            <div style={{ width: TRIGGER_WIDTH }} className="space-y-1">
              <p className="text-xs text-text-muted">Tuned — 400ms in / 600ms out</p>
              <TimingComparePanel descriptionStyle />
            </div>
            <div style={{ width: TRIGGER_WIDTH }} className="space-y-1">
              <p className="text-xs text-text-muted">Previous — 250ms in / 400ms out</p>
              <TimingComparePanel descriptionStyle timingOverride={PREVIOUS_TIMING_STYLE} />
            </div>
          </div>
        </div>

        <p className="text-xs text-text-muted italic">
          Temporary A/B for the menu timing verdict — the losers and this
          section go away after Michael's pick.
        </p>
      </section>
    </div>
  );
}
