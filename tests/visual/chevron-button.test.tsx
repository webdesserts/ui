import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import {
  freezeAnimationsAt,
  unfreezeAnimations,
  waitForAnimationFrame,
  slowTransitions,
  whilePressed,
  animationScreenshotOptions,
} from "../utils/animation";
import { ChevronButton } from "@/src";

// Inline SVG chevron icon — avoids React context issues in vitest browser mode
function CaretDownIcon({ size = 12 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width={size} height={size} aria-hidden="true">
      <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
    </svg>
  );
}

const dotBg = {
  backgroundImage: "radial-gradient(circle, var(--border-default) 1px, transparent 1px)",
  backgroundSize: "12px 12px",
  padding: "1rem",
} as const;

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

// ---------------------------------------------------------------------------
// Resting states — dark + light
// ---------------------------------------------------------------------------

describe("ChevronButton resting states", () => {
  it("chevron-sm-default-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton size="sm" aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-sm-default-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <ChevronButton size="sm" aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-default-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-default-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <ChevronButton aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-lg-default-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton size="lg" aria-label="Open menu"><CaretDownIcon size={14} /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-lg-default-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <ChevronButton size="lg" aria-label="Open menu"><CaretDownIcon size={14} /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-danger-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton color="danger" aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-danger-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <ChevronButton color="danger" aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-ghost-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton ghost aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-ghost-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <ChevronButton ghost aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-glass-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={dotBg}>
          <ChevronButton glass aria-label="Open menu"><CaretDownIcon /></ChevronButton>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-glass-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <div style={dotBg}>
          <ChevronButton glass aria-label="Open menu"><CaretDownIcon /></ChevronButton>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-glass-danger-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={dotBg}>
          <ChevronButton glass color="danger" aria-label="Open menu"><CaretDownIcon /></ChevronButton>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-glass-danger-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <div style={dotBg}>
          <ChevronButton glass color="danger" aria-label="Open menu"><CaretDownIcon /></ChevronButton>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-pressed-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton pressed aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-pressed-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <ChevronButton pressed aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-disabled-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton disabled aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("chevron-md-disabled-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <ChevronButton disabled aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Border sides — dark only
// ---------------------------------------------------------------------------

describe("ChevronButton border sides", () => {
  it("chevron-md-default-border-right-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton borderSide="right" aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Hover states — dark only
// ---------------------------------------------------------------------------

describe("ChevronButton hover states", () => {
  it("chevron-md-default-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Open menu" });
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

  it("chevron-md-danger-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton color="danger" aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Open menu" });
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

describe("ChevronButton focus states", () => {
  it("chevron-md-default-focus-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Open menu" });
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

describe("ChevronButton active state", () => {
  it("chevron-md-default-active-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Open menu" });
    const el = btn.element() as HTMLElement;
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
// 3 frames: 50% enter, 100% filled, 50% exit
// ---------------------------------------------------------------------------

describe("ChevronButton spread animation", () => {
  it("chevron-md-default-spread50-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Open menu" });
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

  it("chevron-md-default-spread100-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Open menu" });
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

  it("chevron-md-default-spread50-exit-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ChevronButton aria-label="Open menu"><CaretDownIcon /></ChevronButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Open menu" });
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
