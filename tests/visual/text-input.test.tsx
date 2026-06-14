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
import { TextInput } from "@/src";

afterEach(() => {
  document.documentElement.style.colorScheme = "";
  delete document.documentElement.dataset.focusSource;
});

// A fixed width keeps every snapshot the same size regardless of placeholder
// or value length, so diffs reflect styling changes rather than text reflow.
const FRAME_WIDTH = 240;

function Frame({ children }: { children: React.ReactNode }) {
  return <div style={{ width: FRAME_WIDTH }}>{children}</div>;
}

/** The wrapper element (the box) — the input's parent, where fill/ring live. */
function wrapperOf(container: Element): HTMLElement {
  return container.querySelector("input")!.parentElement as HTMLElement;
}

/**
 * Park the pointer in the container's padding, off the field. Since hover
 * mono-inverts the field, a "resting" capture is only the true resting state if
 * the pointer isn't left hovering the element from a prior test — this makes the
 * non-interactive snapshots deterministic regardless of test order.
 */
async function restPointer(container: Element) {
  await page.elementLocator(container).hover({ position: { x: 0, y: 0 } });
}

/**
 * Focus the input and freeze its wrapper's fade at the fully-settled end state,
 * under an explicit focus modality. `source` controls the keyboard-only ring:
 * "keyboard" → ring shown, "pointer" → ring suppressed. Programmatic focus +
 * explicit modality keeps the capture deterministic (no dependence on which real
 * event happened to focus the field).
 */
async function captureFocused(container: Element, source: "keyboard" | "pointer") {
  const wrapper = wrapperOf(container);
  const input = container.querySelector("input")!;
  document.documentElement.dataset.focusSource = source;
  const restore = slowTransitions();
  input.focus();
  await waitForAnimationFrame();
  const anims = freezeAnimationsAt(wrapper, 1, { subtree: true });
  restore();
  await expect
    .element(page.elementLocator(container))
    .toMatchScreenshot(animationScreenshotOptions);
  unfreezeAnimations(anims);
}

// ---------------------------------------------------------------------------
// Resting states — every size, dark + light. Placeholder is shown so its color
// is captured alongside the bottom rule (the resting affordance).
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
    await restPointer(screen.container);
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
    await restPointer(screen.container);
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
    await restPointer(screen.container);
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
    await restPointer(screen.container);
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
    await restPointer(screen.container);
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
    await restPointer(screen.container);
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
    await restPointer(screen.container);
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
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Hover states — the field fades to the interactive surface (mono-inversion)
// and text inverts, WITHOUT the accent ring (the ring is focus-only). Frozen at
// progress 1 = the fully-filled end state.
// ---------------------------------------------------------------------------

describe("TextInput hover states", () => {
  it("text-input-md-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    const wrapper = wrapperOf(screen.container);
    const restore = slowTransitions();
    await screen.getByRole("textbox").hover();
    await waitForAnimationFrame();
    const anims = freezeAnimationsAt(wrapper, 1, { subtree: true });
    restore();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });

  it("text-input-md-hover-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    const wrapper = wrapperOf(screen.container);
    const restore = slowTransitions();
    await screen.getByRole("textbox").hover();
    await waitForAnimationFrame();
    const anims = freezeAnimationsAt(wrapper, 1, { subtree: true });
    restore();
    await expect
      .element(page.elementLocator(screen.container))
      .toMatchScreenshot(animationScreenshotOptions);
    unfreezeAnimations(anims);
  });
});

// ---------------------------------------------------------------------------
// Keyboard focus — the fill PLUS the accent ring (tab-style focus). Mirrors a
// Button's :focus-visible: fill + ring.
// ---------------------------------------------------------------------------

describe("TextInput keyboard focus states", () => {
  it("text-input-md-focus-keyboard-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    await captureFocused(screen.container, "keyboard");
  });

  it("text-input-md-focus-keyboard-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    await captureFocused(screen.container, "keyboard");
  });
});

// ---------------------------------------------------------------------------
// Pointer focus — the SAME fill but NO ring (click-style focus). This is the
// behavior a bare <input> can't get (the browser forces its focus ring on);
// the wrapper + focus-modality signal suppress the ring on click.
// ---------------------------------------------------------------------------

describe("TextInput pointer focus states", () => {
  it("text-input-md-focus-pointer-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    await captureFocused(screen.container, "pointer");
  });

  it("text-input-md-focus-pointer-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput placeholder="Placeholder" />
        </Frame>
      </TestWrapper>,
    );
    await captureFocused(screen.container, "pointer");
  });
});

// ---------------------------------------------------------------------------
// Invalid states — the bottom rule is danger-colored (every size). It persists
// through the fill on focus (the danger line stays as the error cue while the
// field fills the neutral interactive surface). Keyboard focus still rings.
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
    await restPointer(screen.container);
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
    await restPointer(screen.container);
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
    await restPointer(screen.container);
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
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("text-input-md-invalid-focus-keyboard-dark", async () => {
    // The neutral fill comes in but the danger bottom rule persists beneath it,
    // and keyboard focus still rings.
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <Frame>
          <TextInput invalid placeholder="Required" />
        </Frame>
      </TestWrapper>,
    );
    await captureFocused(screen.container, "keyboard");
  });
});

// ---------------------------------------------------------------------------
// Disabled states — dark + light, with and without a value. The fill is gated
// to enabled inputs, so a disabled field stays at rest under the pointer.
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
    await restPointer(screen.container);
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
    await restPointer(screen.container);
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
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});
