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
  spreadBarClasses,
  interactiveRing,
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
 * OpenPanel below (used by both candidates' open state) renders real
 * MenuItems — the ui#16 MenuItem selected-state candidates (M1/M2/M3) that
 * used to live at the bottom of this file were retired once M1 shipped as
 * the real MenuItem's selected treatment (see menu-item.test.tsx).
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
  interactiveRing,
  "cursor-pointer outline-none",
  "h-10 px-4 text-sm text-text-primary",
  "transition-[color,opacity] duration-200",
  // Real border weight — plays the resting-line role (the bar's own rest
  // value is neutralized via TRIGGER_C_STYLE below so it doesn't double this
  // line). Color/geometry come from TRIGGER_C_RESTING or TRIGGER_C_OPEN
  // below (applied exclusively, not here — see TRIGGER_C_RESTING's comment).
  "border-b-2 transition-[border-color] duration-200",
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

/** Rest-state bar geometry + border color: the resting spread bar position
 *  (spreadBarClasses.bottom) plus the line's own color, --interactive-border
 *  — matches the buttons' own resting spread bar exactly, 2px weight
 *  (Michael's 2026-07-23 fix-round ruling: "the same border color as our
 *  buttons", thicker than the prior hairline). Exclusive with TRIGGER_C_OPEN
 *  below rather than layered under it: confirmed via getComputedStyle that
 *  two unconditional same-specificity utilities targeting the same property
 *  don't reliably resolve by class-list order here —
 *  border-interactive-border kept winning border-color over an unconditional
 *  border-interactive-bg placed after it, and the ::after geometry actually
 *  split per-property (top from these rest classes, height from the open
 *  ones), clipping the fill to near-invisible instead of either intended
 *  look. Swapping the whole group avoids the ambiguity outright. */
const TRIGGER_C_RESTING = cn(spreadBarClasses.bottom, "border-interactive-border");

/** Open holds the hover-equivalent look statically (Michael's 2026-07-23
 *  ruling: "the 'hover state' should be active while the select dropdown is
 *  open" — so the inverted border line stays visible for the whole time the
 *  menu is open, not just while the pointer happens to rest on the
 *  trigger). Same border color + fill target the hover block above sets via
 *  :hover, applied here unconditionally instead — swapped in exclusively for
 *  TRIGGER_C_RESTING (see that constant's comment), never layered with it. */
const TRIGGER_C_OPEN = cn(
  "border-interactive-bg",
  "after:inset-0 after:w-full after:h-full after:m-0 after:bg-surface-raised",
);

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
// Open-state panel — computed corner radii (not pixels). The default
// toMatchScreenshot() comparator's tolerance does NOT catch a corner-radius-
// scale diff: a defeat-check sever of rounded-b-md -> rounded-md produced a
// genuinely different render (21970 vs 21780 bytes, different md5) that
// every b/c-open screenshot test still passed. This computed-style pin,
// mirroring commit 2's timing-duration pin pattern, is the actual regression
// guard for the corner-squaring change ("appears attached" — ui#7).
// ---------------------------------------------------------------------------

describe("Select trigger open panel — computed corner radii", () => {
  it("open-panel-square-top-computed", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <OpenPanel width={FRAME_WIDTH} />
        <div data-testid="rounded-md-reference" className="rounded-md" />
      </TestWrapper>,
    );
    const panel = screen.container.querySelector<HTMLElement>(".glass-panel")!;
    const reference = screen.container.querySelector(
      '[data-testid="rounded-md-reference"]',
    ) as HTMLElement;
    const panelStyle = window.getComputedStyle(panel);
    const referenceRadius = window.getComputedStyle(reference).borderTopLeftRadius;

    // Top corners: square — the "appears attached" read (rounded-b-md only
    // rounds the bottom edge).
    expect(panelStyle.borderTopLeftRadius).toBe("0px");
    expect(panelStyle.borderTopRightRadius).toBe("0px");

    // Bottom corners: match rounded-md's own radius token (rounded-b-md's
    // remaining rounded edge) — compared against a reference element rather
    // than a hardcoded pixel value so the pin tracks the design token, not
    // today's specific number.
    expect(panelStyle.borderBottomLeftRadius).toBe(referenceRadius);
    expect(panelStyle.borderBottomRightRadius).toBe(referenceRadius);
  });
});

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
