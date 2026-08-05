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
import { wait, waitForAnimationFrame, createMotionSeamRecorder } from "./utils/animation";
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
              <SceneObject name="object" focused>
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

// ---------------------------------------------------------------------------
// ui#27: wheel catch-stop detection. A trackpad catch (finger presses down
// mid-momentum) emits no event of its own — the stream just stops — so the
// existing spring pays off the accumulated debt as if the catch never
// happened, continuing to travel for hundreds of ms/px after input ended.
// The fix detects "silence following a stream whose last delta was still
// large" and jumps live position to the target immediately, reusing
// SceneColumn's touch-arrest idiom (handleContentPointerDown's scrollY.jump).
// See src/components/scene/inputController.ts's WHEEL_CLIFF_* constants for
// the calibration this synthesis targets.
// ---------------------------------------------------------------------------

describe("Scene wheel catch-stop detection (ui#27)", () => {
  async function mount() {
    const recorder = createMotionSeamRecorder();
    const tree = (instant: boolean) => (
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene {...(instant ? { duration: 0 } : {})}>
            <SceneColumn name="col">
              <SceneObject name="object" focused>
                <div style={{ width: 400, height: 43000 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>
    );
    const { getByTestId, rerender } = await render(tree(true));
    await waitForAnimationFrame();
    await rerender(tree(false));
    await waitForAnimationFrame();
    const scene = getByTestId("scene").element() as HTMLElement;
    const contentWrapper = (scene.querySelector("[data-column]") as HTMLElement).querySelector(
      "[data-column-content]",
    ) as HTMLElement;
    const rect = contentWrapper.getBoundingClientRect();
    const sy = recorder.values.get("scrollY:col")!;
    const fire = (deltaY: number) =>
      contentWrapper.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY,
          deltaMode: 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
    return { sy, fire };
  }

  /**
   * Polls real animation frames (not a MutationObserver — the hunt's own
   * "no tracer" acceptance discipline applies to on-device/ship-report
   * numbers, but this low-rate, once-per-real-frame poll is the same
   * mechanism this suite already uses elsewhere, e.g.
   * scene-wheel-coalescing's own settle helpers in the hunt clone) until
   * `getValue()` stops moving for 12 consecutive frames (<0.05px delta,
   * matching the hunt's own settle threshold), or 400 frames elapse.
   */
  async function settle(getValue: () => number) {
    let quiet = 0;
    let prev = getValue();
    let frames = 0;
    const start = performance.now();
    while (quiet < 12 && frames < 400) {
      await waitForAnimationFrame();
      frames++;
      const value = getValue();
      quiet = Math.abs(value - prev) < 0.05 ? quiet + 1 : 0;
      prev = value;
    }
    return { ms: performance.now() - start, final: getValue() };
  }

  /**
   * Dispatches a decaying wheel stream at a fixed cadence, stopping
   * abruptly after `events` deltas — the "caught mid-decay" shape a real
   * trackpad catch produces (finger lifts; momentum just stops mid-stream,
   * with a still-large last delta). Calibrated against the hunt's row2
   * analog (19 events, 15ms spacing, 0.94 decay from 163px — last delta
   * ~53.5px, comfortably over WHEEL_CLIFF_DELTA_FLOOR_PX).
   */
  async function fireCaughtStream(fire: (d: number) => void) {
    let delta = 163;
    for (let i = 0; i < 19; i++) {
      fire(delta);
      await wait(15);
      delta *= 0.94;
    }
  }

  /**
   * Dispatches the same decaying cadence to natural exhaustion (fades below
   * 0.5px before stopping, well under WHEEL_CLIFF_DELTA_FLOOR_PX) — the
   * uncaught control: the detector must not intervene, and the stream's
   * full momentum payoff must be preserved exactly as before this fix.
   */
  async function fireNaturalDecayStream(fire: (d: number) => void) {
    let delta = 163;
    while (delta > 0.5) {
      fire(delta);
      await wait(15);
      delta *= 0.94;
    }
  }

  test("criterion 1: a caught stream's post-input travel is arrested to a small residual, quickly", async () => {
    const { sy, fire } = await mount();
    await fireCaughtStream(fire);
    const atCutoff = sy.get();
    const { ms, final } = await settle(() => sy.get());
    const residualPx = Math.abs(final - atCutoff);
    expect(residualPx).toBeLessThanOrEqual(350);
    expect(ms).toBeLessThanOrEqual(250);
  });

  test("criterion 2 (negative control): a natural decay stream's momentum payoff is preserved — the detector must not fire on a last delta under the floor", async () => {
    const { sy, fire } = await mount();
    const start = sy.get();
    await fireNaturalDecayStream(fire);
    const atCutoff = sy.get();
    const { final } = await settle(() => sy.get());
    // A genuinely uncaught, fully-decayed stream's own physics already
    // leaves very little post-input travel (the spring has had the whole
    // long fade-out to converge) — the detector's job is to leave that
    // alone, not shrink it further or otherwise disturb it. ≤5px matches
    // the plan's own calibration for this shape (diagnostic-confirmed
    // against current source: ~3-5px, well under the outstanding floor).
    expect(Math.abs(final - atCutoff)).toBeLessThanOrEqual(5);
    // Full momentum payoff across the whole stream must still land close
    // to the undisturbed geometric-decay sum (~2709px for this shape) —
    // proves nothing upstream of the cutoff got truncated either.
    expect(final - start).toBeGreaterThan(2000);
  });

  // -------------------------------------------------------------------------
  // Orchestrator-ruled plan amendment (post-forecast-gate, caught by the full
  // regression sweep — see inputController.ts's WHEEL_STREAM_PAIRING_MS doc
  // comment): the two floors above alone can't distinguish a caught STREAM
  // from an ordinary, uncaught SINGLE wheel command whose spring simply
  // takes its own natural time to settle — measured against current source,
  // a lone 80px event left 35px of outstanding debt at the 100ms mark (over
  // the 30px floor) with nothing ever having been caught. The pairing gate
  // requires >=2 wheel-tagged commands within WHEEL_STREAM_PAIRING_MS of
  // each other before the detector may arm at all.
  // -------------------------------------------------------------------------

  test("pairing gate: a single 80px wheel event gets its full natural spring settle, zero truncation", async () => {
    const { sy, fire } = await mount();
    const start = sy.get();
    fire(80);
    const { final } = await settle(() => sy.get());
    // The exact magnitude that caught this gap pre-fix (35px outstanding at
    // the 100ms mark, over the floor) — a wrongly-firing detector would
    // truncate this well short of 80.
    expect(final - start).toBeCloseTo(80, 0);
  });

  test("pairing gate: a single 150px wheel event gets its full natural spring settle, zero truncation", async () => {
    const { sy, fire } = await mount();
    const start = sy.get();
    fire(150);
    const { final } = await settle(() => sy.get());
    expect(final - start).toBeCloseTo(150, 0);
  });

  test("pairing gate: two wheel events 200ms apart (a slow discrete-notch shape, not a stream) never arm the detector — full natural settle each time", async () => {
    const { sy, fire } = await mount();
    const start = sy.get();
    fire(150);
    // Comfortably longer than WHEEL_STREAM_PAIRING_MS (50ms) — this second
    // event does NOT pair with the first, so the stream never gets
    // confirmed and the detector never arms for either event.
    await wait(200);
    fire(150);
    const { final } = await settle(() => sy.get());
    expect(final - start).toBeCloseTo(300, 0);
  });

  test("criterion 3: a deliberate reverse after a catch rebases onto live position (responsive), and its own tail gets cliff-stopped too (stated contract, not rescued)", async () => {
    const { sy, fire } = await mount();
    await fireCaughtStream(fire);
    // Past the silence window — the forward catch's own cliff-stop has
    // already fired and jumped live position to the (now-frozen) target.
    await wait(150);
    const beforeReverse = sy.get();

    // A sustained deliberate reverse — 10 events, -60px, 15ms apart
    // (ui#o85's own F1 shape), asking for -600px total.
    for (let i = 0; i < 10; i++) {
      fire(-60);
      await wait(15);
    }
    const { ms, final } = await settle(() => sy.get());
    const delivered = final - beforeReverse;

    // Responsiveness: the counter-rebase (ui#o85 F1) means this reversal
    // starts chasing from the LIVE position immediately, not first
    // unwinding whatever the forward catch's own stale target still owed
    // — most of the -600px asked lands (measured against current source,
    // untraced: consistently ~-479 to -493px across repeated runs).
    expect(delivered).toBeLessThan(-400);
    // Stated contract (round 9's own finding, NOT a bug): the rebase does
    // not RESCUE the reversal's own tail from the SAME cliff-stop
    // mechanism — a sustained reverse burst that stops abruptly is itself
    // a wheel-tagged stream with a large last delta and real outstanding
    // debt, so it gets cliff-stopped too, same as the forward catch did.
    // The full -600px is never fully delivered.
    expect(delivered).toBeGreaterThan(-560);
    // The short settle-from-last-event (a jump signature, not a full
    // natural spring settle — compare the ~500-600ms an equivalent
    // uncaught magnitude takes elsewhere in this file/suite) is the
    // direct evidence the reversal's own tail was cliff-stopped.
    expect(ms).toBeLessThan(250);
  });
});
