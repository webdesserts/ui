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
import { ButtonLink } from "@/src";

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

// ---------------------------------------------------------------------------
// Resting states — dark + light
// ---------------------------------------------------------------------------

describe("ButtonLink resting states", () => {
  it("buttonlink-md-default-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-6">
          <ButtonLink href="#">About</ButtonLink>
          <ButtonLink href="#">Projects</ButtonLink>
          <ButtonLink href="#">Contact</ButtonLink>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("buttonlink-md-default-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-6">
          <ButtonLink href="#">About</ButtonLink>
          <ButtonLink href="#">Projects</ButtonLink>
          <ButtonLink href="#">Contact</ButtonLink>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("buttonlink-sm-default-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-6">
          <ButtonLink size="sm" href="#">About</ButtonLink>
          <ButtonLink size="sm" href="#">Projects</ButtonLink>
          <ButtonLink size="sm" href="#">Contact</ButtonLink>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("buttonlink-sm-default-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-6">
          <ButtonLink size="sm" href="#">About</ButtonLink>
          <ButtonLink size="sm" href="#">Projects</ButtonLink>
          <ButtonLink size="sm" href="#">Contact</ButtonLink>
        </div>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("buttonlink-md-as-button-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ButtonLink as="button">As Button</ButtonLink>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("buttonlink-md-as-button-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <ButtonLink as="button">As Button</ButtonLink>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Hover states — dark only (show 2 links, one hovered, nudge visible)
// ---------------------------------------------------------------------------

describe("ButtonLink hover states", () => {
  it("buttonlink-md-default-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-6">
          <ButtonLink href="#">About</ButtonLink>
          <ButtonLink href="#">Projects</ButtonLink>
        </div>
      </TestWrapper>,
    );
    const link = screen.getByRole("link", { name: "About" });
    await link.hover();
    await waitForAnimationFrame();
    const el = link.element() as HTMLElement;
    const anims = freezeAnimationsAt(el, 1, { subtree: true });
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });
});

// ---------------------------------------------------------------------------
// Focus-visible — dark only
// ---------------------------------------------------------------------------

describe("ButtonLink focus states", () => {
  it("buttonlink-md-default-focus-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <ButtonLink href="#">About</ButtonLink>
      </TestWrapper>,
    );
    const link = screen.getByRole("link", { name: "About" });
    const el = link.element() as HTMLElement;
    el.focus();
    await waitForAnimationFrame();
    const anims = freezeAnimationsAt(el, 1, { subtree: true });
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });
});

// ---------------------------------------------------------------------------
// Spread animation — dark only
// 3 frames: 50% enter, 100% filled, 50% exit
// ---------------------------------------------------------------------------

describe("ButtonLink spread animation", () => {
  it("buttonlink-md-default-spread50-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-6">
          <ButtonLink href="#">About</ButtonLink>
          <ButtonLink href="#">Projects</ButtonLink>
        </div>
      </TestWrapper>,
    );
    const link = screen.getByRole("link", { name: "About" });
    await link.hover();
    await waitForAnimationFrame();
    const el = link.element() as HTMLElement;
    const anims = freezeAnimationsAt(el, 0.5, { subtree: true });
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  it("buttonlink-md-default-spread100-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-6">
          <ButtonLink href="#">About</ButtonLink>
          <ButtonLink href="#">Projects</ButtonLink>
        </div>
      </TestWrapper>,
    );
    const link = screen.getByRole("link", { name: "About" });
    await link.hover();
    await waitForAnimationFrame();
    const el = link.element() as HTMLElement;
    const anims = freezeAnimationsAt(el, 1, { subtree: true });
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  it("buttonlink-md-default-spread50-exit-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-6">
          <ButtonLink href="#">About</ButtonLink>
          <ButtonLink href="#">Projects</ButtonLink>
        </div>
      </TestWrapper>,
    );
    const link = screen.getByRole("link", { name: "About" });
    await link.hover();
    await waitForAnimationFrame();
    const el = link.element() as HTMLElement;
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
