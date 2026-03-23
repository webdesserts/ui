import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";

// Inline SVG icons — avoids React context issues with @phosphor-icons/react in vitest browser mode
function GearIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16">
      <path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm109.94-52.79a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,42.89,97.88,25a8,8,0,0,0-6.47-.6A112.1,112.1,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.63a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,213.11,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21Z" />
    </svg>
  );
}
import {
  freezeAnimationsAt,
  unfreezeAnimations,
  waitForAnimationFrame,
  slowTransitions,
  whilePressed,
  animationScreenshotOptions,
} from "../utils/animation";
import { Button } from "@/src";

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

// ---------------------------------------------------------------------------
// Resting states — dark + light
// ---------------------------------------------------------------------------

describe("Button resting states", () => {
  it("button-md-default-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button>Default</Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-md-default-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Button>Default</Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-md-ghost-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button ghost>Ghost</Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-md-ghost-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Button ghost>Ghost</Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-md-glass-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--border-default) 1px, transparent 1px)",
            backgroundSize: "12px 12px",
            padding: "1rem",
          }}
        >
          <Button glass>Glass</Button>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-md-glass-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <div
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--border-default) 1px, transparent 1px)",
            backgroundSize: "12px 12px",
            padding: "1rem",
          }}
        >
          <Button glass>Glass</Button>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-md-disabled-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button disabled>Disabled</Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-md-disabled-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Button disabled>Disabled</Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-sm-default-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button size="sm">Default</Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-sm-default-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Button size="sm">Default</Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-sm-ghost-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button size="sm" ghost>Ghost</Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-sm-ghost-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Button size="sm" ghost>Ghost</Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-sm-disabled-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button size="sm" disabled>Disabled</Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-sm-disabled-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Button size="sm" disabled>Disabled</Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-md-with-icon-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button>
          <GearIcon />
          Settings
        </Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("button-md-with-icon-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Button>
          <GearIcon />
          Settings
        </Button>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Border sides — dark only, grouped
// ---------------------------------------------------------------------------

describe("Button border sides", () => {
  it("button-md-default-border-sides-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-3 items-center">
          <Button borderSide="bottom">Bottom</Button>
          <Button borderSide="top">Top</Button>
          <Button borderSide="right">Right</Button>
          <Button borderSide="left">Left</Button>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Hover states — dark only
// ---------------------------------------------------------------------------

describe("Button hover states", () => {
  it("button-md-default-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button>Default</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Default" });
    const restore = slowTransitions();
    await btn.hover();
    await waitForAnimationFrame();
    const el = btn.element() as HTMLElement;
    const anims = freezeAnimationsAt(el, 1, { subtree: true });
    restore();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  it("button-md-ghost-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button ghost>Ghost</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Ghost" });
    const restore = slowTransitions();
    await btn.hover();
    await waitForAnimationFrame();
    const el = btn.element() as HTMLElement;
    const anims = freezeAnimationsAt(el, 1, { subtree: true });
    restore();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  it("button-md-glass-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--border-default) 1px, transparent 1px)",
            backgroundSize: "12px 12px",
            padding: "1rem",
          }}
        >
          <Button glass>Glass</Button>
        </div>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Glass" });
    const restore = slowTransitions();
    await btn.hover();
    await waitForAnimationFrame();
    const el = btn.element() as HTMLElement;
    const anims = freezeAnimationsAt(el, 1, { subtree: true });
    restore();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  it("button-md-with-icon-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button>
          <GearIcon />
          Settings
        </Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Settings" });
    const restore = slowTransitions();
    await btn.hover();
    await waitForAnimationFrame();
    const el = btn.element() as HTMLElement;
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

describe("Button focus states", () => {
  it("button-md-default-focus-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button>Default</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Default" });
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
// Active state — dark only
// ---------------------------------------------------------------------------

describe("Button active state", () => {
  it("button-md-default-active-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button>Default</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Default" });
    const el = btn.element() as HTMLElement;
    // Hover first so the spread fills and text inverts — :active always occurs
    // during :hover or :focus-visible, never on a resting button.
    const restore = slowTransitions();
    await btn.hover();
    await waitForAnimationFrame();
    const anims = freezeAnimationsAt(el, 1, { subtree: true });
    restore();
    await whilePressed(btn, () =>
      expect
        .element(page.elementLocator(screen.container))
        .toMatchScreenshot(animationScreenshotOptions),
    );
    unfreezeAnimations(anims);
  });
});

// ---------------------------------------------------------------------------
// Spread animation — dark only
// 3 frames per bar: 50% enter, 100% filled, 50% exit
// ---------------------------------------------------------------------------

describe("Button spread animation", () => {
  // Bottom bar
  it("button-md-default-spread50-bottom-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button>Hover Me</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Hover Me" });
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

  it("button-md-default-spread100-bottom-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button>Hover Me</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Hover Me" });
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

  it("button-md-default-spread50-exit-bottom-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button>Hover Me</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Hover Me" });
    const el = btn.element() as HTMLElement;
    // Hover and freeze at 100% to complete fill, then release to natural speed
    const restoreEnter = slowTransitions();
    await btn.hover();
    await waitForAnimationFrame();
    let anims = freezeAnimationsAt(el, 1, { subtree: true });
    restoreEnter();
    unfreezeAnimations(anims, "resume");
    // Move away to trigger exit transition, slow it down to capture mid-exit
    const restoreExit = slowTransitions();
    await page.elementLocator(screen.container).hover({ position: { x: 0, y: 0 } });
    await waitForAnimationFrame();
    anims = freezeAnimationsAt(el, 0.5, { subtree: true });
    restoreExit();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  // Right bar
  it("button-md-default-spread50-right-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button borderSide="right">Hover Me</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Hover Me" });
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

  it("button-md-default-spread100-right-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button borderSide="right">Hover Me</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Hover Me" });
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

  it("button-md-default-spread50-exit-right-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button borderSide="right">Hover Me</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Hover Me" });
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
    anims = freezeAnimationsAt(el, 0.5, { subtree: true });
    restoreExit();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  // Top bar
  it("button-md-default-spread50-top-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button borderSide="top">Hover Me</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Hover Me" });
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

  it("button-md-default-spread100-top-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button borderSide="top">Hover Me</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Hover Me" });
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

  it("button-md-default-spread50-exit-top-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button borderSide="top">Hover Me</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Hover Me" });
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
    anims = freezeAnimationsAt(el, 0.5, { subtree: true });
    restoreExit();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  // Left bar
  it("button-md-default-spread50-left-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button borderSide="left">Hover Me</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Hover Me" });
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

  it("button-md-default-spread100-left-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button borderSide="left">Hover Me</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Hover Me" });
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

  it("button-md-default-spread50-exit-left-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Button borderSide="left">Hover Me</Button>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Hover Me" });
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
    anims = freezeAnimationsAt(el, 0.5, { subtree: true });
    restoreExit();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });
});
