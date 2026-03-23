import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import {
  freezeAnimationsAt,
  unfreezeAnimations,
  waitForAnimationFrame,
  animationScreenshotOptions,
} from "../utils/animation";
import {
  Button,
  ButtonLink,
  IconButton,
  ChevronButton,
  ButtonGroup,
  MenuItem,
} from "@/src";

function GearIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm109.94-52.79a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,42.89,97.88,25a8,8,0,0,0-6.47-.6A112.1,112.1,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.63a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,213.11,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21Z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">
      <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Button — resting states
// ---------------------------------------------------------------------------

describe("Button variants", () => {
  it("matches screenshot: all variants at rest", async () => {
    const screen = await render(
      <TestWrapper>
        <div className="space-y-4">
          <div className="flex gap-3">
            <Button>Default</Button>
            <Button ghost>Ghost</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex gap-3">
            <Button size="sm">Small</Button>
            <Button size="sm" ghost>Small Ghost</Button>
            <Button size="sm" disabled>Small Disabled</Button>
          </div>
        </div>
      </TestWrapper>,
    );

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("button-variants-rest");
  });

  it("matches screenshot: border sides at rest", async () => {
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-3 items-center">
          <Button borderSide="bottom">Bottom</Button>
          <Button borderSide="right">Right</Button>
          <Button borderSide="left">Left</Button>
        </div>
      </TestWrapper>,
    );

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("button-border-sides-rest");
  });
});

// ---------------------------------------------------------------------------
// Button — active state (accent border)
// ---------------------------------------------------------------------------

describe("Button active state", () => {
  it("matches screenshot: active state renders accent border", async () => {
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-3">
          <Button>Press Me</Button>
          <Button ghost>Ghost Press</Button>
        </div>
      </TestWrapper>,
    );

    // Verify the active-border CSS rule exists and applies correctly.
    // We can't hold :active during a screenshot, so check that the
    // active-border utility generated the right CSS rule, then force
    // the style to verify the visual.
    const btn = screen.getByRole("button", { name: "Press Me" });
    const el = btn.element() as HTMLElement;
    const hasClass = el.classList.contains("active-border");

    // Check the generated CSS rule
    let ruleFound = false;
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          const text = rule.cssText;
          if (text.includes("active-border") && text.includes("active")) {
            ruleFound = true;
            break;
          }
        }
      } catch (e) { /* cross-origin sheets */ }
      if (ruleFound) break;
    }

    // Force the active state for visual verification
    el.style.outline = "2px solid var(--wd-accent)";
    el.style.outlineOffset = "-2px";
    const ghostEl = screen.getByRole("button", { name: "Ghost Press" }).element() as HTMLElement;
    ghostEl.style.boxShadow = "inset 0 0 0 2px var(--wd-accent)";

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("button-active-state");

    // Assert the CSS rule was generated (fails test if active-border isn't working)
    if (!hasClass) throw new Error("Button missing active-border class");
    if (!ruleFound) throw new Error("active-border CSS rule not found — Tailwind may not be generating it");
  });
});

// ---------------------------------------------------------------------------
// Button — spread animation
// ---------------------------------------------------------------------------

describe("Button spread animation", () => {
  it("matches screenshot: spread at 0%", async () => {
    const screen = await render(
      <TestWrapper>
        <Button>Hover Me</Button>
      </TestWrapper>,
    );

    const btn = screen.getByRole("button", { name: "Hover Me" });
    await btn.hover();
    await waitForAnimationFrame();

    const el = btn.element() as HTMLElement;
    const anims = freezeAnimationsAt(el, 0, { subtree: true });

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("button-spread-0pct", animationScreenshotOptions);

    unfreezeAnimations(anims);
  });

  it("matches screenshot: spread at 50%", async () => {
    const screen = await render(
      <TestWrapper>
        <Button>Hover Me</Button>
      </TestWrapper>,
    );

    const btn = screen.getByRole("button", { name: "Hover Me" });
    await btn.hover();
    await waitForAnimationFrame();

    const el = btn.element() as HTMLElement;
    const anims = freezeAnimationsAt(el, 0.5, { subtree: true });

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("button-spread-50pct", animationScreenshotOptions);

    unfreezeAnimations(anims);
  });

  it("matches screenshot: spread at 100%", async () => {
    const screen = await render(
      <TestWrapper>
        <Button>Hover Me</Button>
      </TestWrapper>,
    );

    const btn = screen.getByRole("button", { name: "Hover Me" });
    await btn.hover();
    // Wait for animation to complete
    await new Promise((r) => setTimeout(r, 400));

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("button-spread-100pct");
  });
});

// ---------------------------------------------------------------------------
// ButtonLink
// ---------------------------------------------------------------------------

describe("ButtonLink", () => {
  it("matches screenshot: at rest", async () => {
    const screen = await render(
      <TestWrapper>
        <div className="flex gap-6">
          <ButtonLink href="#">About</ButtonLink>
          <ButtonLink href="#">Projects</ButtonLink>
          <ButtonLink href="#">Contact</ButtonLink>
        </div>
      </TestWrapper>,
    );

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("buttonlink-rest");
  });

  it("matches screenshot: spread at 0%", async () => {
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
    const anims = freezeAnimationsAt(el, 0, { subtree: true });

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("buttonlink-spread-0pct", animationScreenshotOptions);

    unfreezeAnimations(anims);
  });

  it("matches screenshot: spread at 50%", async () => {
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
      .toMatchScreenshot("buttonlink-spread-50pct", animationScreenshotOptions);

    unfreezeAnimations(anims);
  });

  it("matches screenshot: spread at 100%", async () => {
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
    await new Promise((r) => setTimeout(r, 500));

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("buttonlink-spread-100pct");
  });
});

// ---------------------------------------------------------------------------
// IconButton
// ---------------------------------------------------------------------------

describe("IconButton", () => {
  it("matches screenshot: sizes and variants", async () => {
    const screen = await render(
      <TestWrapper>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <IconButton size="sm"><GearIcon /></IconButton>
            <IconButton size="md"><GearIcon /></IconButton>
            <IconButton size="lg"><GearIcon /></IconButton>
          </div>
          <div className="flex items-center gap-3">
            <IconButton color="danger"><GearIcon /></IconButton>
            <IconButton rounded><GearIcon /></IconButton>
            <IconButton ghost><GearIcon /></IconButton>
            <IconButton disabled><GearIcon /></IconButton>
          </div>
        </div>
      </TestWrapper>,
    );

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("iconbutton-variants");
  });
});

// ---------------------------------------------------------------------------
// ChevronButton
// ---------------------------------------------------------------------------

describe("ChevronButton", () => {
  it("matches screenshot: sizes and pressed", async () => {
    const screen = await render(
      <TestWrapper>
        <div className="flex items-center gap-3">
          <ChevronButton size="sm"><ChevronDownIcon /></ChevronButton>
          <ChevronButton size="md"><ChevronDownIcon /></ChevronButton>
          <ChevronButton size="lg"><ChevronDownIcon /></ChevronButton>
          <ChevronButton pressed><ChevronDownIcon /></ChevronButton>
        </div>
      </TestWrapper>,
    );

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("chevronbutton-variants");
  });
});

// ---------------------------------------------------------------------------
// ButtonGroup
// ---------------------------------------------------------------------------

describe("ButtonGroup", () => {
  it("matches screenshot: grouped icon buttons", async () => {
    const screen = await render(
      <TestWrapper>
        <div className="flex items-center gap-3">
          <ButtonGroup>
            <IconButton size="lg" ghost><GearIcon /></IconButton>
            <IconButton size="lg" ghost><GearIcon /></IconButton>
          </ButtonGroup>
          <ButtonGroup>
            <IconButton size="lg" ghost><GearIcon /></IconButton>
            <ChevronButton size="lg" ghost><ChevronDownIcon /></ChevronButton>
          </ButtonGroup>
        </div>
      </TestWrapper>,
    );

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("buttongroup-variants");
  });
});

// ---------------------------------------------------------------------------
// MenuItem
// ---------------------------------------------------------------------------

describe("MenuItem", () => {
  it("matches screenshot: selected and unselected", async () => {
    const screen = await render(
      <TestWrapper>
        <div className="w-64 rounded-md border border-rule-subtle bg-surface-raised overflow-hidden">
          <MenuItem selected>Built-in Microphone</MenuItem>
          <MenuItem>USB Headset</MenuItem>
          <MenuItem>Bluetooth Speaker</MenuItem>
        </div>
      </TestWrapper>,
    );

    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot("menuitem-variants");
  });
});
