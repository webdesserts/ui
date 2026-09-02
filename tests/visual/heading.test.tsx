import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import { Heading, type HeadingSize } from "@/src";

/**
 * Heading is fully static (no hover/focus/transition), so this is the
 * minimal render → toMatchScreenshot() shape (matching glass-panel.test.tsx's
 * simplest cases) rather than TextInput's hover/focus machinery.
 *
 * Coverage: every size gets a light+dark baseline at rest (default, not
 * muted) — this is where the size scale's visual difference (font-size,
 * line-height, weight) actually shows up. `muted` is a pure color-class
 * swap (text-text-muted vs text-text-primary) applied identically
 * regardless of size — verified in tests/heading.test.tsx and by reading
 * Heading.tsx, the two dimensions don't interact. Matching TextInput's own
 * baseline practice (its invalid/hover/focus/disabled states aren't
 * cross-produced against every size), muted gets representative coverage
 * at two sizes (the default "lg" and the smallest "sm") rather than a full
 * 4-size cross product.
 */

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

async function renderHeading(props: { size: HeadingSize; muted?: boolean }) {
  const screen = await render(
    <TestWrapper>
      <Heading {...props}>The quick brown fox</Heading>
    </TestWrapper>,
  );
  await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
}

describe("Heading resting states", () => {
  it("heading-xl-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderHeading({ size: "xl" });
  });

  it("heading-xl-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderHeading({ size: "xl" });
  });

  it("heading-lg-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderHeading({ size: "lg" });
  });

  it("heading-lg-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderHeading({ size: "lg" });
  });

  it("heading-md-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderHeading({ size: "md" });
  });

  it("heading-md-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderHeading({ size: "md" });
  });

  it("heading-sm-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderHeading({ size: "sm" });
  });

  it("heading-sm-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderHeading({ size: "sm" });
  });
});

describe("Heading muted states", () => {
  it("heading-lg-muted-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderHeading({ size: "lg", muted: true });
  });

  it("heading-lg-muted-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderHeading({ size: "lg", muted: true });
  });

  it("heading-sm-muted-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderHeading({ size: "sm", muted: true });
  });

  it("heading-sm-muted-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderHeading({ size: "sm", muted: true });
  });
});
