/**
 * F17 commit 2: wheel input coalescing. See Scene.tsx's own wheel handler
 * comment for the full mechanism this closes (a real wheel/trackpad stream
 * firing multiple events per animation frame used to call driveScrollYRef's
 * spring-chase animate() once PER EVENT, synchronously and immediately —
 * this file asserts that's no longer true: a burst of same-frame wheel
 * events now produces exactly one scrollY retarget (one animate() call, one
 * registerControls registration) per real animation frame, not one per
 * event.
 *
 * Counts via a custom MotionSeamRegistration (not the shared
 * createMotionSeamRecorder, which only stores the LATEST registration per
 * key and would silently lose earlier calls if this test's premise were
 * false) — every registerControls("scrollY:col", ...) call increments a
 * counter, giving a direct, unambiguous count of how many animate()
 * invocations this stream produced.
 */

import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneColumn, SceneObject } from "../src";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame } from "./utils/animation";
import { MotionSeamContext, type MotionSeamRegistration } from "../src/components/scene/motionSeam";

function createCountingRecorder(): MotionSeamRegistration & { scrollYRetargetCount: () => number } {
  let scrollYRetargets = 0;
  return {
    registerMotionValue() {},
    registerControls(key) {
      if (key === "scrollY:col") scrollYRetargets++;
    },
    registerTarget() {},
    unregisterMotionValue() {},
    scrollYRetargetCount: () => scrollYRetargets,
  };
}

describe("Scene wheel input coalescing (F17 commit 2)", () => {
  test("a multi-event-per-frame wheel stream produces at most one scrollY retarget per real animation frame", async () => {
    const recorder = createCountingRecorder();
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="panel" focused>
                <div data-testid="content" style={{ width: 400, height: 4000 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const colRect = column.getBoundingClientRect();
    const x = colRect.left + colRect.width / 2;
    const y = colRect.top + 100;

    // Baseline BEFORE dispatch — mount itself can register scrollY:col at
    // least once (e.g. an initial geometry-settling pass unrelated to
    // wheel input), so this test measures the DELTA the wheel stream
    // itself produces, not an assumed absolute count.
    const before = recorder.scrollYRetargetCount();

    // Multiple wheel events dispatched synchronously, no awaits between
    // them — the exact "several events land in the same animation frame"
    // shape this coalescing targets.
    for (let i = 0; i < 5; i++) {
      scene.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 10, clientX: x, clientY: y, bubbles: true, cancelable: true }),
      );
    }

    // Still buffered — dispatching alone must not have triggered any
    // animate() call yet, coalesced or not.
    expect(recorder.scrollYRetargetCount()).toBe(before);

    await waitForAnimationFrame();

    // One flush, one retarget — not five.
    expect(recorder.scrollYRetargetCount()).toBe(before + 1);
  });
});
