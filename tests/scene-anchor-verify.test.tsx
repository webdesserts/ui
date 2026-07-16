/**
 * F14 fix: store-time verification in findDeepestIntraObjectAnchor's
 * "gave up" termination path (src/components/scene/inputController.ts).
 *
 * Background (the on-device mid-drag teleport investigation): F10b's
 * recursive descent selects a level-1 candidate (a row/section element),
 * then tries to descend into ITS OWN children for a deeper, more precise
 * anchor. When that deeper scan finds nothing intersecting the current
 * scroll window, the descent "gives up" and trusts the level-1 candidate's
 * measurement as-is — with NO check that the measurement was even still
 * accurate. A stub-forced reselection probe proved this precisely: forcing
 * the level-1 scan to pick a candidate whose TRUE position is far enough
 * away that its own children could never intersect the current window
 * produces an exact, unclamped, section-distance-sized jump on the VERY
 * NEXT settle — while forcing a NEARBY candidate (close enough that its
 * children genuinely do intersect) self-corrects, because the descent
 * reaches a truthfully-measured leaf instead of stopping shallow.
 *
 * The fix: on a "gave up" termination (the selected candidate HAS element
 * children, but none of them intersected — as opposed to a genuine leaf,
 * which has none to begin with), re-read the candidate's rect one more
 * time and compare against what the level-1 scan recorded. Agreeing
 * within a small tolerance means the shallow measurement was genuinely
 * trustworthy (a real case where a wrapper's own interior legitimately has
 * nothing in view right now — e.g. a large top padding before its real
 * content — but the wrapper itself IS the correct anchor); disagreeing
 * means the selection was never trustworthy, and the function returns
 * `null` instead of the fiction — the existing carry-forward machinery
 * already self-heals a `null` result on the next settle by design.
 *
 * This file's stub (a scoped Element.prototype.getBoundingClientRect
 * monkey-patch) exists ONLY here, in this test — never in src. It forces
 * exactly the reselection flip the probe used to prove the mechanism, so
 * the fix's discarding behavior can be pinned deterministically.
 *
 * A prepend rebuild in this file always concatenates into ONE array
 * before mapping ([...prependedIds, ...existingIds].map(...)) — the
 * established convention throughout the F9/F10/F12 suites in
 * scene.test.tsx. Two SEPARATE .map() calls stitched together as JSX
 * siblings changes the number of child-array slots at that position
 * between renders; React's reconciler then treats the whole thing as a
 * new positional slot and remounts every row, destroying the very
 * element identity these tests need to track through a settle.
 */

import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneColumn, SceneObject } from "../src";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame } from "./utils/animation";

// ---------------------------------------------------------------------------
// Fixture: a single focused SceneObject containing rows keyed by id, each
// with an <h4> + <p> child pair — the SAME two-level shape (SceneObject's
// inert wrapper -> the consumer's own div -> rows -> each row's own
// [h4, p]) the on-device VerticalScrollDemo has, and that the stub probe's
// own boundary-exact characterization was built against. Fixed pixel
// heights throughout (no intrinsic text sizing) so every offset in this
// file is exactly predictable.
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 100;
const H4_HEIGHT = 30;
const P_HEIGHT = 70; // H4_HEIGHT + P_HEIGHT === ROW_HEIGHT, no gaps between rows

function buildRows(ids: number[], viewportHeight = 300) {
  return (
    <TestWrapper fullPage height={viewportHeight}>
      <Scene duration={0}>
        <SceneColumn name="col">
          <SceneObject name="rows" focused>
            <div style={{ width: 400 }}>
              {ids.map((id) => (
                <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  <h4 data-testid={`h4-${id}`} style={{ height: H4_HEIGHT, margin: 0 }}>
                    Row {id}
                  </h4>
                  <p data-testid={`p-${id}`} style={{ height: P_HEIGHT, margin: 0 }}>
                    content {id}
                  </p>
                </div>
              ))}
            </div>
          </SceneObject>
        </SceneColumn>
      </Scene>
    </TestWrapper>
  );
}

/** Drives the column to an exact offset via wheel scroll — same technique
 * (and same duration={0}-lands-same-tick guarantee) as this repo's
 * existing F9/F10/F12 tests. */
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

/** Forces exactly ONE genuine ResizeObserver firing on [data-column] (the
 * SAME observed element SceneColumn's shared ResizeObserver watches) via a
 * real, tiny size change — not a synthetic stand-in. `grow` toggles which
 * direction (the corresponding `shrinkColumnBack` call reverts it). Two
 * single-direction triggers, called around a stub activate/deactivate
 * boundary, cleanly separate "the stubbed reselection settle" from "the
 * next, fully truthful settle" into two distinct remeasure calls — as
 * opposed to one round-trip toggle, which fires the ResizeObserver
 * callback TWICE internally and blurs that boundary. Waits enough
 * animation frames for the async callback to actually run (matches the
 * proven probe script's own margin). */
async function growColumnPadding(col: HTMLElement) {
  col.style.paddingBottom = "1px";
  await waitForAnimationFrame();
  await waitForAnimationFrame();
}
async function shrinkColumnBack(col: HTMLElement) {
  col.style.paddingBottom = "";
  await waitForAnimationFrame();
  await waitForAnimationFrame();
}

/**
 * Installs the level-1 reselection-flip stub (proven in the standalone
 * teleport-probe-gbcr-stub-v3.mjs script this test converts). Suppresses
 * every candidate from `currentEl` through the element just before
 * `targetEl` (not `currentEl` alone) — the level-1 scan picks the FIRST
 * DOM-order-intersecting candidate, so an intermediate row between current
 * and target would win the selection on its own before ever reaching the
 * injected target (the exact targeting bug the v1/v2 probe iterations
 * hit). `targetEl` is injected at `currentEl`'s TRUE top on the FIRST
 * call only (the level-1 scan that decides the winner) and reports its
 * real position on every subsequent call (the fix's own re-verification
 * re-read) — modeling a same-pass-but-not-sustained measurement
 * discrepancy.
 */
function installReselectionStub(currentEl: Element, suppressBetween: Element[], targetEl: Element) {
  const origGBCR = Element.prototype.getBoundingClientRect;
  const suppressed = new Set<Element>([currentEl, ...suppressBetween]);
  let active = false;
  let targetCallCount = 0;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const real = origGBCR.call(this);
    if (!active) return real;
    if (suppressed.has(this)) {
      return new DOMRect(real.x, 99999, real.width, real.height);
    }
    if (this === targetEl) {
      targetCallCount++;
      if (targetCallCount === 1) {
        const currentTop = origGBCR.call(currentEl);
        return new DOMRect(real.x, currentTop.top, real.width, real.height);
      }
      return real;
    }
    return real;
  };
  return {
    activate() {
      active = true;
      targetCallCount = 0;
    },
    deactivate() {
      active = false;
    },
    restore() {
      Element.prototype.getBoundingClientRect = origGBCR;
    },
  };
}

describe("Scene F14 anchor store-time verification — reselection-flip regression pin", () => {
  test("a level-1 reselection flip landing outside the current window is discarded, not stored as fact — no jump, self-heals", async () => {
    const rowCount = 10;
    const ids = Array.from({ length: rowCount }, (_, i) => i);
    const { getByTestId } = await render(buildRows(ids));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // window [250, 550) — row 2 ([200,300)) is the topmost intersecting
    // level-1 candidate; ITS OWN children (h4 [200,230), p [230,300))
    // narrow to p intersecting [250,550) (h4 doesn't: 230 < windowStart),
    // so the descent correctly reaches p as a genuine leaf on a normal,
    // unstubbed settle — this establishes REAL tracking to flip away from.
    await scrollColumnTo(scene, column, 250);
    const currentRow = getByTestId("row-2").element() as HTMLElement;
    const betweenRows = [3, 4, 5].map((i) => getByTestId(`row-${i}`).element() as HTMLElement); // must ALSO be suppressed — the level-1 scan picks the first DOM-order-intersecting candidate, and these sit between current and target in DOM order
    const targetRow = getByTestId("row-6").element() as HTMLElement; // offsetTop 600 — its own [600,700) range is entirely past windowEnd (550), so its children can NEVER intersect this window
    const trueOffsetDelta = 600 - 200; // = 400, matches the stub probe's own "true distance" framing

    const stub = installReselectionStub(currentRow, betweenRows, targetRow);

    try {
      // Pass 1: the stubbed reselection settle. `intraBefore` for THIS
      // call's own compensation was captured before the stub ever
      // activated (row 2's own p, truthfully unaffected by it), so this
      // pass's OWN correction stays zero regardless of fix state — only
      // the FRESH re-selection stored at the end of this call (for the
      // NEXT settle to use) is affected by the stub.
      stub.activate();
      await growColumnPadding(column);

      expect(column.getAttribute("data-scroll-offset")).toBe("250");
      expect(parseFloat(contentWrapper.style.top || "0")).toBeCloseTo(-250, 5);

      // Pass 2: fully truthful (stub deactivated first) — this settle's
      // `intraBefore` is whatever pass 1 stored. With the fix, pass 1's
      // reselection was DISCARDED (re-verification disagreed by
      // trueOffsetDelta, far past tolerance) rather than stored, so this
      // pass has nothing bad to carry forward: no jump, and a fresh,
      // truthful reselection is stored for next time.
      stub.deactivate();
      await shrinkColumnBack(column);

      expect(column.getAttribute("data-scroll-offset")).toBe("250");
      expect(parseFloat(contentWrapper.style.top || "0")).toBeCloseTo(-250, 5);
    } finally {
      stub.restore();
    }

    // Document, for the record, what the pre-fix mechanism produced here —
    // sanity-checks this fixture's own numbers against the stub probe's
    // proven signature shape (a clean, exact distance).
    expect(trueOffsetDelta).toBe(400);
  });

  test("self-heals: a prepend AFTER the discarded flip still compensates correctly via a fresh, truthful reselection", async () => {
    const rowCount = 10;
    const existingIds = Array.from({ length: rowCount }, (_, i) => i);
    const { getByTestId, rerender } = await render(buildRows(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    await scrollColumnTo(scene, column, 250);
    const currentRow = getByTestId("row-2").element() as HTMLElement;
    const betweenRows = [3, 4, 5].map((i) => getByTestId(`row-${i}`).element() as HTMLElement);
    const targetRow = getByTestId("row-6").element() as HTMLElement;

    const stub = installReselectionStub(currentRow, betweenRows, targetRow);

    try {
      stub.activate();
      await growColumnPadding(column);
      stub.deactivate();
      // A second, fully truthful pass lets tracking self-heal (the fix
      // discarded pass 1's fiction, so this pass starts from
      // lastSettledIntraAnchorRef.current === null and freshly re-selects
      // whatever is genuinely topmost-in-view — row 2's own p, unchanged
      // since nothing about the DOM actually moved).
      await shrinkColumnBack(column);
    } finally {
      stub.restore();
    }

    expect(column.getAttribute("data-scroll-offset")).toBe("250");

    // A real prepend now, via a SINGLE combined array (established
    // convention — see this file's header comment) — the self-healed
    // tracking must still compensate by exactly the prepended height,
    // same as any other F9/F10 prepend test in this suite.
    const prependedIds = Array.from({ length: 3 }, (_, i) => -3 + i);
    await rerender(buildRows([...prependedIds, ...existingIds]));

    expect(column.getAttribute("data-scroll-offset")).toBe(String(250 + prependedIds.length * ROW_HEIGHT));
  });
});

describe("Scene F14 anchor store-time verification — legitimate padding-gap case (must NOT be discarded)", () => {
  // F12b's gap lesson one level deeper: a row whose OWN interior has a
  // large top padding before its real content, such that — at a real,
  // unstubbed scroll position — the row genuinely wins level-1 selection
  // while its OWN children genuinely don't intersect the window (the
  // "gave up" case triggers NATURALLY here, no stub involved at all). The
  // fix's re-verification re-reads the SAME row, gets the SAME truthful
  // answer both times, agrees, and must trust it exactly as before.
  const PADDED_ROW_HEIGHT = 350; // 250px top padding + 30px h4 + 70px p
  const PAD_TOP = 250;

  function buildPaddedRows(ids: number[]) {
    return (
      <TestWrapper fullPage height={150}>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="rows" focused>
              <div style={{ width: 400 }}>
                {ids.map((id) => (
                  <div
                    key={id}
                    data-testid={`prow-${id}`}
                    style={{ width: 400, height: PADDED_ROW_HEIGHT, paddingTop: PAD_TOP }}
                  >
                    <h4 style={{ height: H4_HEIGHT, margin: 0 }}>Row {id}</h4>
                    <p style={{ height: P_HEIGHT, margin: 0 }}>content {id}</p>
                  </div>
                ))}
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  test("a row tracked via its own padding gap (children legitimately out of view) still stores — a following prepend compensates by the full prepended height", async () => {
    const rowCount = 4;
    const existingIds = Array.from({ length: rowCount }, (_, i) => i);
    const { getByTestId, rerender } = await render(buildPaddedRows(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    // Row 1 spans [350, 700). window [400, 550) intersects the row itself
    // (350 < 550 && 700 > 400) but neither its h4 [600,630) nor its p
    // [630,700) — both start at or past windowEnd (550) — a genuine,
    // unstubbed "gave up" termination at the row level.
    await scrollColumnTo(scene, column, 400);

    const prependedIds = Array.from({ length: 2 }, (_, i) => -2 + i);
    await rerender(buildPaddedRows([...prependedIds, ...existingIds]));

    // Must compensate by exactly the prepended height (2 * 350 = 700) — if
    // the "gave up" termination were wrongly discarded here, this would
    // stay at 400 instead (native hold-the-top, the pre-F10 blindness).
    expect(column.getAttribute("data-scroll-offset")).toBe(
      String(400 + prependedIds.length * PADDED_ROW_HEIGHT),
    );
  });
});
