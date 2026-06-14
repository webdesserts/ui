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
import { TextInput } from "@/src";

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

// A fixed width keeps every snapshot the same size regardless of placeholder
// or value length, so diffs reflect styling changes rather than text reflow.
const FRAME_WIDTH = 240;

function Frame({ children }: { children: React.ReactNode }) {
  return <div style={{ width: FRAME_WIDTH }}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Resting states — every size, dark + light. Placeholder is shown so the
// muted placeholder color is captured alongside the bottom-rule affordance.
// ---------------------------------------------------------------------------

describe("TextInput resting states", () => {
  it("text-input-sm-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput size="sm" placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-sm-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput size="sm" placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-md-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput size="md" placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-md-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput size="md" placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-lg-rest-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput size="lg" placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-lg-rest-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput size="lg" placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-md-value-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput defaultValue="https://umbra.computer/" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-md-value-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput defaultValue="https://umbra.computer/" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Focus states — the signature mono-inversion (bg → interactive, text →
// surface). Frozen at progress 1 so the transition has fully settled.
// ---------------------------------------------------------------------------

describe("TextInput focus states", () => {
  it("text-input-md-focus-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    const el = screen.getByRole("textbox").element() as HTMLElement;
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

  it("text-input-md-focus-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    const el = screen.getByRole("textbox").element() as HTMLElement;
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
// Invalid states — the bottom rule turns danger-colored at rest (every size).
// On focus the field still inverts like a valid field, with the danger rule
// persisting through the inversion as the error cue (no competing ring).
// ---------------------------------------------------------------------------

describe("TextInput invalid states", () => {
  it("text-input-sm-invalid-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput size="sm" invalid placeholder="Required" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-md-invalid-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput invalid placeholder="Required" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-md-invalid-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput invalid placeholder="Required" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-lg-invalid-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput size="lg" invalid placeholder="Required" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-md-invalid-focus-dark", async () => {
    // Focus inverts the field; the danger rule persists as the error signal.
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput invalid placeholder="Required" />
        </Frame>
      </TestWrapper>,
    );
    const el = screen.getByRole("textbox").element() as HTMLElement;
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
// Disabled states — dark + light, with and without a value.
// ---------------------------------------------------------------------------

describe("TextInput disabled states", () => {
  it("text-input-md-disabled-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput disabled placeholder="Disabled" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-md-disabled-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput disabled placeholder="Disabled" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-md-disabled-value-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput disabled defaultValue="Disabled with value" />
        </Frame>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});
