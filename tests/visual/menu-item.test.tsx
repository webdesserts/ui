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
import { Button, MenuItem } from "@/src";

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

/**
 * Reads a ::after transition's geometry-entry duration (the top/left/right/
 * bottom/width/height/margin entries — everything except background-color)
 * by finding "top"'s position in transitionProperty and indexing the same
 * position in transitionDuration. Indexed by property name rather than a
 * hardcoded position so the helper stays correct regardless of how many
 * geometry entries precede background-color in the transition list.
 */
function afterGeometryDuration(el: Element): string {
  const style = window.getComputedStyle(el, "::after");
  const properties = style.transitionProperty.split(", ");
  const idx = properties.indexOf("top");
  return style.transitionDuration.split(", ")[idx];
}

// ---------------------------------------------------------------------------
// Resting states — dark + light
// ---------------------------------------------------------------------------

describe("MenuItem resting states", () => {
  it("menuitem-default-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem selected>Selected Item</MenuItem>
          <MenuItem>Unselected Item</MenuItem>
          <MenuItem>Another Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("menuitem-default-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem selected>Selected Item</MenuItem>
          <MenuItem>Unselected Item</MenuItem>
          <MenuItem>Another Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("menuitem-disabled-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem>Enabled Item</MenuItem>
          <MenuItem disabled>Disabled Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("menuitem-disabled-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem>Enabled Item</MenuItem>
          <MenuItem disabled>Disabled Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Hover states — dark only (left bar spread)
// ---------------------------------------------------------------------------

describe("MenuItem hover states", () => {
  it("menuitem-default-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem>Unselected Item</MenuItem>
          <MenuItem>Another Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Unselected Item" });
    const el = btn.element() as HTMLElement;
    const restore = slowTransitions();
    await btn.hover();
    await waitForAnimationFrame();
    const anims = freezeAnimationsAt(el, 1, { subtree: true });
    restore();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  // Selected + hover is a newly-visible interplay under the M1 treatment: the
  // selected row's own resting bar color (--spread-bg-rest: interactive-bg)
  // now differs from the hover fill color it's spreading into, where
  // previously both were the same full-invert color (a same-color no-op).
  it("menuitem-selected-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem selected>Selected Item</MenuItem>
          <MenuItem>Another Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Selected Item" });
    const el = btn.element() as HTMLElement;
    const restore = slowTransitions();
    await btn.hover();
    await waitForAnimationFrame();
    const anims = freezeAnimationsAt(el, 1, { subtree: true });
    restore();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });
});

// ---------------------------------------------------------------------------
// Selected — computed-style pin (dark only). Pins the var override wiring,
// not pixels: a selected MenuItem's own background-color must resolve to the
// same value bg-surface-raised produces, and its ::after rest background
// must resolve to the same value --interactive-bg produces (the
// --spread-bg-rest override). Reference elements carry the same class/var so
// the assertion tracks the live token values instead of a hardcoded color.
// ---------------------------------------------------------------------------

describe("MenuItem selected computed styles", () => {
  it("menuitem-selected-computed-colors", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem selected>Selected Item</MenuItem>
        </div>
        <div data-testid="surface-raised-reference" className="bg-surface-raised" />
        <div data-testid="interactive-bg-reference" style={{ backgroundColor: "var(--interactive-bg)" }} />
      </TestWrapper>,
    );
    const selectedEl = screen.getByRole("button", { name: "Selected Item" }).element() as HTMLElement;
    const surfaceRaisedRef = screen.container.querySelector(
      '[data-testid="surface-raised-reference"]',
    ) as HTMLElement;
    const interactiveBgRef = screen.container.querySelector(
      '[data-testid="interactive-bg-reference"]',
    ) as HTMLElement;

    expect(window.getComputedStyle(selectedEl).backgroundColor).toBe(
      window.getComputedStyle(surfaceRaisedRef).backgroundColor,
    );
    expect(window.getComputedStyle(selectedEl, "::after").backgroundColor).toBe(
      window.getComputedStyle(interactiveBgRef).backgroundColor,
    );
  });
});

// ---------------------------------------------------------------------------
// Row height — computed style (dark only; the value doesn't vary by theme).
// Pins the standard-control-height contract (button md / TextInput md / the
// select trigger are all h-10) — the default screenshot comparator's
// tolerance is proven blind to small-geometry diffs (select-trigger-
// candidates.test.tsx's corner-radii pin), so this is the actual regression
// guard for the row-height change, not the pixel captures around it.
// ---------------------------------------------------------------------------

describe("MenuItem row height — computed style", () => {
  it("menuitem-standard-control-height-computed", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem>Unselected Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    const el = screen.getByRole("button", { name: "Unselected Item" }).element() as HTMLElement;

    // getBoundingClientRect over clientHeight — clientHeight rounds to an
    // integer and would mask sub-pixel drift; height alone (not width) since
    // width already varies with content per the flex row's own w-full.
    expect(el.getBoundingClientRect().height).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Focus-visible — dark only
// ---------------------------------------------------------------------------

describe("MenuItem focus states", () => {
  it("menuitem-default-focus-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem>Unselected Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    const el = screen.getByRole("button", { name: "Unselected Item" }).element() as HTMLElement;
    const restore = slowTransitions();
    await userEvent.tab();
    await waitForAnimationFrame();
    const anims = freezeAnimationsAt(el, 1, { subtree: true });
    restore();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });
});

// ---------------------------------------------------------------------------
// Spread animation — dark only
// 3 frames: 50% enter, 100% filled, 50% exit (left bar)
// ---------------------------------------------------------------------------

describe("MenuItem spread animation", () => {
  it("menuitem-default-spread50-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem>Unselected Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Unselected Item" });
    const el = btn.element() as HTMLElement;
    const restore = slowTransitions();
    await btn.hover();
    await waitForAnimationFrame();
    const anims = freezeAnimationsAt(el, 0.5, { subtree: true });
    restore();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  it("menuitem-default-spread100-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem>Unselected Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Unselected Item" });
    const el = btn.element() as HTMLElement;
    const restore = slowTransitions();
    await btn.hover();
    await waitForAnimationFrame();
    const anims = freezeAnimationsAt(el, 1, { subtree: true });
    restore();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  it("menuitem-default-spread50-exit-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem>Unselected Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Unselected Item" });
    const el = btn.element() as HTMLElement;
    const restoreEnter = slowTransitions();
    await btn.hover();
    await waitForAnimationFrame();
    let anims = freezeAnimationsAt(el, 1, { subtree: true });
    restoreEnter();
    unfreezeAnimations(anims, "resume");
    const restoreExit = slowTransitions();
    await page.elementLocator(screen.container).hover({ position: { x: 0, y: 0 } });
    await waitForAnimationFrame();
    await waitForAnimationFrame();
    anims = freezeAnimationsAt(el, 0.5, { subtree: true });
    restoreExit();
    // Allow a small pixel tolerance — the exact freeze point has minor
    // rendering variance due to subpixel text antialiasing.
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot({ ...animationScreenshotOptions, comparatorOptions: { allowedMismatchedPixelRatio: 0.01 } });
    unfreezeAnimations(anims);
  });
});

// ---------------------------------------------------------------------------
// Spread timing — computed styles (dark only; pins the parametrization, not
// pixels — duration changes don't move a frozen-fraction screenshot, see
// shared.ts's spreadSetupBase/spreadSelfTriggers doc). MenuItem sweeps a
// wider axis than buttons so it carries its own slower --spread-in value
// (300ms vs the shared 250ms default; ui#16 2026-07-23 verdict). The exit
// duration is unmodified, so rest reads the same 400ms shared default as
// Button — the hover pin (0.3s vs 0.25s) is what disambiguates the
// menu-only parametrization from Button's untouched defaults.
// ---------------------------------------------------------------------------

describe("MenuItem/Button spread timing — computed styles", () => {
  it("menuitem-spread-timing-computed", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem>Unselected Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Unselected Item" });
    const el = btn.element() as HTMLElement;

    // Rest — before any hover, the exit/idle transition (spreadSetupBase)
    // applies. MenuItem no longer overrides --spread-out, so this proves
    // clean inheritance of the shared 400ms default (same value Button
    // asserts below).
    expect(afterGeometryDuration(el)).toBe("0.4s");

    // Hover — the self-trigger transition (spreadSelfTriggers) takes over.
    // 0.3s is MenuItem's own --spread-in override; the contrast with
    // Button's 0.25s default below is what proves the parametrization is
    // menu-only.
    await btn.hover();
    await waitForAnimationFrame();
    expect(afterGeometryDuration(el)).toBe("0.3s");
  });

  it("button-spread-timing-computed", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button>A button</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "A button" });
    const el = btn.element() as HTMLElement;

    // Rest — defaults untouched by the menu-only parametrization.
    expect(afterGeometryDuration(el)).toBe("0.4s");

    // Hover — defaults untouched.
    await btn.hover();
    await waitForAnimationFrame();
    expect(afterGeometryDuration(el)).toBe("0.25s");
  });

  // --spread-fill-left default proof (shared.ts, ui#7 round 4 commit 1): a
  // bare MenuItem never sets the var, so the hover-triggered fill's ::after
  // left resolves the 0px fallback — byte-identical to the pre-decomposition
  // inset-0 behavior. getComputedStyle returns the resolved px value, not
  // the var() expression. The mechanism only becomes load-bearing once a
  // menu panel sets a non-default value (select-trigger-candidates.test.tsx's
  // seam-contrast pin).
  it("menuitem-spread-fill-left-default-computed", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: "200px" }}>
          <MenuItem>Unselected Item</MenuItem>
        </div>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Unselected Item" });
    const el = btn.element() as HTMLElement;

    await btn.hover();
    await waitForAnimationFrame();
    expect(window.getComputedStyle(el, "::after").left).toBe("0px");
  });
});
