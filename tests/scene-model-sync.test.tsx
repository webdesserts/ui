/**
 * F15 fix: keep scrollOffsetRef (and, at natural boundaries, scrollOffset
 * React state) synced with scrollY while a release-inertia fling is
 * actively coasting.
 *
 * Background (Michael's on-device frozen snapshot, post-F14): every OTHER
 * scroll-command write path (scrollBy/page/toTop/toBottom/scrollTo) sets
 * scrollOffsetRef to its target synchronously at command-issue time, even
 * though the visual then springs toward it over several frames — that's a
 * deliberate "chase" design (a second command mid-spring should stack on
 * the intended TARGET, not the animation's current mid-flight position).
 * A fling has no such fixed target: it's a physics-based coast to wherever
 * momentum runs out. Nothing wrote scrollOffsetRef during that coast, and
 * the coast's own onComplete (natural settle) didn't write it either — so
 * after ANY fling (mid-coast, interrupted, OR fully settled),
 * scrollOffsetRef stayed frozen at whatever it was at release, until some
 * LATER command happened to overwrite it. A subsequent touch grab reads
 * that stale ref as its drag-start baseline
 * (`dragStartOffset.current = scrollOffsetRef.current` in
 * handleContentPointerDown) — the very first pointermove after the grab
 * then computes `dragStartOffset.current - deltaY`, snapping the visual
 * back to the stale release position regardless of how far the coast had
 * actually travelled since. The same staleness also reaches
 * wheel/keyboard/scrollbar (applyScrollCommand's scrollBy/page branch
 * reads `scrollOffsetRef.current + cmd.delta`) and the F9/F10
 * content-growth compensation clamps — this file exercises BOTH the touch
 * grab path (the one Michael's device reproduced) and a wheel tick after a
 * fling with no intervening grab, because they are protected by two
 * DIFFERENT halves of the fix, not one: the grab site was hardened to
 * derive its drag-start baseline from a guaranteed-fresh `scrollY.get()`
 * read (independent of any per-tick sync), while wheel/keyboard/scrollbar
 * and the compensation clamps have no such site-local rescue — they read
 * `scrollOffsetRef.current` cold, so ONLY the fling's own per-frame
 * `onUpdate` ref sync protects them. A defeat-check that removes onUpdate
 * while keeping the grab-site fix confirmed this split empirically: the
 * two grab tests below stayed green (the grab site alone covers them),
 * while the wheel test went red — proving onUpdate is independently
 * load-bearing, not redundant with the grab-site fix.
 *
 * `data-scroll-offset` (mirrored from scrollY via its own,
 * SEPARATELY-correct `scrollY.on("change", ...)` subscription — never
 * gated on any command type) stays accurate throughout a coast regardless
 * of this bug. It's the one ground-truth observable this file uses to
 * detect the jump: read it right before a grab, make a tiny (near-zero)
 * subsequent move, and confirm it barely changed — a large jump means the
 * grab's own drag-start baseline was stale.
 */

import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneColumn, SceneObject } from "../src";
import { MotionSeamContext } from "../src/components/scene/motionSeam";
import { TestWrapper } from "./test-wrapper";
import { wait, waitForAnimationFrame, createMotionSeamRecorder } from "./utils/animation";

/** Dispatches a synthetic touch PointerEvent on `el` — mirrors
 * scene-touch.test.tsx's own helper (real Chromium's pointer-capture
 * machinery flows through synthetic PointerEvents exactly like genuine
 * input, probe-confirmed at S3 commit-2 pickup). */
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

/** Mounts a tall, real-mode (spring/inertia-capable) single-column Scene
 * and performs a real release fling (same flick shape as
 * scene-touch.test.tsx's own release-inertia tests: 6 pointermoves at
 * 80px steps — strong enough to produce a substantial, easily-measured
 * coast). Returns the harness handles plus the release position, so each
 * test below can grab from exactly where the finger let go. */
async function mountAndFling() {
  const recorder = createMotionSeamRecorder();
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
  const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
  const rect = contentWrapper.getBoundingClientRect();
  const startX = rect.left + rect.width / 2;
  const startY = rect.top + 50;

  firePointer(contentWrapper, "pointerdown", startX, startY);
  await waitForAnimationFrame();
  for (let i = 1; i <= 6; i++) {
    firePointer(contentWrapper, "pointermove", startX, startY - i * 80);
    await new Promise((r) => requestAnimationFrame(r));
  }
  const releaseY = startY - 6 * 80;
  firePointer(contentWrapper, "pointerup", startX, releaseY);

  return { scene, column, contentWrapper, startX, releaseY, recorder };
}

describe("Scene touch — model stays synced with scrollY during a coasting fling (F15)", () => {
  test("mid-coast: grabbing and making a small move continues from where the coast actually is, not a stale release offset", async () => {
    const { column, contentWrapper, startX, releaseY } = await mountAndFling();

    // Genuinely still in flight — same mid-coast wait scene-touch.test.tsx's
    // own "grabbing and immediately releasing during an active fling" test
    // uses ("Let the fling coast for a bit — genuinely in flight").
    await wait(80);
    const trueOffsetBeforeGrab = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");

    // Grab at the SAME clientY the finger released at (a natural re-grab —
    // the gesture's own geometry implies no offset change on its own), then
    // a move just PAST classifyTouchGestureDirection's own
    // TOUCH_DIRECTION_SLOP_PX (10px) so handleContentPointerMove actually
    // commits a write (a move within slop is correctly ignored and would
    // make this assertion vacuous — probe-confirmed while authoring this
    // test: a 2px move produced a byte-identical before/after offset,
    // because it never left "undecided"). 20px is still far too little to
    // explain a large offset shift on its own — the tolerance below covers
    // it with room to spare while staying far under this bug's
    // hundreds-of-px signature.
    firePointer(contentWrapper, "pointerdown", startX, releaseY);
    firePointer(contentWrapper, "pointermove", startX, releaseY + 20);

    const offsetAfterTinyMove = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    expect(Math.abs(offsetAfterTinyMove - trueOffsetBeforeGrab)).toBeLessThan(30);

    firePointer(contentWrapper, "pointerup", startX, releaseY + 20);
  });

  test("fully settled: grabbing and making a small move after a NATURAL settle continues from the settled position, not a stale release offset", async () => {
    const { column, contentWrapper, startX, releaseY, recorder } = await mountAndFling();

    // Wait for a genuine natural settle — data-driven from Motion's own
    // computed .duration for this release's actual velocity (same
    // established technique as scene-touch.test.tsx's "after a fling
    // settles NATURALLY" test), not a blind fixed guess.
    const controls = recorder.controls.get("scrollY:col");
    expect(controls).toBeDefined();
    await wait(controls!.duration * 1000 + 500);

    const trueOffsetBeforeGrab = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");

    firePointer(contentWrapper, "pointerdown", startX, releaseY);
    firePointer(contentWrapper, "pointermove", startX, releaseY + 20);

    const offsetAfterTinyMove = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    expect(Math.abs(offsetAfterTinyMove - trueOffsetBeforeGrab)).toBeLessThan(30);

    firePointer(contentWrapper, "pointerup", startX, releaseY + 20);
  });

  test("wheel tick mid-coast, no grab at all: continues from where the coast actually is, not a stale release offset", async () => {
    // No touch grab anywhere in this test — applyScrollCommand's
    // scrollBy/page branch reads `scrollOffsetRef.current + cmd.delta`
    // directly, with no jump()-then-resync rescue the way
    // handleContentPointerDown now has. This is what the grab-based tests
    // above CANNOT prove: a defeat-check that removes only the fling's
    // onUpdate sync (keeping the grab-site fix intact) leaves both of them
    // green, because grabbing derives its baseline from a fresh
    // `scrollY.get()` read regardless of the ref. Only a wheel/keyboard-
    // style command — which has no such site-local rescue — actually
    // exercises the per-tick ref sync.
    const { column, scene, contentWrapper } = await mountAndFling();

    await wait(80);
    const trueOffsetBeforeWheel = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");

    // A small wheel tick — established scene.test.tsx convention
    // (wheelScroll/scrollColumnTo): deltaY maps 1:1 to the resulting
    // scrollBy TARGET at this Scene's default wheel scaling (the target is
    // computed and written synchronously; driveScrollYRef then SPRINGS
    // scrollY toward it, same as any other intent-driven command).
    const columnRect = contentWrapper.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 15,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );

    // Wait for the spring to fully settle before reading the final offset
    // — probe-confirmed while authoring this test: a single animation
    // frame after the wheel tick catches the spring mid-overshoot (it
    // inherits the interrupted fling's still-substantial velocity as its
    // own initial condition, same residual-velocity class
    // scene-touch.test.tsx's C6 "focus change during active fling" test
    // already documents and allows extra settle time for), not a bug —
    // reading the TRANSIENT mid-flight value made this assertion flaky at
    // a tight tolerance for reasons unrelated to what it's testing.
    await wait(2500);

    const offsetAfterWheel = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    // Settled: trueOffsetBeforeWheel + 15 (the wheel tick itself) — NOT
    // anywhere near the stale release offset + 15.
    expect(Math.abs(offsetAfterWheel - (trueOffsetBeforeWheel + 15))).toBeLessThan(5);
  });

  test("grabbing MID-SPRING (no fling involved) continues from where the spring actually is, not the spring's TARGET", async () => {
    // No fling anywhere in this test — this is the OTHER half of the
    // grab-site fix's own doc comment ("correct for EVERY interruption
    // this jump can cause — fling coast OR a mid-spring wheel/keyboard/
    // scrollbar chase"), and it's the ONE scenario that deterministically
    // discriminates the grab-site reorder on its own, with no frame-race:
    // driveScrollYRef's chase model (used by every non-fling command)
    // writes scrollOffsetRef to its TARGET synchronously at command-issue
    // time — a legitimate design (a second command mid-spring should stack
    // on the intended destination, not wherever the animation currently
    // visually is) — and has no onUpdate of its own (that only exists on
    // the FLING's animate() call). So while a wheel/keyboard-driven spring
    // is still in flight, scrollOffsetRef genuinely, correctly holds the
    // FAR-AWAY destination, not the current visual position. A grab under
    // the pre-fix ordering (`dragStartOffset.current = scrollOffsetRef.current`
    // read before stopping the spring) starts 1:1 tracking from that
    // target — the visual jumps FORWARD by the spring's remaining distance
    // on the very next move, deterministically, every time. Only the
    // grab-site's own fresh `scrollY.get()` read (taken after the jump()
    // that halts the spring) fixes this — onUpdate never enters into it,
    // since no fling occurs here at all.
    const recorder = createMotionSeamRecorder();
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="panel" focused>
                <div data-testid="content" style={{ width: 400, height: 6000 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = contentWrapper.getBoundingClientRect();
    const grabX = columnRect.left + columnRect.width / 2;
    const grabY = columnRect.top + 50;

    // A large wheel tick — a distant target (3000px, well inside this
    // fixture's ~5200px maxScroll) drives a real, slow-to-settle spring.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 3000,
        clientX: grabX,
        clientY: grabY,
        bubbles: true,
        cancelable: true,
      }),
    );

    // Mid-flight, guaranteed, no race: a FRACTION of Motion's own computed
    // .duration for THIS spring (probe-confirmed: ~0.7s at these spring
    // constants for a 3000px throw, ~1575 of 3000 reached by 100ms — a
    // substantial, easily-measured remaining distance) — data-driven off
    // the actual physics rather than a magic-number wait, so this stays
    // correct if the spring constants are ever retuned.
    const controls = recorder.controls.get("scrollY:col");
    expect(controls).toBeDefined();
    await wait(controls!.duration * 1000 * 0.15);

    const trueOffsetBeforeGrab = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    // Confirm this is genuinely mid-flight — comfortably short of the
    // 3000 target — so the assertion below is actually discriminating
    // against a real remaining distance, not a coincidentally-small one.
    expect(trueOffsetBeforeGrab).toBeGreaterThan(200);
    expect(trueOffsetBeforeGrab).toBeLessThan(2800);

    // Grab, then a slop-clearing move (>10px, per this file's own banked
    // TOUCH_DIRECTION_SLOP_PX lesson above).
    firePointer(contentWrapper, "pointerdown", grabX, grabY);
    firePointer(contentWrapper, "pointermove", grabX, grabY + 20);

    const offsetAfterTinyMove = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    // Continuous with where the spring actually was, not a forward jump
    // toward the 3000 target.
    expect(Math.abs(offsetAfterTinyMove - trueOffsetBeforeGrab)).toBeLessThan(30);

    firePointer(contentWrapper, "pointerup", grabX, grabY + 20);
  });
});
