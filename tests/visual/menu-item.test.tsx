import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import {
  freezeAnimationsAt,
  unfreezeAnimations,
  waitForAnimationFrame,
  slowTransitions,
  animationScreenshotOptions,
} from "../utils/animation";
import { MenuItem } from "@/src";

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

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
    const btn = screen.getByRole("button", { name: "Unselected Item" });
    const el = btn.element() as HTMLElement;
    const restore = slowTransitions();
    el.focus();
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
