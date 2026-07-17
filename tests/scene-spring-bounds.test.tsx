/**
 * F17 commit 1: bound the spring-chase path. Michael's on-device report
 * ("the scroll bar teleports" — feed 801/1106 — turned out to be the same
 * root cause as the composer displacement report, feed 1106) traced to a
 * missing boundary guard: driveScrollYRef's spring-chase path (every
 * wheel/keyboard/scrollbar command) has no min/max clamp of its own, unlike
 * the fling's inertia call. Under a real trackpad/wheel STREAM (multiple
 * events per animation frame), each event retargeted scrollY's spring
 * immediately and synchronously — pairs of retargets landed with ~0ms
 * elapsed between them (measured: 72 of 143 inter-retarget gaps <1ms in a
 * live probe), a numerically unstable case for Motion's own internal
 * velocity tracking (a delta/dt estimate with dt→0). The compounded,
 * unbounded velocity let scrollY's LIVE VALUE run far past maxScroll —
 * measured reaching ~1992px against a 1082px maxScroll in one probe run.
 *
 * Fix: clampSpringRetargetVelocity (inputController.ts) clamps the velocity
 * a retarget inherits from scrollY's own tracking before it feeds the new
 * spring, and driveBoundedSpring (SceneColumn.tsx) watches the live value
 * every frame, retargeting toward the nearest bound (reentrantly, through
 * the same clamp+bound machinery) whenever it exceeds
 * [0, maxScroll] ± SPRING_RUBBER_BAND_MARGIN_PX.
 *
 * This file asserts the STRUCTURAL bound holds under the exact stream
 * shape that reproduced the bug: scrollY (observed losslessly via a direct
 * `.on("change", ...)` subscription on the live MotionValue — see
 * `watchScrollYOverBound`'s own doc comment for why a DOM-attribute poll
 * isn't good enough here) must never exceed maxScroll by more than a
 * generous tolerance — comfortably above the correction's own one-or-two-
 * frame reaction lag (empirically bounded to roughly 40-160px across
 * repeated trials), but a small fraction of the pre-fix failure magnitude
 * (baseline measured 500-2600+px over max, repeatedly).
 */

import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneColumn, SceneObject } from "../src";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame, createMotionSeamRecorder } from "./utils/animation";
import { MotionSeamContext } from "../src/components/scene/motionSeam";

/** A trackpad-style wheel STREAM: 2 small wheel events per animation
 * frame, decaying deltas over ~72 frames (~1.2s) — the exact shape that
 * reproduced the mechanism (both events dispatch synchronously before the
 * frame's single requestAnimationFrame resolves, so pairs of resulting
 * spring retargets land with ~0ms elapsed between them).
 *
 * `onOverBound` is called SYNCHRONOUSLY from the live `scrollY` MotionValue's
 * own `.on("change", ...)` listener (via the motionSeam recorder) rather
 * than sampled once per rAF off a DOM attribute — polling `data-scroll-
 * offset` once per `waitForAnimationFrame()` iteration turned out to race
 * Motion's OWN internal rAF-driven update cycle: whether the test's
 * `requestAnimationFrame` callback resolves before or after Motion's own
 * onUpdate for that frame is unordered, so a poll can silently read last
 * frame's already-corrected value instead of the frame where the spike
 * actually happened (probe-confirmed: this class of DOM-attribute-vs-
 * MotionValue-internal-update race is exactly what `tests/utils/
 * animation.ts`'s own doc comments already document for the WAAPI/pin-at-
 * creation seam — same root cause, different mechanism). A `.on("change")`
 * subscription is lossless: Motion calls it synchronously on every `.set()`
 * it makes internally, with no dependency on rAF-callback ordering. */
function watchScrollYOverBound(
  scrollY: { on: (event: "change", cb: (v: number) => void) => () => void },
  getMaxScroll: () => number,
  onSample: (overBound: number) => void,
): () => void {
  return scrollY.on("change", (v) => {
    const max = getMaxScroll();
    onSample(Math.max(0, v - max, -v));
  });
}

/**
 * Drives one directional pass of a trackpad-style stream: 2 small wheel
 * events per animation frame, decaying deltas — the exact shape that
 * reproduced the mechanism (both events dispatch synchronously before the
 * frame's single requestAnimationFrame resolves, so pairs of resulting
 * spring retargets land with ~0ms elapsed between them). `sign` flips
 * direction (1 = scroll down, -1 = scroll up) so a caller can chain
 * multiple passes into one longer, realistic scroll session (down, up,
 * down again) without ever driving anything but real DOM wheel events
 * through the real pipeline.
 */
async function driveWheelStream(scene: HTMLElement, frames: number, sign: 1 | -1 = 1) {
  const colRect = scene.querySelector("[data-column]")!.getBoundingClientRect();
  const x = colRect.left + colRect.width / 2;
  const y = colRect.top + 100;
  for (let i = 0; i < frames; i++) {
    const d = sign * Math.max(4, 40 - i * 0.5);
    scene.dispatchEvent(
      new WheelEvent("wheel", { deltaY: d, clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );
    scene.dispatchEvent(
      new WheelEvent("wheel", { deltaY: d * 0.8, clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );
    await waitForAnimationFrame();
  }
}

describe("Scene spring-chase — bounded under a real wheel stream (F17 commit 1)", () => {
  test("scrollY never exceeds [0, maxScroll] by more than a small, bounded margin", async () => {
    // Content height chosen so maxScroll (~1082px, matching the fixture
    // size the mechanism was originally pinned against) is comfortably
    // LESS than the wheel stream's own total travel distance (the sum of
    // 72 frames' worth of decaying deltas) — otherwise the stream never
    // reaches the boundary at all, and this test would never exercise the
    // fix (probe-confirmed while authoring: a 4000px-tall fixture's
    // ~3200px maxScroll was never reached by this same stream, since the
    // stream's own total input distance falls short of it).
    const recorder = createMotionSeamRecorder();
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="panel" focused>
                <div data-testid="content" style={{ width: 400, height: 1882 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const maxScroll = parseFloat(column.getAttribute("data-max-scroll") ?? "0");
    expect(maxScroll).toBeGreaterThan(0);

    const scrollY = recorder.values.get("scrollY:col");
    expect(scrollY).toBeDefined();

    let worstOverBound = 0;
    const unsubscribe = watchScrollYOverBound(
      scrollY!,
      () => parseFloat(column.getAttribute("data-max-scroll") ?? "0"),
      (overBound) => {
        worstOverBound = Math.max(worstOverBound, overBound);
      },
    );

    // Five chained passes (down, up, down, up, down) — one longer,
    // realistic scrolling session rather than a single short gesture. The
    // underlying near-zero-dt condition this test targets depends on
    // exactly when a pair of same-frame retargets happens to land relative
    // to the real browser's own animation-frame scheduling, which isn't
    // something a test can force deterministically frame-by-frame (probe-
    // confirmed: even unfixed code doesn't reproduce on every single
    // pass — measured as low as 1-3/10 isolated single-pass runs).
    // Chaining five real passes gives the mechanism five independent
    // opportunities to occur within one test — still exactly the real
    // pipeline, just a longer session — which is what makes the resulting
    // pin reliable rather than a coin flip (measured 9-10/10 at five
    // passes vs 7/10 at three, see this commit's defeat-check evidence).
    await driveWheelStream(scene, 72, 1);
    await driveWheelStream(scene, 72, -1);
    await driveWheelStream(scene, 72, 1);
    await driveWheelStream(scene, 72, -1);
    await driveWheelStream(scene, 72, 1);

    // Settle watch — confirm the spring genuinely catches up and stays
    // within bounds, not just that the stream itself stayed bounded.
    for (let i = 0; i < 60; i++) await waitForAnimationFrame();
    unsubscribe();
    const finalOffset = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");

    // Generous tolerance: comfortably above the correction's own reaction
    // lag (empirically 40-160px in isolation; occasionally 300-450px
    // specifically under concurrent full-suite load, the same load-
    // dependent timing-jitter class this codebase's own `tests/utils/
    // animation.ts` already documents for other real-timing animation
    // tests — "reliable in isolation, reproducibly wrong under load"), and
    // still a small fraction of the pre-fix failure magnitude (1200-42000+
    // px, repeatedly, across this same five-pass shape and sever).
    expect(worstOverBound).toBeLessThan(300);

    // Settled within bounds, not stranded past either edge — this is what
    // commit 1 actually guarantees; whether the stream's own total input
    // happens to reach exactly maxScroll is a property of the stream's
    // shape, not the fix.
    expect(finalOffset).toBeGreaterThanOrEqual(-2);
    expect(finalOffset).toBeLessThanOrEqual(maxScroll + 2);
  });
});
