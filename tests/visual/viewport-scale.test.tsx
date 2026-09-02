import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

/**
 * Guard for ui/t:14 (design/ui/p:6): the Playwright browser context must
 * resolve to the configured 1280x800 viewport, not fall back to Playwright's
 * own 1280x720 default. A wrong context viewport makes vitest's tester
 * iframe scale down to fit (`min(1, contextWidth/1280, contextHeight/800)`),
 * so every element screenshot in the suite gets captured through a CSS
 * `transform: scale(<1)` on an ancestor of the tester iframe — shrinking
 * captured pixel dimensions by that same factor before `deviceScaleFactor`
 * even applies. A fixed, layout-independent CSS size is the simplest thing
 * that exposes that transform: with no such fallback in effect, a
 * `100x100` CSS px box must capture at exactly `100 * devicePixelRatio` px.
 *
 * Idiomatic to vitest-dev/vitest#9363 ("Screenshot Dimensions") — a numeric
 * dimension assertion, not `toMatchScreenshot`, so it needs no baseline PNG
 * of its own and can't rot alongside one.
 */

const CSS_SIZE = 100;

async function decodePng(base64: string): Promise<{ width: number; height: number }> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

describe("viewport scale guard (ui/t:14)", () => {
  it("captures a fixed 100x100 CSS px box at exactly devicePixelRatio scale, with no tester-iframe shrink", async () => {
    const screen = await render(
      <div data-testid="fixture-box" style={{ width: CSS_SIZE, height: CSS_SIZE, backgroundColor: "#4488ff" }} />,
    );

    const element = screen.getByTestId("fixture-box").element() as HTMLElement;
    const base64 = await page.screenshot({ element, save: false });
    const { width, height } = await decodePng(base64);

    const expectedPx = CSS_SIZE * window.devicePixelRatio;
    expect(
      { width, height, devicePixelRatio: window.devicePixelRatio },
      `captured ${width}x${height} at devicePixelRatio ${window.devicePixelRatio}; expected ${expectedPx}x${expectedPx} — a smaller capture means the Playwright context viewport isn't the configured 1280x800 and the tester iframe is being scaled down to fit`,
    ).toEqual({ width: expectedPx, height: expectedPx, devicePixelRatio: window.devicePixelRatio });
  });
});
