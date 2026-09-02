/**
 * ui/t:32 fix: `useColumnAnchoring.ts`'s per-render synchronous remeasure
 * effect (the "measure the content wrapper synchronously after each
 * render" useLayoutEffect) used to call `remeasureGeometryWithAnchorCompensation()`
 * unconditionally before checking `columnFocused` — so an UNFOCUSED column's
 * own remeasurement work still ran on every Scene-level re-render, even one
 * entirely unrelated to that column (a sibling's content changing, or any
 * other cause reaching this column's own render). ui/o:91's "per-frame work
 * touching every column regardless of focus" class.
 *
 * The gate is NOT a blanket `!columnFocused` skip — a first attempt at
 * exactly that broke tests/scene-glass-stack-deck.test.tsx's own resize-
 * tracking test (see the ui/t:32 worker report for the isolation evidence):
 * a decked (in-between) column's own columnWidthMV/computeMeasuredWidth
 * channel reads live geometryStore data regardless of focus (the column's
 * natural width doesn't depend on focus), so starving that channel left it
 * stuck at its mount-time value. The real gate is `!columnFocused &&
 * !inBetweenNow` — this file pins BOTH halves: an "outer" unfocused column
 * (genuinely uninvolved) skips remeasurement, an in-between (decked) one
 * still gets it despite being unfocused.
 *
 * This file pins the gate the same way ui/t:28's own descent gate does
 * (tests/scene-anchor-descent-gate.test.tsx — same probe-lag8 methodology):
 * counting Element.prototype.getBoundingClientRect calls made specifically
 * on the target column's own elements while an unrelated sibling change
 * forces a Scene-level re-render. The target column is given REGISTERED_
 * OBJECT_COUNT registered SceneObjects so a remeasurement that ran (walking
 * remeasureGeometry's own per-registered-object loop) produces a call count
 * that scales with that number and clears RAN_THRESHOLD by a wide margin.
 *
 * ResizeObserver is stubbed out for the duration of each test (found the
 * hard way — see the ui/t:32 worker report): SceneObject's OWN per-render
 * registration effect unregisters+re-registers on EVERY render (unconditional
 * by design, a SEPARATE, pre-existing mechanism), which churns the shared
 * ResizeObserver's observe/unobserve calls and independently re-fires the
 * RO callback's OWN unconditional remeasureGeometryWithAnchorCompensation()
 * call — ui/t:32's Cluster 2 (resizeobserver-dedup), not yet fixed, not this
 * commit's scope. Left unstubbed, that separate call site's own ~26 calls
 * (1 wrapper + REGISTERED_OBJECT_COUNT objects) swamp this gate's own
 * signal on every "unrelated sibling re-render" scenario, since any Scene-
 * level re-render triggers SceneObject's registration churn regardless of
 * this fix. Stubbing RO isolates this test to the per-render effect this
 * commit actually gates.
 */
import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneColumn, SceneObject } from "../src";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame } from "./utils/animation";

const REGISTERED_OBJECT_COUNT = 25;
// A remeasurement that ran makes 1 (wrapper) + REGISTERED_OBJECT_COUNT
// calls, well above this; unrelated incidental calls (camera-recentering's
// DOM-measurement fallback, etc.) stay in the single digits.
const RAN_THRESHOLD = 15;

// Built ONCE and reused across every buildScene() call below — a fresh
// (even if value-identical) element on every render would ALSO trigger
// SceneObject's own registration churn regardless of the RO stub, since
// deriveObjectStates/deriveColumnFocused re-walk `children` fresh every
// SceneColumn render either way. Stable references keep the object count
// (and therefore this test's signal) exactly REGISTERED_OBJECT_COUNT.
const stableUnfocusedObjects = Array.from({ length: REGISTERED_OBJECT_COUNT }, (_, i) => (
  <SceneObject key={i} name={`unfocused-obj-${i}`} focused={false}>
    <div style={{ width: 300, height: 20 }}>unfocused content {i}</div>
  </SceneObject>
));
const stableFocusSwappedObjects = Array.from({ length: REGISTERED_OBJECT_COUNT }, (_, i) => (
  <SceneObject key={i} name={`unfocused-obj-${i}`} focused>
    <div style={{ width: 300, height: 20 }}>unfocused content {i}</div>
  </SceneObject>
));

function buildScene(focusedRowCount: number, swapFocusOntoSecondColumn = false) {
  return (
    <TestWrapper fullPage height={300}>
      <Scene duration={0}>
        <SceneColumn name="focused-col">
          <SceneObject name="focused-obj" focused={!swapFocusOntoSecondColumn}>
            <div style={{ width: 300 }}>
              {Array.from({ length: focusedRowCount }, (_, i) => (
                <div key={i} style={{ width: 300, height: 40 }}>
                  focused row {i}
                </div>
              ))}
            </div>
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="unfocused-col">
          {swapFocusOntoSecondColumn ? stableFocusSwappedObjects : stableUnfocusedObjects}
        </SceneColumn>
      </Scene>
    </TestWrapper>
  );
}

/** Counts Element.prototype.getBoundingClientRect calls made ON elements
 * within `scopeEl`'s subtree while `fn` runs and its effects settle. */
async function countGBCRWithin(scopeEl: Element, fn: () => Promise<void>): Promise<number> {
  let count = 0;
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (scopeEl.contains(this) || scopeEl === this) count++;
    return orig.call(this);
  };
  try {
    await fn();
  } finally {
    Element.prototype.getBoundingClientRect = orig;
  }
  return count;
}

/** Runs `fn` with `window.ResizeObserver` stubbed to a no-op — see this
 * file's own header comment for why (isolates this gate from ui/t:32's
 * separate, not-yet-fixed Cluster 2 RO-churn call site). Must be installed
 * BEFORE the component mounts: each SceneColumn instance captures the
 * constructor once, at `new ResizeObserver(...)` time. */
async function withNoopResizeObserver(fn: () => Promise<void>): Promise<void> {
  const OrigRO = window.ResizeObserver;
  class NoopRO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopRO;
  try {
    await fn();
  } finally {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = OrigRO;
  }
}

describe("Scene per-render remeasure focus gate (ui#32)", () => {
  test("an unfocused column's own elements are not remeasured when an unrelated sibling change forces a Scene-level re-render", async () => {
    await withNoopResizeObserver(async () => {
      const { getByTestId, rerender } = await render(buildScene(10));
      const scene = getByTestId("scene").element() as HTMLElement;
      const unfocusedColumn = scene.querySelector(
        "[data-ui-scene-column-anchor='unfocused-col']",
      ) as HTMLElement;
      expect(unfocusedColumn).toBeTruthy();
      await waitForAnimationFrame();

      // Append a row to the FOCUSED column's own content — a genuine
      // content change, but entirely unrelated to the unfocused column.
      // This forces Scene (and, empirically, every SceneColumn instance
      // including unfocused ones — memo alone doesn't fully bail here, see
      // the ui/t:32 worker report) to reconcile.
      const gbcrCount = await countGBCRWithin(unfocusedColumn, async () => {
        await rerender(buildScene(11));
        await waitForAnimationFrame();
      });

      expect(gbcrCount).toBeLessThan(RAN_THRESHOLD);
    });
  });

  test("a column DOES get remeasured once it becomes the focused one (sanity check — the gate isn't a blanket skip)", async () => {
    await withNoopResizeObserver(async () => {
      const { getByTestId, rerender } = await render(buildScene(10));
      const scene = getByTestId("scene").element() as HTMLElement;
      const unfocusedColumn = scene.querySelector(
        "[data-ui-scene-column-anchor='unfocused-col']",
      ) as HTMLElement;
      await waitForAnimationFrame();

      // Swap focus onto the previously-unfocused column — its own
      // remeasure effect must now run (columnFocused flips true for it).
      const gbcrCount = await countGBCRWithin(unfocusedColumn, async () => {
        await rerender(buildScene(10, true));
        await waitForAnimationFrame();
      });

      expect(gbcrCount).toBeGreaterThan(RAN_THRESHOLD);
    });
  });

  test("a decked (in-between) column's own elements ARE remeasured when an unrelated sibling change forces a Scene-level re-render", async () => {
    // Three columns — left and right focused, middle sandwiched between
    // them (position: "in-between", stackDepth > 0) — the specific shape
    // inBetweenNow requires, distinct from the two-column "outer" fixture
    // above (a lone unfocused column at the edge is never in-between).
    const deckedObjects = Array.from({ length: REGISTERED_OBJECT_COUNT }, (_, i) => (
      <SceneObject key={i} name={`decked-obj-${i}`} focused={false}>
        <div style={{ width: 200, height: 20 }}>decked content {i}</div>
      </SceneObject>
    ));

    function buildDeckedScene(rightRowCount: number) {
      return (
        <TestWrapper fullPage height={300}>
          <Scene duration={0}>
            <SceneColumn name="left-col">
              <SceneObject name="left-obj" focused>
                <div style={{ width: 300, height: 200 }}>left</div>
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="decked-col">{deckedObjects}</SceneColumn>
            <SceneColumn name="right-col">
              <SceneObject name="right-obj" focused>
                <div style={{ width: 300 }}>
                  {Array.from({ length: rightRowCount }, (_, i) => (
                    <div key={i} style={{ width: 300, height: 40 }}>
                      right row {i}
                    </div>
                  ))}
                </div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    await withNoopResizeObserver(async () => {
      const { getByTestId, rerender } = await render(buildDeckedScene(10));
      const scene = getByTestId("scene").element() as HTMLElement;
      const deckedColumn = scene.querySelector(
        "[data-ui-scene-column-anchor='decked-col']",
      ) as HTMLElement;
      expect(deckedColumn).toBeTruthy();
      await waitForAnimationFrame();
      expect(deckedColumn.getAttribute("data-ui-scene-column-position")).toBe("in-between");

      // Append a row to the RIGHT column's own content — unrelated to the
      // decked column specifically, but a genuine Scene-level re-render.
      const gbcrCount = await countGBCRWithin(deckedColumn, async () => {
        await rerender(buildDeckedScene(11));
        await waitForAnimationFrame();
      });

      expect(gbcrCount).toBeGreaterThan(RAN_THRESHOLD);
    });
  });
});
