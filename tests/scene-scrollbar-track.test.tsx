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

/**
 * ui#4: pins the thumb's position-mapping formula (Scrollbar.tsx) —
 * `thumbTop = (scrollOffset / maxScroll) * (trackHeight - thumbHeight)`,
 * where `thumbHeight = Math.max(20, (trackHeight / contentHeight) *
 * trackHeight)` and `contentHeight = maxScroll + trackHeight` — against the
 * current implementation. Discriminating against two plausible wrong
 * mappings specifically: (a) omitting the thumbHeight subtraction from the
 * range (`(offset/maxScroll) * trackHeight`), which overshoots the track's
 * bottom edge by roughly thumbHeight at maxScroll; and (b) any non-linear or
 * contentHeight-denominated variant, which the mid-offset formula pin below
 * would also catch.
 */
describe("Scene scrollbar — thumb position mapping (ui#4)", () => {
  /**
   * Polls the thumb's rendered `top` and the column's `data-scroll-offset`
   * until both are stable for 3 consecutive real frames AND the offset
   * matches `expectedOffset` — mirrors this suite's `waitForAnimationsToSettle`
   * poll-to-convergence discipline rather than guessing a fixed frame count,
   * since a target-based command's React state flush (data-scroll-offset)
   * and the thumb's own useTransform-driven style write aren't guaranteed to
   * land on the exact same frame.
   */
  async function waitForThumbSettle(
    thumb: HTMLElement,
    column: HTMLElement,
    expectedOffset: number,
  ): Promise<void> {
    let lastTop = thumb.style.top;
    let stableFrames = 0;
    for (let i = 0; i < 60; i++) {
      await waitForAnimationFrame();
      const top = thumb.style.top;
      const atOffset = column.getAttribute("data-scroll-offset") === String(expectedOffset);
      if (top === lastTop && atOffset) {
        stableFrames++;
        if (stableFrames >= 3) return;
      } else {
        stableFrames = 0;
      }
      lastTop = top;
    }
  }

  test("thumb top matches the track top at the initial (offset 0) render", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const track = scene.querySelector("[data-scrollbar]") as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement;

    const trackRect = track.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    expect(Math.abs(thumbRect.top - trackRect.top)).toBeLessThan(2);
  });

  test("thumb bottom matches the track bottom at maxScroll (bottom endpoint) — kills the missing-thumbHeight mapping", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const track = scene.querySelector("[data-scrollbar]") as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement;
    const maxScroll = Number(thumb.getAttribute("aria-valuemax"));

    // Same D4 keyboard path scene.test.tsx's own thumb-focus test uses: a
    // native (non-React) keydown listener on the thumb requires focusing it
    // first, and the "End" key maps to a toBottom command — a target-based
    // command, so its scrollOffset flush is synchronous at issue time.
    thumb.focus();
    thumb.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }),
    );
    await waitForThumbSettle(thumb, column, maxScroll);

    const trackRect = track.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    // The mapping under test subtracts thumbHeight from the range
    // (trackHeight - thumbHeight); a wrong variant that omits it
    // ((offset/maxScroll) * trackHeight) would push the thumb's bottom edge
    // roughly thumbHeight past the track's bottom at this endpoint — this
    // assertion fails under that variant.
    expect(Math.abs(thumbRect.bottom - trackRect.bottom)).toBeLessThan(2);
  });

  test("thumb top follows (offset / maxScroll) * (trackHeight - thumbHeight) at a mid offset", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const track = scene.querySelector("[data-scrollbar]") as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement;

    // 5 x ArrowDown = 5 x scrollBy(40) = a known mid-range target offset
    // (200px) — target-based commands flush scrollOffset state
    // synchronously at command-issue time (SceneColumn's applyScrollCommand).
    thumb.focus();
    for (let i = 0; i < 5; i++) {
      thumb.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    }
    await waitForThumbSettle(thumb, column, 200);

    // Everything the formula pin checks below is a MEASURED quantity, not a
    // hardcoded viewport number — only the target offset above is a known
    // constant of this test's own command sequence.
    const maxScroll = Number(thumb.getAttribute("aria-valuemax"));
    const offset = Number(column.getAttribute("data-scroll-offset"));
    expect(offset).toBe(200);

    const trackH = track.getBoundingClientRect().height;
    const thumbH = thumb.getBoundingClientRect().height;
    const expectedTop = (offset / maxScroll) * (trackH - thumbH);
    const measuredTop = parseFloat(thumb.style.top || "0");

    expect(Math.abs(measuredTop - expectedTop)).toBeLessThan(1);
  });
});
