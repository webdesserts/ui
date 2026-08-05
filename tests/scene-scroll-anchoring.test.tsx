import { describe, test, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import type { SceneScrollMetrics } from "../src/components/scene/scrollMetrics";
import { MotionSeamContext } from "../src/components/scene/motionSeam";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame, wait, createMotionSeamRecorder, awaitStyleFlush } from "./utils/animation";
import { buildScene } from "./utils/sceneFixtures";

// ---------------------------------------------------------------------------
// F9 commit 1: content-growth scroll anchoring (anchoring-as-default)
// ---------------------------------------------------------------------------

describe("Scene content-growth scroll anchoring (F9)", () => {
  test("growth above the scroll window compensates same-frame via a React re-render (sync path)", async () => {
    // Multi-focused-object stacking: "top" (grows) above "bottom" (where
    // the user is scrolled). total=1300, viewport=800 -> maxScroll=500.
    const build = (topHeight: number) =>
      buildScene(
        [
          {
            name: "col",
            objects: [
              { name: "top", focused: true, width: 400, height: topHeight, testId: "top-content" },
              { name: "bottom", focused: true, width: 400, height: 1000, testId: "bottom-content" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      );

    const { rerender, getByTestId } = await render(build(300));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Scroll to 400 — window [400, 1200) intersects only "bottom"
    // ([300, 1300) before growth), which becomes the anchor. Poll, not a
    // single waitForAnimationFrame(): the wheel handler's setScrollOffset
    // update lands from a native DOM event outside any act() boundary, so
    // a cold first mount occasionally needs a second frame to settle
    // (same documented flake class as the scroll-restore tests above).
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-400);

    // Grow "top" from 300 to 500 (+200) via a prop change — the sync
    // per-render remeasure path.
    await rerender(build(500));

    // Same frame, no intervening stale sample: the scroll offset shifts by
    // exactly the growth delta, keeping "bottom" (the anchor) visually stable.
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-600);
  });

  test("growth above the scroll window compensates same-frame via a ResizeObserver-driven DOM mutation (async path, B2-style)", async () => {
    const { getByTestId } = await render(
      buildScene(
        [
          {
            name: "col",
            objects: [
              { name: "top", focused: true, width: 400, height: 300, testId: "top-content" },
              { name: "bottom", focused: true, width: 400, height: 1000, testId: "bottom-content" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Poll, not a single waitForAnimationFrame() — the same documented
    // first-mount flake class as the scroll-restore tests above.
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-400);

    // Grow "top" directly via the DOM — no React re-render, no prop change
    // (the B2 pattern). The shared ResizeObserver must pick this up on its
    // own, asynchronously. data-geometry-height lives on the SceneObject's
    // own OUTER wrapper (data-scene-id), not the consumer's inner content
    // div — that outer wrapper's natural height tracks the child's.
    const topContent = getByTestId("top-content").element() as HTMLElement;
    topContent.style.height = "500px"; // +200
    const topWrapper = scene.querySelector("[data-scene-id='top']") as HTMLElement;

    // Forecast Finding 1: PAIRED polling, not a single waitForAnimationFrame()
    // + one assertion. A test's own rAF continuation can resume BEFORE that
    // pass's ResizeObserver delivery per HTML spec ordering, risking a false
    // red on correct code with a naive single-sample check. Sampling BOTH
    // the geometry attribute and the scroll-offset attribute together on
    // every polled frame proves there is never a frame where geometry
    // reflects the growth but the offset still lags behind it.
    let geometryUpdated = false;
    let offsetAtGeometryUpdate = NaN;
    for (let i = 0; i < 20; i++) {
      await waitForAnimationFrame();
      const geometryHeight = parseFloat(topWrapper.getAttribute("data-geometry-height") ?? "0");
      if (geometryHeight >= 500) {
        geometryUpdated = true;
        offsetAtGeometryUpdate = parseFloat(contentWrapper.style.top || "0");
        break;
      }
    }
    expect(geometryUpdated).toBe(true);
    expect(offsetAtGeometryUpdate).toBe(-600);
  });

  test("growth of the anchor object's own body does not move the scroll offset (control)", async () => {
    // "bottom" IS the anchor here — its own growth never moves its own
    // offsetTop (nothing precedes it in the content wrapper), so this must
    // be a structural no-op, same reason B2's single-object test is safe.
    const build = (bottomHeight: number) =>
      buildScene(
        [
          {
            name: "col",
            objects: [
              { name: "top", focused: true, width: 400, height: 300, testId: "top-content" },
              { name: "bottom", focused: true, width: 400, height: bottomHeight, testId: "bottom-content" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      );

    const { rerender, getByTestId } = await render(build(1000));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Poll, not a single waitForAnimationFrame() — the same documented
    // first-mount flake class as the scroll-restore tests above.
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-400);

    await rerender(build(1400));

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-400);
  });

  test("shrinkage above the scroll window compensates negatively (control — native anchoring handles both directions)", async () => {
    const build = (topHeight: number) =>
      buildScene(
        [
          {
            name: "col",
            objects: [
              { name: "top", focused: true, width: 400, height: topHeight, testId: "top-content" },
              { name: "bottom", focused: true, width: 400, height: 1000, testId: "bottom-content" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      );

    const { rerender, getByTestId } = await render(build(500));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // total=1500, maxScroll=700. Scroll to 600 -> window [600,1400)
    // intersects "bottom" ([500,1500)) -> bottom is the anchor. Poll, not
    // a single waitForAnimationFrame() — the same documented first-mount
    // flake class as the scroll-restore tests above.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 600,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-600);

    // Shrink "top" from 500 to 300 (-200).
    await rerender(build(300));

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-400);
  });

  test("compensation applies as a jump — no spring/animate() call is invoked at rest (real/spring mode)", async () => {
    const recorder = createMotionSeamRecorder();
    const build = (topHeight: number) => (
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="top" focused>
                <div data-testid="top-content" style={{ width: 400, height: topHeight }} />
              </SceneObject>
              <SceneObject name="bottom" focused>
                <div data-testid="bottom-content" style={{ width: 400, height: 1000 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(300));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Let the wheel-triggered spring fully settle before introducing
    // growth, so this compensation event is genuinely "at rest, nothing in
    // flight" — the sibling test below covers the in-flight retarget case.
    await wait(1000);
    const controlsBeforeGrowth = recorder.controls.get(`scrollY:col`);
    expect(controlsBeforeGrowth).toBeDefined();

    await rerender(build(500));

    // No NEW animate() call — the compensation applied via a plain jump,
    // not a spring, so the recorded controls reference is unchanged.
    expect(recorder.controls.get(`scrollY:col`)).toBe(controlsBeforeGrowth);
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-600);
  });

  test("content growth while a real spring is still in flight retargets it by the same delta, preserving momentum (adjudication 1)", async () => {
    const targets = new Map<string, number>();
    const base = createMotionSeamRecorder();
    const recorder: typeof base = {
      ...base,
      registerTarget: (key, target) => targets.set(key, target),
    };
    const build = (topHeight: number) => (
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="top" focused>
                <div data-testid="top-content" style={{ width: 400, height: topHeight }} />
              </SceneObject>
              <SceneObject name="bottom" focused>
                <div data-testid="bottom-content" style={{ width: 400, height: 1000 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(300));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Trigger a real-mode wheel scroll (springs toward 400) — do NOT wait
    // for it to settle.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();

    const controlsInFlight = recorder.controls.get(`scrollY:col`);
    expect(controlsInFlight).toBeDefined();
    expect(targets.get(`scrollY:col`)).toBe(400);

    // Content grows above the window WHILE the spring is mid-flight —
    // triggers the retarget-with-velocity-carryover path.
    await rerender(build(500));

    // A NEW controls entry was registered (retargeting stopped the old
    // one and started a fresh animate() call), toward a target shifted by
    // the same +200 delta.
    expect(recorder.controls.get(`scrollY:col`)).not.toBe(controlsInFlight);
    expect(targets.get(`scrollY:col`)).toBe(600);

    // ui#17: see awaitStyleFlush's own doc comment — the retargeted
    // spring's velocity tracking updates on Motion's own rAF-driven tick,
    // same rAF-batching rationale as the DOM style writes elsewhere in
    // this file.
    await awaitStyleFlush();

    // Velocity carryover, probed directly (adjudication 1): sampled right
    // after the retarget, scrollY's velocity must still be substantial —
    // a silently-reset-to-cold-start spring would read ~0 here instead.
    const scrollYValue = base.values.get(`scrollY:col`)!;
    const velocityAfterRetarget = Math.abs(scrollYValue.getVelocity());
    expect(velocityAfterRetarget).toBeGreaterThan(10);

    // Settles at the position accounting for BOTH the original navigation
    // (400) and the compensation (+200).
    await wait(1000);
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-600);
  });

  test("a maxScroll shrink clamps instantly, not via a visible spring (F9 adjudication 3)", async () => {
    const recorder = createMotionSeamRecorder();
    const build = (contentHeight: number) => (
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="panel" focused>
                <div data-testid="content" style={{ width: 400, height: contentHeight }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(1000);
    expect(parseFloat(contentWrapper.style.top || "0")).toBeCloseTo(-300, 0);

    const controlsBeforeShrink = recorder.controls.get(`scrollY:col`);

    // Shrink content from 1200 to 900 -> new maxScroll = 100, well below
    // the current offset (300) -> the clamp effect fires.
    await rerender(build(900));

    // Same-frame: already clamped to the new maxScroll (100) on the very
    // first observable read, no intervening stale-then-corrected sample.
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-100);
    // No NEW spring was invoked — the clamp reclassified from spring to
    // jump (F9 adjudication 3); the recorded controls reference is
    // unchanged.
    expect(recorder.controls.get(`scrollY:col`)).toBe(controlsBeforeShrink);
  });
});

// ---------------------------------------------------------------------------
// F10: intra-object content-growth anchoring
// ---------------------------------------------------------------------------

describe("Scene intra-object content-growth anchoring (F10)", () => {
  const ROW_HEIGHT = 70;

  function buildRows(ids: number[], anchor: "none" | "end" = "none") {
    return (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor={anchor}>
            <SceneObject name="rows" focused>
              {ids.map((id) => (
                <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  function wheelScroll(scene: HTMLElement, column: HTMLElement, deltaY: number) {
    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  test("Peri's minimal repro: a prepend inside a single anchor object's own interior compensates the offset (object-level anchoring is structurally blind here)", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildRows(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // Scroll to 1000 — window [1000, 1800) intersects row 14 ([980, 1050)),
    // the topmost partially-visible row (row 13's [910, 980) is flush
    // against the window's start, not intersecting). Poll contentWrapper's
    // OWN rendered top (not just data-scroll-offset) before capturing a
    // "before" rect below — data-scroll-offset is written synchronously off
    // the scrollY MotionValue by the wheel handler, but the wrapper's
    // ACTUAL rendered position (instant mode's React-state-driven
    // combinedTop) only catches up on the next commit; reading a row's rect
    // in the gap between those two would capture a stale, pre-scroll position.
    wheelScroll(scene, column, 1000);
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-1000);

    const row14Before = getByTestId("row-14").element() as HTMLElement;
    const row14RectBefore = row14Before.getBoundingClientRect();

    // Prepend 20 NEW keyed rows before the existing 50 — keyed reconciliation
    // preserves the existing rows' own DOM identity, so row 14 is the SAME
    // element after this rerender, just moved 20 rows (1400px) further down.
    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildRows([...prependedIds, ...existingIds]));

    // The offset compensates by exactly the prepended height (20 * 70).
    expect(column.getAttribute("data-scroll-offset")).toBe("2400");

    // The landmark — the SAME DOM node throughout — holds its viewport position.
    const row14After = getByTestId("row-14").element() as HTMLElement;
    expect(row14After).toBe(row14Before);
    expect(row14After.getBoundingClientRect().top).toBeCloseTo(row14RectBefore.top, 0);
  });

  test("appending rows below the visible window does not move the tracked row or spuriously compensate (control)", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildRows(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    wheelScroll(scene, column, 1000);
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("1000");

    // Append 20 rows AFTER all existing ones — well below the tracked
    // row's own position, which a plain-flow layout never moves.
    const appendedIds = Array.from({ length: 20 }, (_, i) => 50 + i);
    await rerender(buildRows([...existingIds, ...appendedIds]));

    expect(column.getAttribute("data-scroll-offset")).toBe("1000");
  });

  test("offset-exactly-0 suppression: a prepend while scrolled to the very top does NOT compensate — new content stays discoverable at the top (native-anchoring-mirroring policy, anchor=\"none\" only — F11 mode-scopes this)", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    // anchor="none" pinned EXPLICITLY (F11): the suppression is now
    // mode-scoped — this test's own default-anchor reliance would no
    // longer make it obvious WHICH branch is under test now that
    // anchor="end" behaves oppositely at offset 0 (see the F11 describe
    // block below).
    const { rerender, getByTestId } = await render(buildRows(existingIds, "none"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    // Mounts at offset 0 — no scroll needed. Confirm the starting state.
    expect(column.getAttribute("data-scroll-offset")).toBe("0");

    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildRows([...prependedIds, ...existingIds], "none"));

    // Suppressed: the offset stays at 0 rather than jumping to 1400 to
    // "preserve" the old row 0's position — the newly-prepended content is
    // now what's visible at the top instead.
    expect(column.getAttribute("data-scroll-offset")).toBe("0");
    const newTopRow = getByTestId(`row-${prependedIds[0]}`).element() as HTMLElement;
    expect(newTopRow.getBoundingClientRect().top).toBeCloseTo(column.getBoundingClientRect().top, 0);
  });

  test("a tracked row that gets removed entirely (disconnected) skips compensation that round without crashing, and re-selects a fresh candidate that correctly compensates the NEXT prepend", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildRows(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    wheelScroll(scene, column, 1000);
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("1000");

    // Remove row 14 (the tracked landmark) — nothing else changes. This
    // must not throw, and must not apply a compensation this round (the
    // tracked element is gone; there is nothing valid to diff against).
    const withoutRow14 = existingIds.filter((id) => id !== 14);
    await rerender(buildRows(withoutRow14));
    expect(column.getAttribute("data-scroll-offset")).toBe("1000");

    // Self-heals: a fresh candidate (whatever now sits at the tracked
    // position — row 15, shifted up into row 14's old slot) was re-selected
    // at the end of that settle, so the NEXT prepend compensates correctly
    // again from it.
    const row15Before = getByTestId("row-15").element() as HTMLElement;
    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildRows([...prependedIds, ...withoutRow14]));

    expect(column.getAttribute("data-scroll-offset")).toBe("2400");
    expect(getByTestId("row-15").element()).toBe(row15Before);
  });

  test("composes additively with object-level compensation when a preceding sibling grows AND the anchor object's own interior prepends in the same settle (no double-counting)", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const build = (beforeHeight: number, ids: number[]) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="before" focused>
              <div data-testid="before-content" style={{ width: 400, height: beforeHeight }} />
            </SceneObject>
            <SceneObject name="rows" focused>
              {ids.map((id) => (
                <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(300, existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // total = 300 (before) + 3500 (50 rows) = 3800. Scroll to 1000 — window
    // [1000, 1800) intersects "rows" (which starts at 300), and within it,
    // row 10 (global [1000, 1070)) is the topmost intersecting row (row 9's
    // global [930, 1000) is flush against the window's start). Poll
    // contentWrapper's OWN rendered top (see the primary repro test's
    // identical comment) — this is what guarantees the layout effect (and
    // thus F10's intra-anchor RE-SELECTION for row 10) has actually run
    // before the combined growth event below, not just that
    // data-scroll-offset's synchronous MotionValue write landed.
    wheelScroll(scene, column, 1000);
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-1000);

    // "before" grows 300 -> 400 (object-level delta: +100, sibling growth
    // shifts "rows" itself down) AND "rows" gets a 20-row prepend
    // (intra-level delta, measured LOCAL to "rows": +1400) in the SAME
    // rerender. If the intra-level delta were measured globally instead of
    // locally, it would ALREADY include the +100 from "before" growing
    // (row 10's absolute position reflects both), and adding the
    // object-level delta on top would double-count it — the correct total
    // is 100 + 1400 = 1500, not 100 + 1500 = 1600.
    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(build(400, [...prependedIds, ...existingIds]));

    expect(column.getAttribute("data-scroll-offset")).toBe("2500");
  });

  test("pinned anchor=\"end\" already follows a prepend via the existing pin-follow mechanism (confirmation, not new F10 logic)", async () => {
    const buildPinned = (ids: number[]) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end">
            <SceneObject name="rows" focused>
              {ids.map((id) => (
                <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildPinned(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    // Mounts pinned at maxScroll (3500 - 800 = 2700).
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("2700");

    // A prepend still keeps the offset at the (new, larger) maxScroll —
    // the pin-follow effect reacts to maxScroll growing, independent of F10.
    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildPinned([...prependedIds, ...existingIds]));

    expect(column.getAttribute("data-scroll-offset")).toBe("4100"); // 4900 - 800
  });
});

// ---------------------------------------------------------------------------
// F10b: recursive intra-object anchor descent
// ---------------------------------------------------------------------------

describe("Scene recursive intra-object anchor descent (F10b)", () => {
  const ROW_HEIGHT = 70;

  // Mirrors Peri's real pipeline shape (scene-lab 53): SceneObject's own
  // inert wrapper (single-child, implicit) -> a flex stack (real siblings:
  // rows-container + sticky Composer + sticky PushBanner) -> the rows
  // themselves, nested INSIDE rows-container. F10's one-level descent stops
  // at the flex-stack level (the first level with real siblings) and tracks
  // rows-container itself — an identity-stable wrapper whose own offsetTop
  // never moves from a prepend inside it, reproducing F10's exact blindness
  // one level down.
  function buildChatPipeline(rowIds: number[]) {
    return (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="chat" focused>
              <div data-testid="flex-stack" style={{ display: "flex", flexDirection: "column" }}>
                <div data-testid="rows-container">
                  {rowIds.map((id) => (
                    <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                      row {id}
                    </div>
                  ))}
                </div>
                <div data-testid="composer" style={{ position: "sticky", bottom: 0, height: 60, width: 400 }}>
                  composer
                </div>
                <div data-testid="push-banner" style={{ position: "sticky", top: 0, height: 40, width: 400 }}>
                  push banner
                </div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  test("Peri's real pipeline shape (rows nested two wrapper levels deep, sticky Composer/PushBanner siblings) compensates fully — object-level and F10's one-level descent both reproduce the exact blindness one level down", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildChatPipeline(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // Scroll to 1000 — window [1000, 1800) intersects row 14 ([980, 1050)),
    // the topmost partially-visible row. Poll contentWrapper's OWN rendered
    // top (not just data-scroll-offset) before capturing a "before" rect —
    // see the F10 primary repro test's identical rationale.
    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 1000,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-1000);

    const row14Before = getByTestId("row-14").element() as HTMLElement;
    const row14RectBefore = row14Before.getBoundingClientRect();

    // Prepend 20 NEW keyed rows before the existing 50, nested INSIDE
    // rows-container (two wrapper levels below the flex stack).
    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildChatPipeline([...prependedIds, ...existingIds]));

    // The offset compensates by exactly the prepended height (20 * 70).
    expect(column.getAttribute("data-scroll-offset")).toBe("2400");

    const row14After = getByTestId("row-14").element() as HTMLElement;
    expect(row14After).toBe(row14Before);
    expect(row14After.getBoundingClientRect().top).toBeCloseTo(row14RectBefore.top, 0);
  });
});

// ---------------------------------------------------------------------------
// F11 commit 1: offset-0 suppression policy, mode-scoped
// ---------------------------------------------------------------------------

describe("Scene offset-0 policy mode-scoping (F11 commit 1)", () => {
  const ROW_HEIGHT = 70;

  // Mirrors Peri's real CR-3 pipeline shape (the parked LiveChatHarness
  // repro, extracted from their commit 06588863): an anchor="end" column
  // with a flex-column stack (rows + a sticky composer) — same structural
  // shape as F10b's own chat pipeline test, just anchor="end" here instead
  // of "none". F10's original suppression fired unconditionally at offset
  // 0, producing Peri's exact zero-compensation signature once their
  // reader scrolled all the way back to the oldest loaded message.
  function buildChatPipeline(rowIds: number[]) {
    return (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="chat" anchor="end">
            <SceneObject name="chat" focused>
              <div data-testid="flex-stack" style={{ display: "flex", flexDirection: "column" }}>
                <div data-testid="rows-container">
                  {rowIds.map((id) => (
                    <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                      row {id}
                    </div>
                  ))}
                </div>
                <div data-testid="composer" style={{ position: "sticky", bottom: 0, height: 60, width: 400 }}>
                  composer
                </div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  test("a prepend while scrolled to offset 0 on an anchor=\"end\" column DOES compensate — the reader is holding their place in history, not at a discoverable top (Peri's real CR-3 pipeline shape)", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildChatPipeline(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // Mounts pinned at maxScroll. Release the pin and scroll all the way to
    // offset 0 (a huge negative deltaY, clamped) — the exact CR-3 scenario:
    // the reader has read back to the oldest currently-loaded message,
    // which is genuinely ON SCREEN at the top.
    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100000,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Poll contentWrapper's OWN rendered top (not just data-scroll-offset)
    // before capturing a "before" rect below — same rationale as every
    // other F10/F10b test in this file (a raw wheel event's React-state
    // write needs an actual commit to catch up).
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBeCloseTo(0, 5);
    expect(column.getAttribute("data-scroll-offset")).toBe("0");

    const row0Before = getByTestId("row-0").element() as HTMLElement;
    const row0RectBefore = row0Before.getBoundingClientRect();

    // Prepend 20 NEW keyed rows before the existing 50 (loadOlder's shape).
    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildChatPipeline([...prependedIds, ...existingIds]));

    // Compensates by exactly the prepended height (20 * 70) — UNLIKE
    // anchor="none"'s offset-0 suppression (the sibling test above), since
    // this reader is holding their place in history, not discoverable-top-
    // of-a-live-feed.
    expect(column.getAttribute("data-scroll-offset")).toBe("1400");

    const row0After = getByTestId("row-0").element() as HTMLElement;
    expect(row0After).toBe(row0Before);
    expect(row0After.getBoundingClientRect().top).toBeCloseTo(row0RectBefore.top, 0);
  });
});

// ---------------------------------------------------------------------------
// F11 commit 2: declarative scrollTo
// ---------------------------------------------------------------------------

describe("Scene declarative scrollTo (F11 commit 2)", () => {
  const ROW_HEIGHT = 70;
  const ROW_COUNT = 50;
  const rowIds = Array.from({ length: ROW_COUNT }, (_, i) => i);

  function buildScrollTo(scrollToId: string | null, anchor: "none" | "end" = "none") {
    return (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor={anchor} scrollTo={scrollToId}>
            <SceneObject name="rows" focused>
              {rowIds.map((id) => (
                <div key={id} id={`row-${id}`} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  test("navigates to a target below the current window, aligning its bottom with the viewport's bottom", async () => {
    const { rerender, getByTestId } = await render(buildScrollTo(null));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    expect(column.getAttribute("data-scroll-offset")).toBe("0");

    // row-30 spans [2100, 2170) — entirely below window [0, 800). Aligning
    // the bottom: offset = 2170 - 800 = 1370.
    await rerender(buildScrollTo("row-30"));
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("1370");
  });

  test("navigates to a target above the current window, aligning its top with the viewport's top", async () => {
    const { rerender, getByTestId } = await render(buildScrollTo(null));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 2000,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("2000");

    // row-5 spans [350, 420) — entirely above window [2000, 2800).
    await rerender(buildScrollTo("row-5"));
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("350");
  });

  test("an already-fully-visible target does not move the offset", async () => {
    const { rerender, getByTestId } = await render(buildScrollTo(null));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 1000,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("1000");

    // row-15 spans [1050, 1120) — fully contained in window [1000, 1800).
    await rerender(buildScrollTo("row-15"));
    // No movement — give it a beat to prove it genuinely stays, not just
    // hasn't updated yet.
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("1000");
  });

  test("null is inert — no navigation occurs", async () => {
    const { getByTestId } = await render(buildScrollTo(null));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("0");
  });

  test("an unknown id is a documented no-op with a loud dev console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { rerender, getByTestId } = await render(buildScrollTo(null));
      const scene = getByTestId("scene").element() as HTMLElement;
      const column = scene.querySelector("[data-column]") as HTMLElement;

      await rerender(buildScrollTo("does-not-exist"));
      await waitForAnimationFrame();

      expect(column.getAttribute("data-scroll-offset")).toBe("0");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("does-not-exist"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("one-shot semantics: re-setting the SAME id (unchanged prop value) does not re-navigate, even after the user has since scrolled elsewhere", async () => {
    const { rerender, getByTestId } = await render(buildScrollTo(null));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    await rerender(buildScrollTo("row-30"));
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("1370");

    // The user scrolls elsewhere afterward — a real interaction the
    // component must not clobber on a later re-render.
    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -500,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("870");

    // Re-rendering with the SAME "row-30" value (identical string, no
    // intervening null) must NOT re-fire — the offset must stay at the
    // user's own 870, not jump back to 1370.
    await rerender(buildScrollTo("row-30"));
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("870");
  });

  test("springs (real/animated mode), not jump — the offset transitions gradually rather than landing instantly, unlike F9/F10's content-driven compensation", async () => {
    // Deliberately NOT using motionSeam controls-reference comparison here:
    // probe-confirmed this component can register an UNRELATED scrollY
    // controls entry near mount at a non-deterministic time (some other
    // real-mode mechanism, timing-variable — not scrollTo's own doing),
    // which made a "did the controls reference change" assertion flaky/
    // vacuous in practice (it passed even against a deliberately severed
    // dispatch, on a timing coincidence). The DIRECTLY OBSERVABLE
    // distinction between jump and spring is more robust: a jump (F9/F10's
    // compensation path) lands at its final value the same frame it's
    // applied; a real spring takes actual animation time — F9's own "let
    // the wheel-triggered spring fully settle" comment elsewhere in this
    // file uses a full second for the SAME default transition.
    const buildReal = (scrollToId: string | null) => (
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col" scrollTo={scrollToId}>
            <SceneObject name="rows" focused>
              {rowIds.map((id) => (
                <div key={id} id={`row-${id}`} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(buildReal(null));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    await rerender(buildReal("row-30"));
    // Sample almost immediately — a jump would already show the final
    // value (1370, per the "navigates to a target below" test) on the
    // very next readable frame; a spring is still mid-transition here.
    await waitForAnimationFrame();
    const midFlightOffset = column.getAttribute("data-scroll-offset");
    expect(midFlightOffset).not.toBeNull();
    expect(midFlightOffset).not.toBe("1370");

    // Eventually settles at the correct final target.
    await expect.poll(() => column.getAttribute("data-scroll-offset"), { timeout: 5000 }).toBe("1370");
  });

  test("send-jump composition: on an anchor=\"end\" column, scrolling to an id at the end RE-PINS, and subsequent growth follows again", async () => {
    const { rerender, getByTestId } = await render(buildScrollTo(null, "end"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    // Mounts pinned at maxScroll (2700).
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("2700");

    // Release the pin.
    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -1000,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("1700");

    // scrollTo the LAST row — its bottom aligns with maxScroll, landing
    // within the re-pin threshold.
    await rerender(buildScrollTo("row-49", "end"));
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("2700");

    // Growth now follows again — proves the pin genuinely RE-ENGAGED, not
    // just that this one navigation happened to land at maxScroll.
    const grownIds = [...rowIds, ROW_COUNT]; // append one more row
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end" scrollTo="row-49">
            <SceneObject name="rows" focused>
              {grownIds.map((id) => (
                <div key={id} id={`row-${id}`} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("2770"); // new maxScroll
  });
});

// ---------------------------------------------------------------------------
// F12: witness-element anchoring
// ---------------------------------------------------------------------------

describe("Scene witness-element anchoring (F12)", () => {
  const ROW_HEIGHT = 70;

  // Mirrors MessageList's real DOM shape: a stationary "load earlier
  // messages" affordance ABOVE the rows, then the rows themselves, then a
  // sticky composer. Round-4 CR-3 (scene-lab): at offset EXACTLY 0 the
  // affordance — not a row — is the topmost in-view element, so it becomes
  // the tracked F10/F10b anchor; a prepend BELOW it (loadOlder's real DOM
  // shape) never moves the affordance's own offsetTop, so the pre-F12
  // intraDelta path stayed 0 and never compensated.
  function buildAffordancePipeline(
    rowIds: number[],
    affordanceHeight: number,
    anchor: "none" | "end",
    gap = 0,
  ) {
    return (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="chat" anchor={anchor}>
            <SceneObject name="chat" focused>
              <div style={{ display: "flex", flexDirection: "column", gap }}>
                <div data-testid="load-older" style={{ width: 400, height: affordanceHeight }}>
                  load earlier messages
                </div>
                <div data-testid="rows-container">
                  {rowIds.map((id) => (
                    <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                      row {id}
                    </div>
                  ))}
                </div>
                <div data-testid="composer" style={{ position: "sticky", bottom: 0, height: 60, width: 400 }}>
                  composer
                </div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  // Drives the column to an exact offset from WHATEVER its current offset
  // is (mount state differs by anchor mode — "end" mounts pinned at
  // maxScroll, "none" mounts at 0), reading data-scroll-offset live rather
  // than assuming a starting point. deltaY maps 1:1 onto the offset delta
  // (established by every other wheel-driven test in this file — e.g. the
  // scrollTo suite's `deltaY: 1000` producing offset "1000" from a mount-at-
  // 0 start); `Scene duration={0}` in these fixtures makes the write land
  // the same tick this polls for.
  async function scrollColumnTo(scene: HTMLElement, column: HTMLElement, targetOffset: number) {
    const currentOffset = Number(column.getAttribute("data-scroll-offset") ?? "0");
    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: targetOffset - currentOffset,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBeCloseTo(-targetOffset, 5);
    expect(column.getAttribute("data-scroll-offset")).toBe(String(targetOffset));
  }

  test("offset EXACTLY 0, stationary leading affordance: a prepend below it still compensates (the red→green pin — Peri's round-4 CR-3 shape)", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 40, "end"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await scrollColumnTo(scene, column, 0);

    const row0Before = getByTestId("row-0").element() as HTMLElement;
    const row0RectBefore = row0Before.getBoundingClientRect();

    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildAffordancePipeline([...prependedIds, ...existingIds], 40, "end"));

    expect(column.getAttribute("data-scroll-offset")).toBe("1400");
    const row0After = getByTestId("row-0").element() as HTMLElement;
    expect(row0After).toBe(row0Before);
    expect(row0After.getBoundingClientRect().top).toBeCloseTo(row0RectBefore.top, 0);
  });

  test("offset 120 (the affordance already scrolled out of view, a real row is the anchor): still compensates — regression guard", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 40, "end"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await scrollColumnTo(scene, column, 120);

    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildAffordancePipeline([...prependedIds, ...existingIds], 40, "end"));

    expect(column.getAttribute("data-scroll-offset")).toBe("1520");
  });

  test("mode-scoping, anchor=\"end\": a stationary affordance-as-anchor MID-scroll (not just at offset 0) still compensates on insertion below it", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 300, "end"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    // The 300px affordance is still the topmost in-view element at offset
    // 100 (window [100, 900) still intersects [0, 300)) — the affordance is
    // the tracked anchor here same as at offset 0, just not scrolled all
    // the way to the top.
    await scrollColumnTo(scene, column, 100);

    const prependedIds = Array.from({ length: 5 }, (_, i) => -5 + i);
    await rerender(buildAffordancePipeline([...prependedIds, ...existingIds], 300, "end"));

    expect(column.getAttribute("data-scroll-offset")).toBe("450"); // 100 + 5*70
  });

  test("mode-scoping, anchor=\"none\": the IDENTICAL insertion does NOT compensate (native hold-the-top; witness never recorded outside anchor=\"end\")", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 300, "none"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await scrollColumnTo(scene, column, 100);

    const prependedIds = Array.from({ length: 5 }, (_, i) => -5 + i);
    await rerender(buildAffordancePipeline([...prependedIds, ...existingIds], 300, "none"));

    // Give it a beat to prove it genuinely stays, not just hasn't updated yet.
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("100");
  });

  test("anchor's own growth (no insertion) is NOT witness-compensated — in-place growth keeps native hold-the-top", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 40, "end"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await scrollColumnTo(scene, column, 0);

    // Grow the affordance's OWN height (40 -> 140) — no row prepend, no
    // other structural change. This is the same class of event the
    // anchor-height guard exists for (e.g. an image loading inside a
    // tracked anchor).
    await rerender(buildAffordancePipeline(existingIds, 140, "end"));

    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("0");
  });

  test("offset EXACTLY 0, stationary leading affordance, flex `gap` between it and the rows (Peri's real spacing — round-5 CR-3 shape): a prepend below it still compensates", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 40, "end", 12));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await scrollColumnTo(scene, column, 0);

    const row0Before = getByTestId("row-0").element() as HTMLElement;
    const row0RectBefore = row0Before.getBoundingClientRect();

    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildAffordancePipeline([...prependedIds, ...existingIds], 40, "end", 12));

    expect(column.getAttribute("data-scroll-offset")).toBe("1400");
    const row0After = getByTestId("row-0").element() as HTMLElement;
    expect(row0After).toBe(row0Before);
    expect(row0After.getBoundingClientRect().top).toBeCloseTo(row0RectBefore.top, 0);
  });

  test("a LARGE gap (200px, first row still in view): still compensates — the window reaches past arbitrary gap sizes, not just a typical 12px", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 40, "end", 200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await scrollColumnTo(scene, column, 0);

    const row0Before = getByTestId("row-0").element() as HTMLElement;
    const row0RectBefore = row0Before.getBoundingClientRect();

    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildAffordancePipeline([...prependedIds, ...existingIds], 40, "end", 200));

    expect(column.getAttribute("data-scroll-offset")).toBe("1400");
    const row0After = getByTestId("row-0").element() as HTMLElement;
    expect(row0After).toBe(row0Before);
    expect(row0After.getBoundingClientRect().top).toBeCloseTo(row0RectBefore.top, 0);
  });
});

// ---------------------------------------------------------------------------
// F9 commit 2: anchor="end" follow-the-end pin state machine
// ---------------------------------------------------------------------------

describe("Scene follow-the-end pin (anchor=\"end\", F9 commit 2)", () => {
  test("mounts pinned at maxScroll (opens at the newest content)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // maxScroll = 1200 - 800 = 400.
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-400);
  });

  test("new content while pinned keeps the offset at maxScroll — same-frame, no animation", async () => {
    const recorder = createMotionSeamRecorder();
    const build = (contentHeight: number) => (
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col" anchor="end">
              <SceneObject name="panel" focused>
                <div data-testid="content" style={{ width: 400, height: contentHeight }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    await wait(1000); // let the mount-pinned spring (real mode) settle
    expect(parseFloat(contentWrapper.style.top || "0")).toBeCloseTo(-400, 0);

    const controlsBefore = recorder.controls.get(`scrollY:col`);

    // Grow content — new maxScroll = 1600 - 800 = 800.
    await rerender(build(1600));

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-800);
    // No new animate() call — jump, not spring.
    expect(recorder.controls.get(`scrollY:col`)).toBe(controlsBefore);
  });

  test("a user upward scroll releases the pin — subsequent content arrivals no longer force the offset", async () => {
    const build = (contentHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: contentHeight }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-400); // pinned at mount

    // Scroll UP (away from the end) — deltaY negative.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-100);

    // New content arrives — must NOT force the offset back to the (new) end.
    await rerender(build(1600));

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-100);
  });

  test("scrolling back within the threshold of maxScroll re-engages the pin", async () => {
    const build = (contentHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: contentHeight }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Release the pin.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-100);

    // Scroll back to exactly maxScroll (well within the 2px threshold).
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-400);

    // Re-pinned — new content should now force the offset again.
    await rerender(build(1600));

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-800);
  });

  test("swapping to a different object within the column re-pins (composes with A2)", async () => {
    // Uses data-scroll-offset (not contentWrapper.style.top) for the swap
    // assertions — established precedent from the pre-existing "Scene
    // swap-reset scroll model" tests: style.top = combinedTop =
    // -(topOffset + scrollOffset), and topOffset (a SEPARATE mechanism
    // that shifts a single newly-focused object into view) can transiently
    // still reflect the pre-swap in-flow layout for one commit before the
    // no-longer-focused sibling finishes exiting flow — a real timing
    // interaction unrelated to anchor="end", probe-confirmed while
    // debugging this exact test (style.top read -2000 — topOffset(1200,
    // stale) + scrollOffset(800, already correct) — while
    // data-scroll-offset already correctly read "800" in the same
    // instant). data-scroll-offset isolates the value this test actually
    // cares about.
    const build = (aFocused: boolean, bHeight = 1600) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end">
            <SceneObject name="a" focused={aFocused}>
              <div data-testid="content-a" style={{ width: 400, height: 1200 }} />
            </SceneObject>
            <SceneObject name="b" focused={!aFocused}>
              <div data-testid="content-b" style={{ width: 400, height: bHeight }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(true));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    expect(column.getAttribute("data-scroll-offset")).toBe("400"); // pinned to a's maxScroll (1200-800)

    // Release the pin on "a".
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("100");

    // Swap focus to "b" — a real swap, not a park/return with the same
    // arrangement (which would restore, not re-pin — see the A2 extension's
    // own comment).
    await rerender(build(false));

    // Re-pinned to b's maxScroll (1600-800=800).
    expect(column.getAttribute("data-scroll-offset")).toBe("800");

    // Confirm the re-pin genuinely holds: new content arriving still forces
    // the offset (proves this isn't a coincidental one-time value match).
    await rerender(build(false, 2000));
    expect(column.getAttribute("data-scroll-offset")).toBe("1200");
  });

  test("a maxScroll shrink (viewport/content-driven, not user intent) never re-pins a released column, even when the clamp lands exactly at the new maxScroll", async () => {
    const build = (contentHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: contentHeight }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Release the pin, scrolled well short of the end.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-100);

    // Shrink content so the new maxScroll clamps the offset to EXACTLY the
    // new maxScroll (100) — a value that would trivially satisfy
    // isAtScrollEnd if it were (wrongly) evaluated here.
    await rerender(build(900)); // new maxScroll = 900-800=100, offset clamps 100->100

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-100);

    // Prove the pin genuinely did NOT re-engage: further content growth
    // must NOT force the offset (it would, if pinnedRef were wrongly true).
    await rerender(build(1300)); // new maxScroll = 500, would force -500 if pinned
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-100);
  });
});

// ---------------------------------------------------------------------------
// F9 commit 3: onScroll + SceneScrollMetrics
// ---------------------------------------------------------------------------

describe("Scene onScroll metrics (F9 commit 3)", () => {
  test("fires with correct metrics on a user wheel scroll", async () => {
    const calls: SceneScrollMetrics[] = [];
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" onScroll={(m) => calls.push(m)}>
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => calls.at(-1)?.offset).toBe(300);

    const latest = calls.at(-1)!;
    expect(latest.offset).toBe(300);
    expect(latest.maxScroll).toBe(400); // 1200-800
    expect(latest.contentHeight).toBe(1200);
    expect(latest.viewportHeight).toBe(800);
    expect(latest.anchored).toBe("none"); // anchor="none" (default)
  });

  test("fires for content-driven anchoring-compensation changes too (F9 commit 1) — a natural consequence of subscribing to the single underlying scroll value", async () => {
    const calls: SceneScrollMetrics[] = [];
    const build = (topHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" onScroll={(m) => calls.push(m)}>
            <SceneObject name="top" focused>
              <div data-testid="top-content" style={{ width: 400, height: topHeight }} />
            </SceneObject>
            <SceneObject name="bottom" focused>
              <div data-testid="bottom-content" style={{ width: 400, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(300));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => calls.at(-1)?.offset).toBe(400);

    calls.length = 0;
    await rerender(build(500)); // +200 above the anchor -> compensation fires

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)!.offset).toBe(600);
  });

  test("fires for pin-follow changes too (F9 commit 2), with anchored transitioning correctly across pin/release", async () => {
    const calls: SceneScrollMetrics[] = [];
    const build = (contentHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end" onScroll={(m) => calls.push(m)}>
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: contentHeight }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    await expect.poll(() => calls.at(-1)?.offset).toBe(400); // pinned at mount
    expect(calls.at(-1)!.anchored).toBe("end");

    calls.length = 0;
    await rerender(build(1600)); // grow while pinned -> pin-follow fires

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)!.offset).toBe(800);
    expect(calls.at(-1)!.anchored).toBe("end");

    // Release the pin.
    calls.length = 0;
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-500);

    expect(calls.at(-1)!.anchored).toBe("none");
  });

  test("anchored reads \"none\" for an anchor=\"none\" column even while scrolled to maxScroll (never confused with the pin)", async () => {
    const calls: SceneScrollMetrics[] = [];
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" onScroll={(m) => calls.push(m)}>
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Scroll all the way to maxScroll (400) — numerically identical to a
    // pinned anchor="end" column's resting offset, but this column was
    // never configured with anchor="end".
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => calls.at(-1)?.offset).toBe(400);

    expect(calls.at(-1)!.anchored).toBe("none");
  });

  test("fires multiple times during a single real-mode spring transition — per-tick cadence, not gated to one React commit", async () => {
    const calls: SceneScrollMetrics[] = [];
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col" onScroll={(m) => calls.push(m)}>
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(1000); // let the real spring fully settle

    // A real spring interpolates over many frames — if onScroll only fired
    // once per REACT COMMIT (rather than per raw scrollY tick, matching
    // data-scroll-offset's own cadence), this would be a small, fixed
    // number regardless of the transition's real duration.
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.at(-1)!.offset).toBeCloseTo(300, 0);
  });
});
