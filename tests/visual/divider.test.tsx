import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import { Divider, type DividerVariant } from "@/src";

/**
 * Divider is fully static (no hover/focus/transition), so this is the
 * minimal render → toMatchScreenshot() shape (matching glass-panel.test.tsx's
 * simplest cases). A fixed-width wrapper with text above/below gives the
 * dotted rule visible context to sit against.
 */

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

const FRAME_WIDTH = 320;

async function renderDivider(variant: DividerVariant) {
  const screen = await render(
    <TestWrapper>
      <div style={{ width: FRAME_WIDTH }}>
        <p className="text-text-secondary text-sm pb-3">Section above</p>
        <Divider variant={variant} />
        <p className="text-text-secondary text-sm pt-3">Section below</p>
      </div>
    </TestWrapper>,
  );
  await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
}

describe("Divider variants", () => {
  it("divider-default-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderDivider("default");
  });

  it("divider-default-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderDivider("default");
  });

  it("divider-subtle-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderDivider("subtle");
  });

  it("divider-subtle-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderDivider("subtle");
  });
});
