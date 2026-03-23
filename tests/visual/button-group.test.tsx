import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import {
  freezeAnimationsAt,
  unfreezeAnimations,
  waitForAnimationFrame,
  animationScreenshotOptions,
} from "../utils/animation";
import { ButtonGroup, IconButton, ChevronButton } from "@/src";

// Inline SVG icons — avoids React context issues in vitest browser mode
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

function CaretDownIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="12" height="12" aria-hidden="true">
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

describe("ButtonGroup resting states", () => {
  it("group-two-iconbuttons-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ButtonGroup>
          <IconButton aria-label="Settings"><GearIcon /></IconButton>
          <IconButton aria-label="Mute"><MicOffIcon /></IconButton>
        </ButtonGroup>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("group-two-iconbuttons-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <ButtonGroup>
          <IconButton aria-label="Settings"><GearIcon /></IconButton>
          <IconButton aria-label="Mute"><MicOffIcon /></IconButton>
        </ButtonGroup>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("group-iconbutton-chevron-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ButtonGroup>
          <IconButton aria-label="Settings"><GearIcon /></IconButton>
          <ChevronButton aria-label="Open menu"><CaretDownIcon /></ChevronButton>
        </ButtonGroup>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("group-iconbutton-chevron-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <ButtonGroup>
          <IconButton aria-label="Settings"><GearIcon /></IconButton>
          <ChevronButton aria-label="Open menu"><CaretDownIcon /></ChevronButton>
        </ButtonGroup>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("group-glass-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={dotBg}>
          <ButtonGroup glass>
            <IconButton glass aria-label="Settings"><GearIcon /></IconButton>
            <IconButton glass aria-label="Mute"><MicOffIcon /></IconButton>
          </ButtonGroup>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("group-glass-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <div style={dotBg}>
          <ButtonGroup glass>
            <IconButton glass aria-label="Settings"><GearIcon /></IconButton>
            <IconButton glass aria-label="Mute"><MicOffIcon /></IconButton>
          </ButtonGroup>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Border sides — dark only
// ---------------------------------------------------------------------------

describe("ButtonGroup border sides", () => {
  it("group-border-right-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ButtonGroup borderSide="right">
          <IconButton borderSide="right" aria-label="Settings"><GearIcon /></IconButton>
          <ChevronButton borderSide="right" aria-label="Open menu"><CaretDownIcon /></ChevronButton>
        </ButtonGroup>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Spread animation — dark only
// Verify spread doesn't bleed into adjacent sibling button
// ---------------------------------------------------------------------------

describe("ButtonGroup spread animation", () => {
  it("group-spread50-no-bleed-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ButtonGroup>
          <IconButton aria-label="Settings"><GearIcon /></IconButton>
          <IconButton aria-label="Mute"><MicOffIcon /></IconButton>
        </ButtonGroup>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Settings" });
    await btn.hover();
    await waitForAnimationFrame();
    const el = btn.element() as HTMLElement;
    const anims = freezeAnimationsAt(el, 0.5, { subtree: true });
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  it("group-spread100-no-bleed-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ButtonGroup>
          <IconButton aria-label="Settings"><GearIcon /></IconButton>
          <IconButton aria-label="Mute"><MicOffIcon /></IconButton>
        </ButtonGroup>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Settings" });
    await btn.hover();
    await waitForAnimationFrame();
    const el = btn.element() as HTMLElement;
    const anims = freezeAnimationsAt(el, 1, { subtree: true });
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  it("group-spread50-exit-no-bleed-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ButtonGroup>
          <IconButton aria-label="Settings"><GearIcon /></IconButton>
          <IconButton aria-label="Mute"><MicOffIcon /></IconButton>
        </ButtonGroup>
      </TestWrapper>,
    );
    const btn = screen.getByRole("button", { name: "Settings" });
    await btn.hover();
    await waitForAnimationFrame();
    const el = btn.element() as HTMLElement;
    let anims = freezeAnimationsAt(el, 1, { subtree: true });
    unfreezeAnimations(anims, "resume");
    await page.elementLocator(screen.container).hover({ position: { x: 0, y: 0 } });
    await waitForAnimationFrame();
    anims = freezeAnimationsAt(el, 0.5, { subtree: true });
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });
});
