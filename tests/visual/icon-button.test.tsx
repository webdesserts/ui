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
import { IconButton } from "@/src";

// Inline SVG icons — avoids React context issues with @phosphor-icons/react in vitest browser mode
function GearIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16" aria-hidden="true">
      <path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm109.94-52.79a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,42.89,97.88,25a8,8,0,0,0-6.47-.6A112.1,112.1,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.63a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,213.11,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21Z" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16" aria-hidden="true">
      <path d="M213.92,210.62l-160-176A8,8,0,0,0,42.08,45.38L80,87.09V128a48,48,0,0,0,75.27,39.28l13,14.3A64,64,0,0,1,64,128V112a8,8,0,0,0-16,0v16a80.11,80.11,0,0,0,72,79.6V224H104a8,8,0,0,0,0,16h48a8,8,0,0,0,0-16H136V207.6a80,80,0,0,0,42.84-18.31l23.24,25.57a8,8,0,1,0,11.84-10.74ZM128,160a32,32,0,0,1-32-32V104.09l46.84,51.52A31.87,31.87,0,0,1,128,160Zm72-48a8,8,0,0,0-16,0v16a32.08,32.08,0,0,1-.32,4.48A8,8,0,0,0,192,144a7.91,7.91,0,0,0,1.12-.08A8,8,0,0,0,200,136ZM128,32a48.05,48.05,0,0,1,48,48V89.09l-16-17.6V80a32,32,0,0,0-64,0v1.72L81.18,65.46A48,48,0,0,1,128,32Z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16" aria-hidden="true">
      <path d="M222.37,158.46l-47.11-21.11-.13-.06a16,16,0,0,0-15.17,1.4,8.12,8.12,0,0,0-.75.56L134.87,160c-15.42-7.49-31.34-23.29-38.83-38.51l20.78-25.27c.15-.19.29-.39.43-.59a16,16,0,0,0,1.32-15.06l0-.12L97.54,33.64a16,16,0,0,0-16.62-9.52A56.26,56.26,0,0,0,32,80c0,79.4,64.6,144,144,144a56.26,56.26,0,0,0,55.88-48.92A16,16,0,0,0,222.37,158.46Z" />
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

describe("IconButton resting states", () => {
  it("iconbutton-sm-default-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-sm-default-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <IconButton size="sm" aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-default-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-default-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <IconButton aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-lg-default-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton size="lg" aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-lg-default-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <IconButton size="lg" aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-danger-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-danger-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <IconButton color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-ghost-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton ghost aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-ghost-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <IconButton ghost aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-glass-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={dotBg}>
          <IconButton glass aria-label="Settings"><GearIcon /></IconButton>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-glass-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <div style={dotBg}>
          <IconButton glass aria-label="Settings"><GearIcon /></IconButton>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-glass-danger-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={dotBg}>
          <IconButton glass color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-glass-danger-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <div style={dotBg}>
          <IconButton glass color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-sm-rounded-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton size="sm" rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-sm-rounded-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <IconButton size="sm" rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-rounded-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-rounded-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-lg-rounded-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton size="lg" rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-lg-rounded-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <IconButton size="lg" rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-rounded-danger-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-rounded-danger-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-disabled-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton disabled aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-disabled-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <IconButton disabled aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-disabled-danger-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton disabled color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-disabled-danger-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <IconButton disabled color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-disabled-rounded-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton disabled rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("iconbutton-md-disabled-rounded-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <IconButton disabled rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Border sides — dark only, grouped
// ---------------------------------------------------------------------------

describe("IconButton border sides", () => {
  it("iconbutton-md-default-border-sides-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-3 items-center">
          <IconButton borderSide="top" aria-label="Top"><GearIcon /></IconButton>
          <IconButton borderSide="right" aria-label="Right"><GearIcon /></IconButton>
          <IconButton borderSide="left" aria-label="Left"><GearIcon /></IconButton>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Hover states — dark only
// ---------------------------------------------------------------------------

describe("IconButton hover states", () => {
  it("iconbutton-md-default-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton aria-label="Settings"><GearIcon /></IconButton>
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

  it("iconbutton-md-danger-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "End Call" });
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

  it("iconbutton-md-rounded-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Mute" });
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

  it("iconbutton-md-rounded-danger-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "End Call" });
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

describe("IconButton focus states", () => {
  it("iconbutton-md-default-focus-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Settings" });
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

  it("iconbutton-md-rounded-focus-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Mute" });
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

describe("IconButton active state", () => {
  it("iconbutton-md-default-active-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Settings" });
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

  it("iconbutton-md-rounded-active-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Mute" });
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
// 3 frames per bar: 50% enter, 100% filled, 50% exit
// ---------------------------------------------------------------------------

describe("IconButton spread animation", () => {
  // Default bottom bar
  it("iconbutton-md-default-spread50-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Settings" });
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

  it("iconbutton-md-default-spread100-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Settings" });
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

  it("iconbutton-md-default-spread50-exit-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton aria-label="Settings"><GearIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Settings" });
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

  // Danger bottom bar
  it("iconbutton-md-danger-spread50-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "End Call" });
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

  it("iconbutton-md-danger-spread100-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "End Call" });
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

  it("iconbutton-md-danger-spread50-exit-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "End Call" });
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

  // Rounded ring
  it("iconbutton-md-rounded-spread50-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Mute" });
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

  it("iconbutton-md-rounded-spread100-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Mute" });
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

  it("iconbutton-md-rounded-spread50-exit-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded aria-label="Mute"><MicOffIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Mute" });
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

  // Rounded danger ring
  it("iconbutton-md-rounded-danger-spread50-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "End Call" });
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

  it("iconbutton-md-rounded-danger-spread100-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "End Call" });
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

  it("iconbutton-md-rounded-danger-spread50-exit-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <IconButton rounded color="danger" aria-label="End Call"><PhoneIcon /></IconButton>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "End Call" });
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
