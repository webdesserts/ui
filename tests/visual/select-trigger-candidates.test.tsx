import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import {
  freezeAnimationsAt,
  unfreezeAnimations,
  waitForAnimationFrame,
  slowTransitions,
  animationScreenshotOptions,
} from "../utils/animation";
import { Button, MenuItem, cn } from "@/src";
import {
  spreadSetupBase,
  spreadSelfTriggers,
  spreadBarClasses,
  interactiveRing,
  interactiveDisabled,
} from "@/src/components/shared";

/**
 * Select trigger comparison fixtures (ui#7, "Select Primitive Plan (ui)").
 * Literal, hand-styled candidate markup — no <Select> component, no
 * floating-ui — comparing candidates against Michael's 2026-07-23 hover
 * verdict: (b) TextInput's chrome + a right-side chevron (full invert on
 * hover/focus — the original "kinda in between" candidate) and (c) a real
 * bottom border that inverts on hover plus a subtle theme-fill spread, text
 * that never flips (his own described alternative). Candidate (a), the
 * exemplar's own trigger verbatim, was retired by the same verdict ("I
 * definitely don't want Candidate A" — magenta on hover). Permanent durable
 * record, mirroring glass-panel.test.tsx's candidates-as-baselines precedent.
 *
 * Also carries the ui#16 MenuItem selected-state candidates (M1/M2/M3,
 * bottom of file) — same review round, same fixture page, combined per
 * Michael's 2026-07-23 session.
 */

const FRAME_WIDTH = 280;
const BESIDE_WIDTH = 420;

function Frame({ children, width = FRAME_WIDTH }: { children: React.ReactNode; width?: number }) {
  return <div style={{ width }}>{children}</div>;
}

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

/** Park the pointer off the trigger so "resting" captures are deterministic regardless of test order. */
async function restPointer(container: Element) {
  await page.elementLocator(container).hover({ position: { x: 0, y: 0 } });
}

/** Hover the trigger, freeze its fill (and any child transition) at the fully-settled end state. */
async function captureHover(container: Element) {
  const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  const restore = slowTransitions();
  await page.elementLocator(trigger).hover();
  await waitForAnimationFrame();
  const anims = freezeAnimationsAt(trigger, 1, { subtree: true });
  restore();
  await expect
    .element(page.elementLocator(container))
    .toMatchScreenshot(animationScreenshotOptions);
  unfreezeAnimations(anims);
}

/**
 * Tab to the trigger — a real keyboard interaction that natively triggers
 * :focus-visible. NOT text-input's data-focus-source mechanism: that hack
 * exists only because <input> is a replaced element the browser forces
 * :focus-visible on regardless of modality — these candidates are real
 * <button>s riding interactiveRing's highlight: variant (plain
 * :focus-visible), which ignores data-focus-source entirely, and a bare
 * .focus() doesn't reliably trip Chromium's :focus-visible heuristic.
 *
 * Parks the pointer first: userEvent.tab() doesn't move the mouse, so a
 * cursor left hovering the trigger by a preceding hover test in this same
 * file (identically-positioned Frame across tests) would otherwise leak
 * :hover into this capture alongside :focus-visible.
 */
async function captureFocus(container: Element) {
  const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  await restPointer(container);
  const restore = slowTransitions();
  await userEvent.tab();
  await waitForAnimationFrame();
  const anims = freezeAnimationsAt(trigger, 1, { subtree: true });
  restore();
  await expect
    .element(page.elementLocator(container))
    .toMatchScreenshot(animationScreenshotOptions);
  unfreezeAnimations(anims);
}

// ---------------------------------------------------------------------------
// Chevron — local inline SVG (chevron-button.test.tsx's CaretDownIcon
// pattern: avoids React context issues in vitest browser mode; matches
// Phosphor's CaretDown / the exemplar's ChevronDownIcon path data exactly).
// ---------------------------------------------------------------------------

function CaretDownIcon({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width={size} height={size} aria-hidden="true" className={className}>
      <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Candidate (b) — ui's-own-TextInput-chrome + right-side chevron. Fork 6: a
// real <button role="combobox"> built on Button's spreadSetupBase +
// spreadBarClasses.bottom + interactiveRing self-state mechanism — NOT
// TextInput's wrapper-div/focus-modality-tracker architecture — but matching
// TextInput's exact fill-invert target (text-surface-base) rather than
// Button's generic --interactive-text default: the two tokens are identical
// in dark mode but diverge slightly in light mode (--surface-base uses
// --np-sepia-95, --interactive-text uses --np-sepia-90), so this candidate
// hand-rolls its self-triggers instead of spreading spreadSelfTriggers
// verbatim (which would need an override, and two same-specificity utility
// classes targeting the same property are not reliably order-controllable
// in Tailwind v4's generation-order-based layer). The placeholder span gets
// its own explicit transition + group-hover/group-focus-visible triggers
// since (unlike the value span, which just inherits the button's own
// animating color) it needs a resting value the button's own color doesn't
// share.
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

// ---------------------------------------------------------------------------
// Candidate (c) — Michael's 2026-07-23 hover verdict, applied literally: a
// real bottom border that inverts to the interactive-bg token on hover
// (never accent — magenta is focus/press-only now) plus a subtle theme-fill
// spreading up from the border behind the text, riding the SAME spread
// mechanism (b) uses, just tinted quiet instead of full invert. Text never
// flips on hover — only the border + fill respond (the input-vs-button
// distinguisher: buttons fully invert, this candidate answers with a strong
// border + a quiet fill). Focus-visible is (b)'s full-invert block verbatim,
// so hover is the only variable between the two candidates' interaction
// states.
// ---------------------------------------------------------------------------

const TRIGGER_C = cn(
  "group flex w-full items-center justify-between rounded-t-sm",
  "bg-surface-input",
  spreadSetupBase,
  spreadBarClasses.bottom,
  interactiveRing,
  "cursor-pointer outline-none",
  "h-10 px-4 text-sm text-text-primary",
  "transition-[color,opacity] duration-200",
  // Real border — plays the resting-line role (the bar's own rest value is
  // neutralized via TRIGGER_C_STYLE below so it doesn't double this line).
  "border-b border-rule-subtle transition-[border-color] duration-200",
  "not-disabled:hover:border-interactive-bg",
  // Subtle fill spreads up from the border on hover — (b)'s exact grow
  // mechanism/timing, tinted with the quiet surface-raised token instead of
  // a full interactive-bg invert.
  "not-disabled:hover:after:inset-0 not-disabled:hover:after:w-full not-disabled:hover:after:h-full not-disabled:hover:after:m-0",
  "not-disabled:hover:after:bg-surface-raised",
  "not-disabled:hover:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
  // Focus-visible — (b)'s full-invert block, copied verbatim. Hover is this
  // candidate's only variable.
  "not-disabled:focus-visible:text-surface-base",
  "not-disabled:focus-visible:after:inset-0 not-disabled:focus-visible:after:w-full not-disabled:focus-visible:after:h-full not-disabled:focus-visible:after:m-0",
  "not-disabled:focus-visible:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "not-disabled:focus-visible:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
);

/** Neutralizes the spread bar's resting fallback color (--interactive-border
 *  via spreadSetupBase) so it doesn't double the real border above — same
 *  per-instance custom-property override IconButton's danger variant already
 *  ships (Button.tsx:286-289). */
const TRIGGER_C_STYLE = {
  "--spread-bg-rest": "transparent",
} as React.CSSProperties;

const PLACEHOLDER_C = cn(
  "text-text-secondary transition-[color,opacity] duration-200",
  // No hover invert — text does not flip on hover for this candidate, only
  // the border + fill respond. Focus still gets the full-invert treatment,
  // copied from PLACEHOLDER_B verbatim.
  "group-focus-visible:text-surface-base group-focus-visible:opacity-60",
);

function CandidateC({ hasValue, open = false }: { hasValue: boolean; open?: boolean }) {
  return (
    <button
      type="button"
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      className={TRIGGER_C}
      style={TRIGGER_C_STYLE}
    >
      <span className={cn("truncate", !hasValue && PLACEHOLDER_C)}>
        {hasValue ? "USB Headset" : "Select…"}
      </span>
      <CaretDownIcon size={12} className={cn("shrink-0 ml-2 transition-transform", open && "rotate-180")} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Open-state panel — a static MenuItem + glass-panel stand-in (no floating-ui
// needed for this slice; plain flow content directly below the trigger, so
// unlike Slice 2's real floating listbox this doesn't need fullPage/explicit
// sizing — see the plan's Forecast correction D). Width-matched to the
// trigger, mirroring the exemplar's own size() middleware; offset mirrors
// the exemplar's offset(4). No selected-glyph — Michael's ruling (feed
// 1658): selected state renders via MenuItem's own `selected` prop alone.
// ---------------------------------------------------------------------------

function OpenPanel({ width }: { width: number }) {
  return (
    <div className="glass-panel rounded-md py-1 mt-1" style={{ width }}>
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
// Candidate (b) — ui's-own-TextInput-chrome + right-side chevron
// ---------------------------------------------------------------------------

describe("Select trigger candidate B (TextInput chrome + chevron)", () => {
  it("select-trigger-b-rest-value-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateB hasValue />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-b-rest-value-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateB hasValue />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-b-rest-placeholder-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateB hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-b-rest-placeholder-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateB hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-b-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateB hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await captureHover(screen.container);
  });

  it("select-trigger-b-hover-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateB hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await captureHover(screen.container);
  });

  it("select-trigger-b-focus-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateB hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await captureFocus(screen.container);
  });

  it("select-trigger-b-focus-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateB hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await captureFocus(screen.container);
  });

  it("select-trigger-b-open-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateB hasValue open />
          <OpenPanel width={FRAME_WIDTH} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-b-open-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateB hasValue open />
          <OpenPanel width={FRAME_WIDTH} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Candidate (c) — border-invert + subtle fill
// ---------------------------------------------------------------------------

describe("Select trigger candidate C (border-invert + subtle fill)", () => {
  it("select-trigger-c-rest-value-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateC hasValue />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-c-rest-value-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateC hasValue />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-c-rest-placeholder-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateC hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-c-rest-placeholder-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateC hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-c-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateC hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await captureHover(screen.container);
  });

  it("select-trigger-c-hover-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateC hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await captureHover(screen.container);
  });

  it("select-trigger-c-focus-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateC hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await captureFocus(screen.container);
  });

  it("select-trigger-c-focus-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateC hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await captureFocus(screen.container);
  });

  it("select-trigger-c-open-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateC hasValue open />
          <OpenPanel width={FRAME_WIDTH} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-c-open-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateC hasValue open />
          <OpenPanel width={FRAME_WIDTH} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Beside a Button — height/visual-weight alignment, directly diagnostic for
// "in between" (mirrors TextInputPage.tsx's own beside-a-Button fixture).
// ---------------------------------------------------------------------------

describe("Select trigger beside a Button", () => {
  it("select-trigger-b-beside-button-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame width={BESIDE_WIDTH}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CandidateB hasValue={false} />
            <Button>Choose…</Button>
          </div>
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-b-beside-button-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame width={BESIDE_WIDTH}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CandidateB hasValue={false} />
            <Button>Choose…</Button>
          </div>
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-c-beside-button-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame width={BESIDE_WIDTH}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CandidateC hasValue={false} />
            <Button>Choose…</Button>
          </div>
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-c-beside-button-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame width={BESIDE_WIDTH}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CandidateC hasValue={false} />
            <Button>Choose…</Button>
          </div>
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// MenuItem selected-state candidates (ui#16) — Michael's 2026-07-23 menu
// ruling: full invert is reserved for focus; selected needs a quieter
// treatment that keeps the spread language (border-grows-into-fill) instead
// of MenuItem's current static `bg-interactive-bg text-interactive-text` (a
// bypass of the spread system entirely). Hand-rolled fixture markup for the
// selected row only — non-selected rows are real, unchanged MenuItems; the
// real MenuItem restyle lands after Michael's pick.
//
// `interactiveBase` isn't exported (Button.tsx's own local
// `cn("cursor-pointer", interactiveRing, interactiveDisabled)`,
// Button.tsx:23) — recomposed here from the two primitives that are.
// ---------------------------------------------------------------------------

const menuItemInteractiveBase = cn("cursor-pointer", interactiveRing, interactiveDisabled);

const menuItemBase = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm";

/** M1 "border extended a little" — the static left bar (the spread bar's
 *  resting geometry, recolored to the invert token) plus the same subtle
 *  fill token Candidate C uses. The spread language frozen at a quiet point
 *  — closest to Michael's "as if a left border was configured." */
const MENU_CANDIDATE_M1 = cn(
  menuItemBase,
  menuItemInteractiveBase,
  spreadSetupBase,
  spreadSelfTriggers,
  spreadBarClasses.left,
  "bg-surface-raised text-text-primary",
);

/** Static-bar mechanism: recolors the resting spread bar itself — same
 *  per-instance pattern IconButton's danger variant ships (Button.tsx:286-289).
 *  Hover stays independently correct: spreadSelfTriggers' hover reads
 *  --spread-bg-hover, untouched by this rest-only override. */
const MENU_CANDIDATE_M1_STYLE = {
  "--spread-bg-rest": "var(--interactive-bg)",
} as React.CSSProperties;

/** M2 "quiet fill" — subtle fill + primary text, no persistent bar (the
 *  rest bar stays at its default --interactive-border color, same as every
 *  other row). font-medium adds a legible selected cue via type weight
 *  since there's no color/bar differentiator to lean on here. */
const MENU_CANDIDATE_M2 = cn(
  menuItemBase,
  menuItemInteractiveBase,
  spreadSetupBase,
  spreadSelfTriggers,
  spreadBarClasses.left,
  "bg-surface-raised text-text-primary font-medium",
);

/** M3 "left bar only" — static left bar in the invert token, no fill. */
const MENU_CANDIDATE_M3 = cn(
  menuItemBase,
  menuItemInteractiveBase,
  spreadSetupBase,
  spreadSelfTriggers,
  spreadBarClasses.left,
  "text-text-primary",
);

const MENU_CANDIDATE_M3_STYLE = {
  "--spread-bg-rest": "var(--interactive-bg)",
} as React.CSSProperties;

type MenuCandidate = { className: string; style?: React.CSSProperties };

/** Mirrors OpenPanel's structure: real, unchanged MenuItems for the
 *  non-selected rows, hand-rolled candidate markup for the selected row
 *  (targeted for hover capture via data-candidate-row, not exposed as
 *  MenuItem `selected` — that prop still renders the old full-invert style
 *  this round is replacing). */
function MenuCandidatePanel({ width, candidate }: { width: number; candidate: MenuCandidate }) {
  return (
    <div className="glass-panel rounded-md py-1 mt-1" style={{ width }}>
      <MenuItem>
        <span className="truncate">Built-in Microphone</span>
      </MenuItem>
      <button
        type="button"
        data-candidate-row="selected"
        className={candidate.className}
        style={candidate.style}
      >
        <span className="truncate">USB Headset</span>
      </button>
      <MenuItem>
        <span className="truncate">Bluetooth Speaker</span>
      </MenuItem>
    </div>
  );
}

/** Hover the hand-rolled selected row inside a menu candidate panel, freeze
 *  its fill at the fully-settled end state — mirrors captureHover above,
 *  scoped to the row via data-candidate-row rather than [role="combobox"]. */
async function captureMenuSelectedHover(container: Element) {
  const row = container.querySelector<HTMLButtonElement>('[data-candidate-row="selected"]')!;
  const restore = slowTransitions();
  await page.elementLocator(row).hover();
  await waitForAnimationFrame();
  const anims = freezeAnimationsAt(row, 1, { subtree: true });
  restore();
  await expect
    .element(page.elementLocator(container))
    .toMatchScreenshot(animationScreenshotOptions);
  unfreezeAnimations(anims);
}

describe("MenuItem selected candidates — M1 (border extended a little)", () => {
  it("menu-candidate-m1-open-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <MenuCandidatePanel
            width={FRAME_WIDTH}
            candidate={{ className: MENU_CANDIDATE_M1, style: MENU_CANDIDATE_M1_STYLE }}
          />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("menu-candidate-m1-open-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <MenuCandidatePanel
            width={FRAME_WIDTH}
            candidate={{ className: MENU_CANDIDATE_M1, style: MENU_CANDIDATE_M1_STYLE }}
          />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("menu-candidate-m1-selected-hover-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <MenuCandidatePanel
            width={FRAME_WIDTH}
            candidate={{ className: MENU_CANDIDATE_M1, style: MENU_CANDIDATE_M1_STYLE }}
          />
        </Frame>
      </TestWrapper>,
    );
    await captureMenuSelectedHover(screen.container);
  });
});

describe("MenuItem selected candidates — M2 (quiet fill)", () => {
  it("menu-candidate-m2-open-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <MenuCandidatePanel width={FRAME_WIDTH} candidate={{ className: MENU_CANDIDATE_M2 }} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("menu-candidate-m2-open-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <MenuCandidatePanel width={FRAME_WIDTH} candidate={{ className: MENU_CANDIDATE_M2 }} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("menu-candidate-m2-selected-hover-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <MenuCandidatePanel width={FRAME_WIDTH} candidate={{ className: MENU_CANDIDATE_M2 }} />
        </Frame>
      </TestWrapper>,
    );
    await captureMenuSelectedHover(screen.container);
  });
});

describe("MenuItem selected candidates — M3 (left bar only)", () => {
  it("menu-candidate-m3-open-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <MenuCandidatePanel
            width={FRAME_WIDTH}
            candidate={{ className: MENU_CANDIDATE_M3, style: MENU_CANDIDATE_M3_STYLE }}
          />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("menu-candidate-m3-open-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <MenuCandidatePanel
            width={FRAME_WIDTH}
            candidate={{ className: MENU_CANDIDATE_M3, style: MENU_CANDIDATE_M3_STYLE }}
          />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("menu-candidate-m3-selected-hover-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <MenuCandidatePanel
            width={FRAME_WIDTH}
            candidate={{ className: MENU_CANDIDATE_M3, style: MENU_CANDIDATE_M3_STYLE }}
          />
        </Frame>
      </TestWrapper>,
    );
    await captureMenuSelectedHover(screen.container);
  });
});
