/**
 * ui/t:28 fix: the F10b intra-object anchor descent (findDeepestIntraObjectAnchor,
 * walking every row inside the focused anchor object — O(rows) per call, see
 * inputController.ts's own doc comments) used to re-run unconditionally on
 * EVERY commit of SceneColumn's no-deps per-render layout effect, including
 * commits whose only delta was scroll offset (hunt-lag round 2a, ui/o:87: 48
 * getComputedStyle + 48 getBoundingClientRect per row per 12-event wheel
 * gesture on an anchor="end" column).
 *
 * This file pins the gate by counting getBoundingClientRect calls (probe-
 * lag8's own methodology, scoped down to a single before/after comparison
 * rather than its full sever matrix — the ship report carries the full
 * probe-lag8/9 measurement for the DOM-read criterion). A DESCENT that ran
 * would touch every one of the object's rows once per level (one call per
 * row, minimum); a SKIPPED descent leaves only the small, row-count-
 * independent handful of calls remeasureGeometry's own per-registered-
 * object loop makes.
 */
import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneColumn, SceneObject } from "../src";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame } from "./utils/animation";

const ROW_HEIGHT = 70;
const ROW_COUNT = 200;
// Well below ROW_COUNT — a descent that actually walked the rows blows past
// this; a skipped descent (remeasureGeometry's own O(registered objects)
// loop only, one registered object here) stays far under it.
const DESCENT_RAN_THRESHOLD = 50;

function buildRows(ids: number[]) {
  return (
    <TestWrapper fullPage height={300}>
      <Scene duration={0}>
        <SceneColumn name="col" anchor="end">
          <SceneObject name="rows" focused>
            <div style={{ width: 400 }}>
              {ids.map((id) => (
                <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </div>
          </SceneObject>
        </SceneColumn>
      </Scene>
    </TestWrapper>
  );
}

/** Instant (duration=0) single-jump scroll — lands same-tick, no spring
 * settle frames to disambiguate from — matching this repo's own established
 * scroll-driving convention for anchoring tests. */
async function scrollColumnTo(scene: HTMLElement, column: HTMLElement, targetOffset: number) {
  const currentOffset = Number(column.getAttribute("data-ui-scene-scroll-offset") ?? "0");
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
  await expect.poll(() => column.getAttribute("data-ui-scene-scroll-offset")).toBe(String(targetOffset));
}

/** Counts Element.prototype.getBoundingClientRect calls made while `fn`
 * runs and its effects settle. */
async function countGBCR(fn: () => Promise<void>): Promise<number> {
  let count = 0;
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    count++;
    return orig.call(this);
  };
  try {
    await fn();
  } finally {
    Element.prototype.getBoundingClientRect = orig;
  }
  return count;
}

describe("Scene F10b anchor descent gate (ui#28)", () => {
  test("a small scroll that keeps the tracked candidate in view does not re-run the descent", async () => {
    const ids = Array.from({ length: ROW_COUNT }, (_, i) => i);
    const { getByTestId } = await render(buildRows(ids));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-ui-scene-column-anchor]") as HTMLElement;
    await waitForAnimationFrame();

    const maxScroll = Number(column.getAttribute("data-ui-scene-max-scroll") ?? "0");
    expect(maxScroll).toBeGreaterThan(0);

    // A single small scroll (one row's worth) — the tracked candidate
    // (selected at mount, near maxScroll) stays inside the viewport window
    // the whole way, so the gate should skip re-running the descent.
    const gbcrCount = await countGBCR(async () => {
      await scrollColumnTo(scene, column, maxScroll - ROW_HEIGHT);
      await waitForAnimationFrame();
    });

    expect(gbcrCount).toBeLessThan(DESCENT_RAN_THRESHOLD);
  });

  test("a large scroll that moves the tracked candidate out of view DOES re-run the descent", async () => {
    const ids = Array.from({ length: ROW_COUNT }, (_, i) => i);
    const { getByTestId } = await render(buildRows(ids));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-ui-scene-column-anchor]") as HTMLElement;
    await waitForAnimationFrame();

    // A large jump (from the end all the way to the top) — the candidate
    // tracked from mount (near maxScroll) is nowhere near this new window,
    // so the gate must re-run the descent to establish a fresh one.
    const gbcrCount = await countGBCR(async () => {
      await scrollColumnTo(scene, column, 0);
      await waitForAnimationFrame();
    });

    expect(gbcrCount).toBeGreaterThan(DESCENT_RAN_THRESHOLD);
  });

  test("a genuine content change (row append) re-runs the descent even though the tracked candidate is still in view", async () => {
    const ids = Array.from({ length: ROW_COUNT }, (_, i) => i);
    const { getByTestId, rerender } = await render(buildRows(ids));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-ui-scene-column-anchor]") as HTMLElement;
    await waitForAnimationFrame();

    // Append rows at the end (anchor="end" tracks the live edge — the
    // object's own geometry changes, which must always force a fresh
    // descent regardless of the in-window check, since `changed` is true).
    const appendedIds = [...ids, ...Array.from({ length: 5 }, (_, i) => ROW_COUNT + i)];
    const gbcrCount = await countGBCR(async () => {
      await rerender(buildRows(appendedIds));
      await waitForAnimationFrame();
    });

    expect(gbcrCount).toBeGreaterThan(DESCENT_RAN_THRESHOLD);
  });
});
