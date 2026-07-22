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
 * Select trigger comparison fixtures (ui#7 Slice 1, "Select Primitive Plan
 * (ui)"). Literal, hand-styled candidate markup — no <Select> component, no
 * floating-ui — comparing exactly the two candidates Michael's ruling
 * specifies: (a) the exemplar's own trigger, verbatim, and (b) TextInput's
 * chrome + a right-side chevron (Fork 6: the DOM is a button — real native
 * :focus-visible — only the paint job is input-shaped). Permanent durable
 * record, mirroring glass-panel.test.tsx's candidates-as-baselines precedent.
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
// Candidate (a) — prototype-verbatim (voice-chat-prototype
// components/ui/select.tsx trigger classes, unmodified). Named contradiction
// (plan): fills on focus only, never on hover — only the border tints on
// hover. Placeholder color uses ui's own text-secondary token in place of
// the exemplar's text-muted (ui-family consistency); everything else,
// including the chevron's muted color and the fill-on-focus-only mechanism,
// is untouched.
// ---------------------------------------------------------------------------

const TRIGGER_A =
  "flex w-full items-center justify-between rounded-none border-b border-t-0 border-x-0 border-rule-subtle bg-surface-input px-4 py-2.5 text-sm text-text-primary outline-none cursor-pointer transition-[color,background-color,border-color] duration-200 hover:border-accent focus:bg-interactive-bg focus:text-surface-base";

function CandidateA({ hasValue, open = false }: { hasValue: boolean; open?: boolean }) {
  return (
    <button type="button" role="combobox" aria-expanded={open} aria-haspopup="listbox" className={TRIGGER_A}>
      <span className={cn("truncate", !hasValue && "text-text-secondary")}>
        {hasValue ? "USB Headset" : "Select…"}
      </span>
      <CaretDownIcon size={14} className={cn("shrink-0 ml-2 text-text-muted transition-transform", open && "rotate-180")} />
    </button>
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
// Open-state panel — a static MenuItem + glass-panel stand-in (no floating-ui
// needed for this slice; plain flow content directly below the trigger, so
// unlike Slice 2's real floating listbox this doesn't need fullPage/explicit
// sizing — see the plan's Forecast correction D). Width-matched to the
// trigger, mirroring the exemplar's own size() middleware; offset mirrors
// the exemplar's offset(4).
// ---------------------------------------------------------------------------

function OpenPanel({ width }: { width: number }) {
  return (
    <div className="glass-panel rounded-md py-1 mt-1" style={{ width }}>
      <MenuItem>
        <span className="truncate">Built-in Microphone</span>
      </MenuItem>
      <MenuItem selected>
        <span className="text-success">&#10003;</span>
        <span className="truncate">USB Headset</span>
      </MenuItem>
      <MenuItem>
        <span className="truncate">Bluetooth Speaker</span>
      </MenuItem>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Candidate (a) — prototype-verbatim
// ---------------------------------------------------------------------------

describe("Select trigger candidate A (prototype-verbatim)", () => {
  it("select-trigger-a-rest-value-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateA hasValue />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-a-rest-value-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateA hasValue />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-a-rest-placeholder-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateA hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-a-rest-placeholder-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateA hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-a-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateA hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await captureHover(screen.container);
  });

  it("select-trigger-a-hover-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateA hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await captureHover(screen.container);
  });

  it("select-trigger-a-focus-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateA hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await captureFocus(screen.container);
  });

  it("select-trigger-a-focus-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateA hasValue={false} />
        </Frame>
      </TestWrapper>,
    );
    await captureFocus(screen.container);
  });

  it("select-trigger-a-open-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateA hasValue open />
          <OpenPanel width={FRAME_WIDTH} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-a-open-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <CandidateA hasValue open />
          <OpenPanel width={FRAME_WIDTH} />
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
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
// Beside a Button — height/visual-weight alignment, directly diagnostic for
// "in between" (mirrors TextInputPage.tsx's own beside-a-Button fixture).
// ---------------------------------------------------------------------------

describe("Select trigger beside a Button", () => {
  it("select-trigger-a-beside-button-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame width={BESIDE_WIDTH}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CandidateA hasValue={false} />
            <Button>Choose…</Button>
          </div>
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-trigger-a-beside-button-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame width={BESIDE_WIDTH}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CandidateA hasValue={false} />
            <Button>Choose…</Button>
          </div>
        </Frame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

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
});
