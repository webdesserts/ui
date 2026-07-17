/**
 * F16 fix: the scrollbar thumb's TOP position is now derived from the
 * scrollY MotionValue directly (mirrors SceneColumn's own composedTop
 * useTransform pattern), not from the scrollOffset React state prop.
 *
 * Background (Michael's on-device feel report, 2026-07-17, feed 801, on
 * the live app running the F14 pin): "the scroll bar teleports rather than
 * animating." Root cause: scrollOffset React state is deliberately NOT
 * updated per-tick in real mode (the whole reason the scrollY MotionValue
 * pipeline exists — see handleContentPointerMove's own comment on this
 * tradeoff) — it's only flushed at specific boundaries: synchronously at
 * command-issue time for target-based commands (scrollBy/page/etc — a
 * deliberate "chase" design), and (since F15) at a fling's onComplete. A
 * scrollbar thumb rendered from that prop therefore sat frozen through an
 * entire coast or spring and only snapped to its final position at the
 * next state flush — visually a teleport, not the visible per-frame
 * tracking every other part of this pipeline gets.
 *
 * Motion writes plain inline `element.style.top` for a MotionValue bound
 * to a non-transform CSS property (the same mechanism the content
 * wrapper's own composedTop already relies on, and that this repo's other
 * scene test files already read via `.style.top`) — this file samples
 * `thumb.style.top` directly at multiple points during a real coast to
 * prove continuous, per-frame movement rather than inferring it from
 * data-scroll-offset (which was never part of this bug — it has its own,
 * separately-correct scrollY.on("change", ...) subscription).
 */

import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneColumn, SceneObject } from "../src";
import { TestWrapper } from "./test-wrapper";
import { wait, waitForAnimationFrame } from "./utils/animation";

/** Dispatches a synthetic touch PointerEvent on `el` — mirrors this
 * suite's established helper (scene-touch.test.tsx, scene-model-sync.test.tsx). */
function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  clientY: number,
  pointerId = 1,
) {
  el.dispatchEvent(
    new PointerEvent(type, {
      pointerId,
      pointerType: "touch",
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("Scene scrollbar — thumb tracks scrollY per frame during a coast (F16)", () => {
  test("a real release fling moves the thumb continuously, not just at the settle boundary", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 4000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement;
    const rect = contentWrapper.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + 50;

    // A strong flick (same shape as scene-touch.test.tsx's own
    // release-inertia tests: 6 pointermoves at 80px steps) — a real,
    // sustained multi-hundred-px coast, not a small nudge.
    firePointer(contentWrapper, "pointerdown", startX, startY);
    await waitForAnimationFrame();
    for (let i = 1; i <= 6; i++) {
      firePointer(contentWrapper, "pointermove", startX, startY - i * 80);
      await new Promise((r) => requestAnimationFrame(r));
    }
    firePointer(contentWrapper, "pointerup", startX, startY - 6 * 80);

    // Confirm a real fling actually started (still coasting shortly after
    // release) before trusting the samples below mean anything — same
    // confirmation scene-touch.test.tsx's own fling tests use.
    const offsetAtRelease = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    await wait(30);
    const offsetSoonAfter = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    expect(offsetSoonAfter).not.toBe(offsetAtRelease);

    // Sample the thumb's OWN rendered top three times across the coast,
    // ~60ms apart — each interval must show real movement. A frozen thumb
    // (the bug) would report the SAME value across all three samples,
    // since nothing flushes scrollOffset React state until the coast's
    // eventual settle boundary.
    const sample1 = parseFloat(thumb.style.top || "0");
    await wait(60);
    const sample2 = parseFloat(thumb.style.top || "0");
    await wait(60);
    const sample3 = parseFloat(thumb.style.top || "0");

    expect(sample2).not.toBe(sample1);
    expect(sample3).not.toBe(sample2);
    // Moving in the same (downward-scrolling) direction throughout, not
    // just changing for some unrelated reason.
    expect(sample2).toBeGreaterThan(sample1);
    expect(sample3).toBeGreaterThan(sample2);
  });
});
