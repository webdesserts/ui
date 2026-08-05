import { describe, test, expect } from "vitest";
import { StrictMode, useLayoutEffect, useState } from "react";
import { render, cleanup } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame, wait, awaitStyleFlush } from "./utils/animation";
import { parseTranslateX } from "./utils/transform";
import { buildScene } from "./utils/sceneFixtures";

// ---------------------------------------------------------------------------
// Phase 2: Vertical swap within a column
// ---------------------------------------------------------------------------

describe("SceneColumn vertical swap", () => {
  test("vertical swap — focus moves from first to second object", async () => {
    // Start with first object focused, then swap to second.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const objA = getByTestId("content-a").element().closest("[data-ui-scene-id]") as HTMLElement;
    const objB = getByTestId("content-b").element().closest("[data-ui-scene-id]") as HTMLElement;

    expect(objA.getAttribute("data-ui-scene-focused")).toBe("true");
    expect(objB.getAttribute("data-ui-scene-focused")).toBe("false");

    // Swap focus to B
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    expect(objA.getAttribute("data-ui-scene-focused")).toBe("false");
    expect(objB.getAttribute("data-ui-scene-focused")).toBe("true");
  });

  test("after swap, only the newly focused object is in flow", async () => {
    // After a vertical swap, the focused object should have position: relative
    // and the unfocused object should have position: absolute (out of flow).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const objA = getByTestId("content-a").element().closest("[data-ui-scene-id]") as HTMLElement;
    const objB = getByTestId("content-b").element().closest("[data-ui-scene-id]") as HTMLElement;

    // Focused object is in flow
    expect(window.getComputedStyle(objB).position).toBe("relative");
    // Unfocused sibling stays in flow (visible in the scene, just inert)
    expect(window.getComputedStyle(objA).position).toBe("relative");
  });

  test("swap direction follows DOM order — ascending: second object appears below", async () => {
    // Object B is below object A in DOM order. When B gains focus, the column
    // content slides up (negative top offset) to show B.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const contentWrapper = getByTestId("content-a").element().closest("[data-ui-scene-column-anchor]")
      ?.querySelector("[data-ui-scene-column-content]") as HTMLElement | null;

    // With A focused (first object), top offset should be 0 or near 0
    const topBefore = contentWrapper ? parseFloat(contentWrapper.style.top || "0") : 0;

    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Wait for motion to apply the new top value after the React rerender.
    await waitForAnimationFrame();

    // With B focused (second object), the column content should have scrolled
    // to show B — meaning the top offset is negative (content slid up).
    const topAfter = contentWrapper ? parseFloat(contentWrapper.style.top || "0") : 0;
    expect(topAfter).toBeLessThan(topBefore);
  });

  test("sibling columns are unaffected by vertical swap", async () => {
    // A vertical swap within col1 should not change col2's focused state.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj-c" focused>
              <div data-testid="content-c" style={{ width: 300, height: 200 }}>C</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const col2 = getByTestId("content-c").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const initialFocused = col2.getAttribute("data-ui-scene-column-focused");

    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj-c" focused>
              <div data-testid="content-c" style={{ width: 300, height: 200 }}>C</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // col2 should remain focused and unaffected
    expect(col2.getAttribute("data-ui-scene-column-focused")).toBe(initialFocused);
    expect(col2.getAttribute("data-ui-scene-column-focused")).toBe("true");
    expect(window.getComputedStyle(col2).position).toBe("relative");
  });

  test("column state attributes live on the anchor, not the column node (ui#22 wrinkle)", async () => {
    // ui#22 §8b ruling: data-ui-scene-column-focused/-position describe column
    // STATE and stay on the in-flow ANCHOR (data-ui-scene-column-anchor) even
    // though the clean family name (data-ui-scene-column) went to the nested
    // animated column node. Deliberate asymmetry — pin it so a future refactor
    // can't silently move state onto the node without a test noticing.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const anchor = getByTestId("content-a").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const columnNode = anchor.querySelector("[data-ui-scene-column]") as HTMLElement;

    expect(anchor.hasAttribute("data-ui-scene-column-focused")).toBe(true);
    expect(columnNode.hasAttribute("data-ui-scene-column-focused")).toBe(false);
  });

  test("a never-focused sibling before a to-be-focused object does not displace it (B3)", async () => {
    // A is never focused anywhere in this test. B starts unfocused, then
    // becomes focused. Because A is genuinely in flow (position: relative)
    // the whole time, B's real rendered offset within the content wrapper
    // already includes A's height (200px) — topOffset must account for
    // that to bring B to the top, not treat A's never-reported height as 0.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 300 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 300 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const objB = getByTestId("content-b").element().closest("[data-ui-scene-id]") as HTMLElement;
    const contentWrapper = objB.closest("[data-ui-scene-column-anchor]")?.querySelector("[data-ui-scene-column-content]") as HTMLElement;

    // topOffset must equal A's real height (200) so the wrapper shifts up
    // enough to bring B to the top of the viewport.
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-200);
  });

  test("real mode: a swap springs the wrapper's top through intermediate values (S3 regression)", async () => {
    // Pre-S3, `top` was driven via motion's `animate={{top}}` prop, which
    // sprang through intermediate values on every swap. S3's composedTop
    // MotionValue recombines synchronously with the plain per-render
    // topOffset on every render, so a swap changes `top` in a single frame
    // (teleport) instead of springing. Large content height so the swap
    // distance is big enough to sample multiple distinct intermediate
    // values within a handful of rAF frames.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 1000 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 1000 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const contentWrapper = getByTestId("content-a").element().closest("[data-ui-scene-column-anchor]")
      ?.querySelector("[data-ui-scene-column-content]") as HTMLElement;

    // Swap to B with the default (real) spring — no duration override.
    await rerender(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 300, height: 1000 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 1000 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      await waitForAnimationFrame();
      samples.push(parseFloat(contentWrapper.style.top || "0"));
    }

    // Not a single-frame teleport: samples must not all be identical (today
    // every sample is already at the final value post-jump).
    const allIdentical = samples.every((s) => s === samples[0]);
    expect(allIdentical).toBe(false);

    // Monotonic progression toward the final (more negative) target — the
    // wrapper slides up, so `top` should never increase between samples
    // within this early capture window (well before any spring overshoot).
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThanOrEqual(samples[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Entrance geometry: newly-mounted focus swap, coincidental content height
// (predates ui#19 — the mechanism traces to a gap in the ResizeObserver/
// per-render remeasure split, not to anything in the single-writer arc).
//
// Root cause (source-traced, all citations verified against 9b7f3d4):
// computeTopOffset (:161-174) reads geometry captured by the PREVIOUS
// render's layout effects (:1640-1644, "avoids a two-render cycle" — by
// design). A newly-MOUNTED focused object has no previous-render geometry
// entry at all, so its first render's topOffset falls back to `?? 0`
// (:173). The drive effect (:2228-2240) either early-returns (when that
// fallback 0 happens to match the already-driven target — exactly the
// case when the previously-focused object's own offsetTop was also 0) or
// drives toward the wrong value. The correcting re-render depends entirely
// on setContentHeight(...) (:1882) actually producing a new number — the
// synchronous per-render remeasure effect (:1879-1883) DOES correct
// geometryStore via remeasureGeometryWithAnchorCompensation() (:1880), but
// discards its `changed` return value and never calls setGeometryVersion,
// unlike its ResizeObserver sibling (:1827,:1856), which captures `changed`
// and bumps geometryVersion specifically to force this correcting
// re-render. If the newly-focused object's content height coincidentally
// equals what was already accounted for (i.e. computeFocusedContentHeight
// returns the SAME number before and after the swap), setContentHeight
// no-ops (React bails on an identical state update) and NO re-render ever
// arrives to pick up the now-correct geometryStore data — the entrance
// freezes permanently, not just late.
//
// Fixture constraint: SceneObject's own D5 focus-on-activate effect
// (SceneObject.tsx:101-124) already calls .focus({preventScroll:true})
// whenever an object newly becomes focused, and real Chromium (this suite
// runs in real Chromium via vitest browser mode, not jsdom) honors
// preventScroll — so a plain DOM .click() swap trigger (not a
// Playwright-actionability-checked locator click, which scrolls its
// target into view first) does not risk a native focus-scroll rescuing
// the object and masking the bug under master's overflow-y:hidden.
// ---------------------------------------------------------------------------

describe("Scene entrance geometry — newly-mounted focus swap", () => {
  // Two-object column: A starts focused (height 200), B does not exist in
  // the tree at all until the swap. `heightB` is the only difference
  // between the repro and its control.
  function SwapToNewMount({ heightB }: { heightB: number }) {
    const [showB, setShowB] = useState(false);
    return (
      <>
        {/* position:fixed takes this out of normal flow — TestWrapper's
            fullPage div is a plain block, so an in-flow sibling here would
            push it down and contaminate the gBCR comparison against the
            reference render below (which has no such sibling). */}
        <button data-testid="swap-btn" style={{ position: "fixed" }} onClick={() => setShowB(true)}>
          Swap
        </button>
        <TestWrapper fullPage>
          <Scene duration={0} padding={0}>
            <SceneColumn name="col" objectGap={0}>
              <SceneObject name="obj-a" focused={!showB}>
                <div data-testid="content-a" style={{ width: 300, height: 200 }}>
                  A
                </div>
              </SceneObject>
              {showB && (
                <SceneObject name="obj-b" focused>
                  <div data-testid="content-b" style={{ width: 300, height: heightB }}>
                    B
                  </div>
                </SceneObject>
              )}
            </SceneColumn>
          </Scene>
        </TestWrapper>
      </>
    );
  }

  // A fresh, never-swapped mount with B already the sole focused object —
  // the "canonical top" reference. Same technique ui#19's B1-replacement
  // test used (comparing against a fresh render of the equivalent final
  // state, not a hand-derived pixel value) — this sidesteps needing to
  // independently re-derive the exact expected offset and instead proves
  // the swapped B ends up in the SAME place a correctly-entered B would.
  function FreshMountWithBFocused({ heightB }: { heightB: number }) {
    return (
      <TestWrapper fullPage>
        <Scene duration={0} padding={0}>
          <SceneColumn name="col" objectGap={0}>
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>
                A
              </div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: heightB }}>
                B
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  async function settle() {
    await waitForAnimationFrame();
    for (const delay of [16, 100, 300, 600]) {
      await wait(delay);
    }
  }

  test("REPRO: swapping to a newly-mounted object whose height coincidentally matches the outgoing one freezes the entrance", async () => {
    // A is 200 tall; B is ALSO 200 tall — computeFocusedContentHeight
    // returns the same number before and after the swap, so setContentHeight
    // no-ops and (under the bug) the correcting re-render never arrives.
    const { getByTestId } = await render(<SwapToNewMount heightB={200} />);

    (getByTestId("swap-btn").element() as HTMLElement).click();
    await settle();

    const objB = getByTestId("content-b").element().closest("[data-ui-scene-id]") as HTMLElement;
    const swappedTop = objB.getBoundingClientRect().top;

    await cleanup();

    const { getByTestId: getByTestIdFresh } = await render(<FreshMountWithBFocused heightB={200} />);
    await settle();
    const freshObjB = getByTestIdFresh("content-b").element().closest("[data-ui-scene-id]") as HTMLElement;
    const canonicalTop = freshObjB.getBoundingClientRect().top;

    expect(swappedTop).toBeCloseTo(canonicalTop, 0);
  });

  test("CONTROL: swapping to a newly-mounted object with a DIFFERENT height reaches its canonical top (discriminates the repro on the coincidence, not on mounting mechanics)", async () => {
    // A is 200 tall; B is 350 tall — computeFocusedContentHeight necessarily
    // changes, so setContentHeight fires a real re-render and the entrance
    // is expected to reach canonical even on master.
    const { getByTestId } = await render(<SwapToNewMount heightB={350} />);

    (getByTestId("swap-btn").element() as HTMLElement).click();
    await settle();

    const objB = getByTestId("content-b").element().closest("[data-ui-scene-id]") as HTMLElement;
    const swappedTop = objB.getBoundingClientRect().top;

    await cleanup();

    const { getByTestId: getByTestIdFresh } = await render(<FreshMountWithBFocused heightB={350} />);
    await settle();
    const freshObjB = getByTestIdFresh("content-b").element().closest("[data-ui-scene-id]") as HTMLElement;
    const canonicalTop = freshObjB.getBoundingClientRect().top;

    expect(swappedTop).toBeCloseTo(canonicalTop, 0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: Multi-focus stacking within a column
// ---------------------------------------------------------------------------

describe("SceneColumn multi-focus stacking", () => {
  test("two focused objects in same column are both visible and in flow", async () => {
    // When multiple objects in a column are focused, all should be position:
    // relative (in flow) so they stack vertically.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const objA = getByTestId("content-a").element().closest("[data-ui-scene-id]") as HTMLElement;
    const objB = getByTestId("content-b").element().closest("[data-ui-scene-id]") as HTMLElement;

    // Both focused objects are in normal flow
    expect(window.getComputedStyle(objA).position).toBe("relative");
    expect(window.getComputedStyle(objB).position).toBe("relative");
  });

  test("two focused objects stack vertically — B appears below A", async () => {
    // The two focused objects should appear in DOM order, with B below A.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const objA = getByTestId("content-a").element().closest("[data-ui-scene-id]") as HTMLElement;
    const objB = getByTestId("content-b").element().closest("[data-ui-scene-id]") as HTMLElement;

    const rectA = objA.getBoundingClientRect();
    const rectB = objB.getBoundingClientRect();

    // B should appear below A in the rendered output
    expect(rectB.top).toBeGreaterThan(rectA.top);
    expect(rectA.height).toBeGreaterThan(0);
    expect(rectB.height).toBeGreaterThan(0);
  });

  test("unfocusing one object from a multi-focus column keeps it in flow", async () => {
    // Start with two focused objects, then unfocus one. The unfocused one
    // stays position: relative (visible in the scene, just inert).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const objA = getByTestId("content-a").element().closest("[data-ui-scene-id]") as HTMLElement;
    const objB = getByTestId("content-b").element().closest("[data-ui-scene-id]") as HTMLElement;

    expect(window.getComputedStyle(objA).position).toBe("relative");
    expect(window.getComputedStyle(objB).position).toBe("relative");
  });

  test("multi-focus column top offset is zero — shows from the top", async () => {
    // With multiple focused objects, the column content wrapper should not
    // apply a negative top offset (show from the top, let objects stack naturally).
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const contentWrapper = getByTestId("content-a").element().closest("[data-ui-scene-column-anchor]")
      ?.querySelector("[data-ui-scene-column-content]") as HTMLElement | null;

    // With multiple focused objects, top should be 0 (no slide offset)
    const top = contentWrapper ? parseFloat(contentWrapper.style.top || "0") : 0;
    expect(top).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: Centering and alignment
// ---------------------------------------------------------------------------

describe("Scene centering", () => {
  test("fixed-width column is centered horizontally via stage left position", async () => {
    // A column with a fixed minimum width smaller than the viewport is centered
    // horizontally. The stage's CSS `left` value is set to position the focused
    // region in the center of the viewport.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          {/* Column with a 300px min-width — smaller than the 1280px viewport */}
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div
                data-testid="content"
                style={{ minWidth: 300, height: 100 }}
              />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // A 300px column in a 1280px viewport is centered via stage `left` offset.
    // Expected stageLeft = (1280 - 300) / 2 = 490px.
    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement | null;
    expect(stage).not.toBeNull();

    // Stage centering via CSS left (absolute positioning).
    const stageStyle = window.getComputedStyle(stage!);
    const stageLeft = parseFloat(stageStyle.left);
    expect(stageLeft).toBeGreaterThan(0);

    // Content should be horizontally centered within the viewport.
    const content = getByTestId("content").element();
    const rect = content.getBoundingClientRect();
    const viewportWidth = 1280;
    const expectedLeft = (viewportWidth - 300) / 2;
    expect(Math.abs(rect.left - expectedLeft)).toBeLessThan(2);
  });

  test("content overflowing horizontally — Camera scrollLeft left-aligns focused region", async () => {
    // When focused content width exceeds the viewport, the Camera left-aligns
    // (scrollLeft = focused region's left edge).
    const { getByTestId } = await render(
      // Three wide columns in a 1280px viewport — total exceeds viewport
      buildScene(
        [
          { name: "col1", objects: [{ name: "obj1", focused: true, width: 500, height: 100, testId: "content1" }] },
          { name: "col2", objects: [{ name: "obj2", focused: true, width: 500, height: 100, testId: "content2" }] },
          { name: "col3", objects: [{ name: "obj3", focused: true, width: 500, height: 100, testId: "content3" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement | null;
    expect(stage).not.toBeNull();

    // When focused content overflows, stageLeft = -focusedNaturalLeft (left-aligned).
    // The focused region starts at the stage origin (natural left = 0), so stageLeft = 0.
    const stageStyle = window.getComputedStyle(stage!);
    const stageLeft = parseFloat(stageStyle.left);
    expect(stageLeft).toBe(0);
  });

  test("small content is centered vertically — column content wrapper has margin-top > 0", async () => {
    // Content that is shorter than the viewport should be centered vertically
    // via margin-top on the column content wrapper.
    const { getByTestId } = await render(
      // Short content: 100px in an 800px viewport
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 200, height: 100, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-ui-scene-column-anchor]") as HTMLElement;
    const contentWrapper = column?.querySelector("[data-ui-scene-column-content]") as HTMLElement | null;
    expect(contentWrapper).not.toBeNull();

    // ui#17: Motion's `style`-bound MotionValue writes (the owned width
    // channel, mirroring topOffsetMV) are rAF-batched, not synchronous
    // within the commit that changes their target — a geometry read
    // immediately after render() can observe a stale/default value. See
    // awaitStyleFlush's own doc comment for the probe evidence.
    await awaitStyleFlush();

    // margin-top should be > 0 to center the 100px content in an 800px viewport
    // Expected: (800 - 100) / 2 = 350px
    const marginTop = parseFloat(window.getComputedStyle(contentWrapper!).marginTop);
    expect(marginTop).toBeGreaterThan(0);
  });

  test("column content taller than viewport — margin-top is 0 (top-aligned)", async () => {
    // When focused content height exceeds the viewport, margin-top should be 0.
    const { getByTestId } = await render(
      // Taller than 800px viewport
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 200, height: 1000, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-ui-scene-column-anchor]") as HTMLElement;
    const contentWrapper = column?.querySelector("[data-ui-scene-column-content]") as HTMLElement | null;
    expect(contentWrapper).not.toBeNull();

    const marginTop = parseFloat(window.getComputedStyle(contentWrapper!).marginTop);
    // Content overflows — no top margin
    expect(marginTop).toBe(0);
  });

  test("viewport resize: centered content becomes left-aligned when it overflows", async () => {
    // A focused column that fits the viewport should be centered. When the viewport
    // is resized to be smaller than the content, the margin-top should drop to 0.
    // We simulate this by starting with short content (fits 800px viewport) then
    // swapping in tall content (overflows).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              {/* Short content — fits 800px viewport */}
              <div data-testid="content" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const contentWrapper = scene.querySelector("[data-ui-scene-column-content]") as HTMLElement | null;

    // ui#17: see awaitStyleFlush's own doc comment (rAF-batched MotionValue
    // writes, e.g. the owned width channel — a geometry read immediately
    // after render()/rerender() can observe a stale/default value).
    await awaitStyleFlush();

    // Initially centered (margin-top > 0)
    const marginTopBefore = parseFloat(window.getComputedStyle(contentWrapper!).marginTop);
    expect(marginTopBefore).toBeGreaterThan(0);

    // Swap to tall content that overflows the viewport
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              {/* Tall content — exceeds 800px viewport */}
              <div data-testid="content" style={{ minWidth: 200, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await awaitStyleFlush();

    // Now overflowing — margin-top should be 0 (top-aligned)
    const marginTopAfter = parseFloat(window.getComputedStyle(contentWrapper!).marginTop);
    expect(marginTopAfter).toBe(0);
  });

  test("small content — vertically centered in viewport", async () => {
    // When content fits both axes, it should be visually centered vertically.
    // Vertical centering is via margin-top on the column content wrapper.
    // Horizontal centering via scrollLeft only works when there are unfocused
    // columns extending the stage width; for a single focused column with no
    // outer columns, the content sits at the left edge.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div data-testid="content" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // ui#17: see awaitStyleFlush's own doc comment (rAF-batched MotionValue
    // writes — a geometry read immediately after render() can observe a
    // stale/default value).
    await awaitStyleFlush();

    const content = getByTestId("content").element() as HTMLElement;
    const rect = content.getBoundingClientRect();

    // Vertical center: in an 800px viewport with 100px content,
    // content should be near y = 350
    expect(rect.top).toBeGreaterThan(100);    // not top-aligned
    expect(rect.bottom).toBeLessThan(700);    // not bottom-aligned
  });

  test("Camera stage-left centers focused region when outer columns extend the stage", async () => {
    // When outer columns are in the flex row, the stage's `left` positions the
    // viewport so the focused region is centered. With outer columns present,
    // the focused column is not at the stage's left edge, so stageLeft < 0.
    //
    // Setup: outer-left=900px, focused=200px, outer-right=900px.
    // focusedNaturalLeft = 900. vpWidth = 1280.
    // stageLeft = (1280 - 200) / 2 - 900 = 540 - 900 = -360 (negative = stage panned left)
    //
    // Note: outer columns must have been previously focused to have a frozen size.
    // Using focused → unfocused rerender pattern.
    const { rerender, getByTestId } = await render(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 900, height: 100, testId: "content-left" }] },
          { name: "col-focused", objects: [{ name: "obj-focused", focused: true, width: 200, height: 100, testId: "content-focused" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 900, height: 100, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // Now focus only the center column — the two outer columns freeze and stay in flex row
    await rerender(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: false, width: 900, height: 100, testId: "content-left" }] },
          { name: "col-focused", objects: [{ name: "obj-focused", focused: true, width: 200, height: 100, testId: "content-focused" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: false, width: 900, height: 100, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement | null;
    expect(stage).not.toBeNull();
    // stageLeft ≈ -360 — stage panned left to center the 200px focused region
    const stageLeft = parseFloat(window.getComputedStyle(stage!).left);
    expect(stageLeft).toBeLessThan(0);
  });

  test("viewport height measurement uses content-box, not scrollbar-oblivious border-box (F5 item 5, H10 wobble)", async () => {
    // Root cause (probe-confirmed via a real, space-reserving scrollbar —
    // headless Chromium normally suppresses scrollbar rendering entirely via
    // Playwright's own `--hide-scrollbars` default launch arg, which is why
    // the original H10 investigation, commit b3af937, couldn't reproduce a
    // wobble at all): the viewport's per-render useLayoutEffect measured
    // width/height from `getBoundingClientRect()` (border-box — unaffected
    // by the element's OWN horizontal scrollbar, which toggles on/off as
    // focused content's width crosses the overflow boundary), while the
    // ResizeObserver callback correctly measured `contentRect` (content-box
    // — shrinks when that scrollbar is showing). These two mechanisms
    // disagreed: the ResizeObserver would fire and correctly report the
    // smaller, scrollbar-aware height, but that state update triggered a
    // re-render whose layout effect (no deps, runs on EVERY render)
    // immediately re-measured via `getBoundingClientRect()` and overwrote
    // the correction back to the larger, wrong value — a race that resolved
    // within a couple of milliseconds (invisible to per-animation-frame
    // sampling) with the scrollbar-oblivious value always winning, silently
    // miscentering content (marginTop and anything else derived from
    // effectiveViewportHeight) by the scrollbar's thickness whenever one is
    // showing.
    //
    // This test reproduces the underlying measurement discrepancy directly
    // (stubbing `clientHeight` on the real viewport element to be shorter
    // than its real `offsetHeight`, simulating a scrollbar) rather than
    // depending on real scrollbar rendering, which would require changing
    // the suite's global browser launch config (`ignoreDefaultArgs:
    // ["--hide-scrollbars"]`) — out of scope here since it would affect
    // every visual/screenshot test's baseline across the whole suite.
    const build = () =>
      buildScene(
        [{ name: "col", objects: [{ name: "obj", focused: true, width: 300, height: 200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      );

    const { rerender, getByTestId } = await render(build());

    const viewport = getByTestId("scene").element() as HTMLElement;
    const wrapper = viewport.querySelector("[data-ui-scene-column-content]") as HTMLElement;
    const readMarginTop = () => parseFloat(wrapper.style.marginTop || "0");

    // ui#17: see awaitStyleFlush's own doc comment (rAF-batched MotionValue
    // writes — a geometry read immediately after render()/rerender() can
    // observe a stale/default value).
    await awaitStyleFlush();

    const baselineMarginTop = readMarginTop();
    // Sanity: a real resting value to shrink from (not degenerately 0).
    expect(baselineMarginTop).toBeGreaterThan(0);

    // Simulate an 11px classic (space-reserving) horizontal scrollbar.
    const realOffsetHeight = viewport.offsetHeight;
    Object.defineProperty(viewport, "clientHeight", {
      value: realOffsetHeight - 11,
      configurable: true,
    });

    // Any rerender forces the always-runs useLayoutEffect to re-measure —
    // it has no deps array by design (dynamic resizes must be picked up as
    // fast as possible).
    await rerender(build());
    await awaitStyleFlush();

    // Vertical centering halves the viewport-height delta: marginTop must
    // shrink by ~5.5px (11px / 2), not stay unchanged.
    const afterMarginTop = readMarginTop();
    expect(baselineMarginTop - afterMarginTop).toBeCloseTo(5.5, 0);
  });
});

// ---------------------------------------------------------------------------
// A4: first paint at rest (no entrance animation) — a multi-column centered
// layout mounted directly in real (non-instant) mode should already be at
// its resting stage-left/marginTop position on the very first painted frame,
// not spring into place from 0 over the following ~600ms.
// ---------------------------------------------------------------------------

describe("Scene first paint at rest (A4)", () => {
  test("stage left and content marginTop are constant from the first sample — no first-paint spring", async () => {
    // Two focused columns, combined width (600px) well under the 1280px
    // viewport (triggers non-zero horizontal centering) and content height
    // (300px) well under the 800px viewport (triggers non-zero vertical
    // centering) — both channels have real distance to spring across if the
    // first-paint gate is missing. No duration override — real springs.
    const { getByTestId } = await render(
      // No duration override on the source — mirrored exactly, never
      // defaulted to `duration: 0` (real springs are the point of this test).
      buildScene(
        [
          { name: "col-a", objects: [{ name: "obj-a", focused: true, width: 300, height: 300, testId: "content-a" }] },
          { name: "col-b", objects: [{ name: "obj-b", focused: true, width: 300, height: 300, testId: "content-b" }] },
        ],
        undefined,
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement;
    const contentWrapper = getByTestId("content-a").element().closest("[data-ui-scene-column-anchor]")
      ?.querySelector("[data-ui-scene-column-content]") as HTMLElement;

    const readStageLeft = () => parseFloat(window.getComputedStyle(stage).left);
    const readMarginTop = () => parseFloat(window.getComputedStyle(contentWrapper).marginTop);

    // ui#17: Motion's rAF-driven MotionValue writes land before the
    // browser's next repaint (probe-confirmed: a synchronous read right
    // after render() can see a stale/default value that never actually
    // paints — awaitStyleFlush's own doc comment has the evidence), so
    // sampling AFTER one rAF tick still reflects the true first PAINTED
    // frame this test is about, not a later one.
    await awaitStyleFlush();

    // Sample immediately (the first painted frame) plus several points across
    // the following ~600ms — long enough to catch a slow default-spring climb.
    const stageLeftSamples = [readStageLeft()];
    const marginTopSamples = [readMarginTop()];
    for (const delay of [16, 100, 200, 300, 600]) {
      await wait(delay);
      stageLeftSamples.push(readStageLeft());
      marginTopSamples.push(readMarginTop());
    }

    // Sanity: both channels have real resting values to have sprung from/to
    // (not degenerately 0 the whole time, which would make this test vacuous).
    expect(stageLeftSamples[stageLeftSamples.length - 1]).not.toBe(0);
    expect(marginTopSamples[marginTopSamples.length - 1]).not.toBe(0);

    for (const sample of stageLeftSamples) {
      expect(sample).toBe(stageLeftSamples[0]);
    }
    for (const sample of marginTopSamples) {
      expect(sample).toBe(marginTopSamples[0]);
    }
  });

  test("a column mounting already focused on its second object is at rest immediately — no first-paint spring", async () => {
    // topOffsetMV (item 1's swap-spring fix) shares the same first-paint gap
    // as marginTop above: mounting DIRECTLY with a later object focused
    // (e.g. a deep link) needs a nonzero topOffset from the very first
    // frame, not a spring up from 0.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 300, height: 1000 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 1000 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const contentWrapper = getByTestId("content-a").element().closest("[data-ui-scene-column-anchor]")
      ?.querySelector("[data-ui-scene-column-content]") as HTMLElement;

    const readTop = () => parseFloat(contentWrapper.style.top || "0");
    const samples = [readTop()];
    for (const delay of [16, 100, 300, 600]) {
      await wait(delay);
      samples.push(readTop());
    }

    // Sanity: real resting value to have sprung from/to.
    expect(samples[samples.length - 1]).not.toBe(0);

    for (const sample of samples) {
      expect(sample).toBe(samples[0]);
    }
  });

  test("StrictMode: marginTop is at rest immediately on a real, non-act mount — no first-paint spring (F5 item 3)", async () => {
    // React StrictMode double-invokes a component's render FUNCTION BODY in
    // development (discarding the first call's return value, keeping the
    // second). columnGeometrySettledRef (SceneColumn's A4 first-paint gate)
    // used to be mutated directly during render — impure, and on the exact
    // commit where effectiveViewportHeight first becomes real, StrictMode's
    // second (kept) invocation observed the ref already flipped `true` by the
    // first invocation, silently defeating the "capture before mutate" gate
    // on the one render it exists to keep instant. The two tests above never
    // exercise this: their `render()` mount doesn't reproduce the same
    // paint/effect interleaving a REAL, later, event-driven mount does
    // (probe-confirmed on the actual dev app, which is StrictMode-wrapped:
    // marginTop visibly springs 0->79px over ~330ms on page load). This test
    // reproduces that shape directly — mount a toggle button first, then a
    // real DOM `.click()` mounts the Scene — under an explicit <StrictMode>
    // wrapper, which the app-level demo already uses (dev/main.tsx).
    function MountOnClick() {
      const [mounted, setMounted] = useState(false);
      return (
        <>
          <button data-testid="mount-btn" onClick={() => setMounted(true)}>
            Mount
          </button>
          {mounted && (
            <Scene>
              <SceneColumn name="col-a">
                <SceneObject name="obj-a" focused>
                  <div data-testid="content-a" style={{ width: 300, height: 300 }} />
                </SceneObject>
              </SceneColumn>
              <SceneColumn name="col-b">
                <SceneObject name="obj-b" focused>
                  <div data-testid="content-b" style={{ width: 300, height: 300 }} />
                </SceneObject>
              </SceneColumn>
            </Scene>
          )}
        </>
      );
    }

    const { getByTestId } = await render(
      <StrictMode>
        <TestWrapper fullPage>
          <MountOnClick />
        </TestWrapper>
      </StrictMode>,
    );

    (getByTestId("mount-btn").element() as HTMLElement).click();
    await waitForAnimationFrame();

    const contentWrapper = getByTestId("content-a").element().closest("[data-ui-scene-column-anchor]")
      ?.querySelector("[data-ui-scene-column-content]") as HTMLElement;
    const readMarginTop = () => parseFloat(window.getComputedStyle(contentWrapper).marginTop);

    // ui#17: a single awaitStyleFlush (matching this file's other fixes)
    // measured racy specifically here — StrictMode's double-invocation plus
    // a real click-driven mount interleaves the test's own rAF wait with
    // Motion's scheduled write in a way a single tick doesn't reliably
    // clear; escalating to a second tick per awaitStyleFlush's own
    // documented double-rAF fallback.
    await awaitStyleFlush();

    // rAF-sample across ~40 real frames (not fixed-delay polling) — a real
    // spring shows a smooth multi-frame climb across this window; the earlier
    // sample point already caught most of the climb in the manual probe, so
    // sampling starts immediately after the mounting frame.
    const samples: number[] = [readMarginTop()];
    for (let i = 0; i < 40; i++) {
      await waitForAnimationFrame();
      samples.push(readMarginTop());
    }

    // Sanity: a real resting value to have sprung from/to (not degenerately 0
    // throughout, which would make this test vacuous).
    expect(samples[samples.length - 1]).not.toBe(0);

    for (const sample of samples) {
      expect(sample).toBe(samples[0]);
    }
  });

  test("a real box-size discrepancy during the settling window resolves instantly, not via a visible layout-FLIP spring (F7 item 2 residual)", async () => {
    // Root cause (probe-confirmed against a real dev server with real,
    // space-reserving scrollbars): SceneColumn's outer `motion.div` uses
    // `layout` (Motion's FLIP projection system), which measures the
    // column's real getBoundingClientRect() on every commit and springs any
    // difference from the previous commit's measurement. That spring was
    // driven by the column's own `transition` prop — used for BOTH its
    // `animate={{opacity,x,y,filter}}` values AND, implicitly, `layout`'s
    // own correction — which, unlike marginTopTransition above, was never
    // gated on `columnGeometryWasSettled`/`firstPaintRef` at all. During
    // Scene's mount/settling window the column's own box (stretched to the
    // flex row's cross-axis extent via align-items:stretch) can be measured
    // at a stale, larger size on an early commit and a smaller, correct size
    // on a later one — live probe: getBoundingClientRect().height read
    // 252.7px on an early commit vs. offsetHeight's already-correct,
    // constant 243px, and the ungated `layout` FLIP animated a visible
    // scaleY+translateY correction (252.7→243) over ~270ms even after
    // marginTop's own spring (a separate motion value, item 2's original
    // fix) had already resolved — this is what still looked like "sliding
    // in" on first load even once that first fix landed.
    //
    // Reproduced here by forcing a REAL box-size change (via TestWrapper's
    // height prop) from within a useLayoutEffect — pre-paint, same commit
    // tier as Scene's own first-paint/settling machinery, so this lands
    // within the same narrow not-yet-settled window the live bug occupies.
    // A plain content-height change or a clientHeight stub (F5 item 5's
    // technique) do NOT reproduce this: the column's cross-axis height is
    // governed entirely by align-items:stretch against the real, rendered
    // row height, not by content or by JS-only property overrides.
    function ShrinkOnMount() {
      const [height, setHeight] = useState(800);
      useLayoutEffect(() => {
        setHeight(500);
      }, []);
      return (
        <TestWrapper fullPage height={height}>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="obj" focused>
                <div data-testid="content" style={{ width: 300, height: 200 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<ShrinkOnMount />);

    const viewport = getByTestId("scene").element() as HTMLElement;
    const colEl = viewport.querySelector("[data-ui-scene-column-anchor]") as HTMLElement;

    // Sanity: a real, non-degenerate height discrepancy exists to correct —
    // offsetHeight (a layout metric, immune to any transform) already
    // reflects the final, settled 500px target on the very first sample.
    expect(colEl.offsetHeight).toBe(500);

    // Sample across the window the un-fixed bug's spring occupied (~270ms /
    // ~16 frames in the live probe). getBoundingClientRect().height must
    // already match offsetHeight (500) by the very first animation frame —
    // proving the correction applied instantly rather than animating a
    // stale-vs-settled discrepancy over many frames.
    await waitForAnimationFrame();
    const rectHeight = colEl.getBoundingClientRect().height;
    expect(rectHeight).toBeCloseTo(500, 0);

    // And it stays resolved — no later frame reintroduces the distortion.
    for (let i = 0; i < 10; i++) {
      await waitForAnimationFrame();
      expect(colEl.getBoundingClientRect().height).toBeCloseTo(500, 0);
    }
  });
});

// ---------------------------------------------------------------------------
// ui#17 Slice 1 (2026-07-30, re-scoped post-ui#19): re-attempt of the same
// instrumentation techniques the original ui#17 investigation proved out
// (`fix/ui17-node-split`, commit 885c40d, and `scratch/ui#o9 repro package
// for ui#17`) against TODAY's post-ui#19 code — the single-writer horizontal
// rewrite that landed since that investigation touched Scene.tsx's camera
// channel (panOffset/cameraX), not SceneColumn's own same-node
// `layout`+`animate` composition (the plan note's topology map confirmed
// this at pickup: `animateX` is 0 for every focused/bystander column, the
// camera pan lives entirely on the stage ancestor's `style.left`).
//
// OUTCOME: reproduces cleanly (the plan's evidence-state carryforward
// section's outcome 1, not the hazard-class fallback). Bounded per the
// plan/ruling: ONE fresh fixture variant attempted for the corruption
// mechanism (see below — a first attempt anchored the always-focused
// bystander with `anchor="end"`, which reads a constant zero transform the
// whole time — anchor pinning routes through a different position channel,
// not the FLIP transform this fixture needs to exercise; the ONE committed
// variant below moves the bystander to plain flex flow, matching the
// original SiblingReflowDemo mechanism, which is not a second "hunt", just
// correcting the same fixture to actually engage the code path under test).
// Both mechanisms measured with a FIXED N=10 in a disposable diagnostic
// harness (not committed) before writing the assertions below, per the
// plan's stop-on-first-failure-bias lesson:
//   - Mid-flight corruption (production-shaped fixture, cqw units,
//     differently-sized `tasks`(40cqw)/`problems`(55cqw) siblings swapping
//     focus in one commit, `chat` the always-focused bystander after them in
//     flex order): 10/10 runs produced a frame-to-frame raw-transform
//     discontinuity of ~68-80px/ms (a ~570-600px swing within ~8-9ms) — the
//     same signature 885c40d measured pre-ui#19 (there: ~35-39px/ms against
//     a smaller-amplitude fixture), now against post-ui#19 production code.
//   - Clicks-land (SiblingReflowDemo geometry, list/detail/chat, "chat" the
//     bystander): 10/10 runs mistargeted the click onto the content
//     wrapper `div` instead of the button — the same class of miss the
//     original o9 production capture recorded (repro package §3d: a real
//     click landing on a ButtonGroup wrapper instead of its intended
//     button).
// Both committed tests below are single instances of these fixed-N-verified
// reproductions — the red baseline Slice 2's split must turn green.
// ---------------------------------------------------------------------------

describe("Column transition gate: mid-flight corruption (ui#o9), production-shaped fixture", () => {
  test("a second sibling focus toggle landing mid-spring produces a transform-channel discontinuity on a bystander column, not continuous spring motion", async () => {
    // Production-shaped: cqw-sized columns (container-query width, matching
    // the real app's sizing idiom — see repro package §1/§2), a pair of
    // DIFFERENTLY-sized siblings ("tasks" 40cqw, "problems" 55cqw) that swap
    // focus in a SINGLE commit (mirroring the real trigger: one click flips
    // both), and "chat" — always focused, its own classification never
    // changes — positioned AFTER them in flex order so its box genuinely
    // reflows when the combined tasks/problems width changes between the
    // two states (a bystander column earlier in DOM order wouldn't move at
    // all: a flex child's position is unaffected by later siblings resizing).
    function ProductionCorruptionDemo() {
      const [tasksFocused, setTasksFocused] = useState(true);
      return (
        <TestWrapper fullPage width={1024} height={600}>
          <button data-testid="toggle" onClick={() => setTasksFocused((v) => !v)}>
            toggle
          </button>
          <Scene columnGap={8}>
            <SceneColumn name="tasks">
              <SceneObject name="tasks-obj" focused={tasksFocused} style={{ width: "40cqw" }}>
                <div style={{ height: 400 }}>tasks</div>
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="problems">
              <SceneObject name="problems-obj" focused={!tasksFocused} style={{ width: "55cqw" }}>
                <div style={{ height: 400 }}>problems</div>
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="chat">
              <SceneObject name="chat-obj" focused style={{ width: "55cqw" }}>
                <div data-testid="chat-content" style={{ height: 400 }}>chat</div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<ProductionCorruptionDemo />);
    await wait(600);

    const scene = getByTestId("scene").element() as HTMLElement;
    const stageEl = scene.querySelector("[data-ui-scene-stage]") as HTMLElement;
    // `chatCol` resolves to the element carrying `data-ui-scene-column-anchor` — TODAY the
    // single combined motion.div with both `layout` and `animate`. Per the
    // plan's consumer map, `layout` and `data-ui-scene-column-anchor`/registry/ref both stay
    // on the OUTER node after the Slice 2 split, so this read survives the
    // split unmodified.
    const chatCol = getByTestId("chat-content").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const relLeft = () => chatCol.getBoundingClientRect().left - stageEl.getBoundingClientRect().left;
    // Before any animation has touched this element, `.style.transform` is
    // the literal string "none" — normalized to 0 (identity), same
    // precedent as 885c40d's readTx.
    const readTx = () => {
      const t = chatCol.style.transform;
      return t === "none" || t === "" ? 0 : parseTranslateX(t);
    };
    const before = relLeft();

    const toggleBtn = getByTestId("toggle").element() as HTMLElement;
    const start = performance.now();
    toggleBtn.click();

    // Sample continuously across the FIRST toggle, fire the second ~150ms in
    // (mid-spring), then keep sampling through the corruption's window —
    // same timing as 885c40d's precedent.
    const samples: { t: number; x: number; tx: number; event?: string }[] = [];
    let fired2 = false;
    while (performance.now() - start < 1200) {
      await waitForAnimationFrame();
      const now = performance.now() - start;
      if (!fired2 && now >= 150) {
        toggleBtn.click();
        fired2 = true;
        samples.push({ t: now, x: relLeft(), tx: readTx(), event: "toggle2" });
      }
      samples.push({ t: now, x: relLeft(), tx: readTx() });
    }
    expect(fired2).toBe(true); // sanity: the second toggle actually fired

    const settled = samples[samples.length - 1]!.x;

    // Sanity: this is a NET-ZERO double-toggle (tasks/problems end up in the
    // same focus state they started in), so `settled` must be close to
    // `before` — a real difference here would mean the fixture itself is
    // wrong. NOT the basis for the assertion below (a self-referential bound
    // derived from before/settled is exactly what let a strictly-better
    // implementation score strictly worse under discrimination-sever review
    // in 885c40d's round 2 — see that commit's message for the full finding).
    expect(settled).toBeCloseTo(before, 0);

    // FRAME-TO-FRAME tx-DELTA CONTINUITY (the actual assertion). A
    // legitimate spring's transform-channel velocity is bounded and smooth;
    // the composition bug's signature is a STEP — the transform snaps by
    // hundreds of px within one rAF tick at the moment the second toggle
    // lands, then resumes ordinary spring motion from the new value.
    //
    // Threshold derived from this exact fixture (disposable diagnostic, not
    // guessed): a single UNINTERRUPTED toggle's own max frame-to-frame rate
    // measured 5.11px/ms. MAX_LEGIT_RATE_PER_MS is set to 20 — ~3.9x over
    // that measured legit max (same margin philosophy as 885c40d's own
    // ~4.2x-over-legit-max derivation) — and comfortably below the observed
    // bug spike (~68-80px/ms in this fixture, ~3.4-4x over this threshold on
    // the other side).
    const MAX_LEGIT_RATE_PER_MS = 20;
    const spikes: { from: (typeof samples)[number]; to: (typeof samples)[number]; rate: number }[] = [];
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1]!;
      const cur = samples[i]!;
      const dt = cur.t - prev.t;
      if (dt <= 0) continue;
      const rate = Math.abs(cur.tx - prev.tx) / dt;
      if (rate > MAX_LEGIT_RATE_PER_MS) {
        spikes.push({ from: prev, to: cur, rate });
      }
    }
    if (spikes.length > 0) {
      const worst = spikes.reduce((a, b) => (b.rate > a.rate ? b : a));
      const txTrace = samples.map((s) => `t=${s.t.toFixed(1)} x=${s.x.toFixed(2)} tx=${s.tx.toFixed(2)}`).join("\n");
      expect(
        spikes.length,
        `${spikes.length} frame-to-frame tx-delta spike(s) exceeded ${MAX_LEGIT_RATE_PER_MS}px/ms, worst: ` +
          `t=${worst.from.t.toFixed(1)}ms tx=${worst.from.tx.toFixed(2)} -> t=${worst.to.t.toFixed(1)}ms tx=${worst.to.tx.toFixed(2)} ` +
          `(${worst.rate.toFixed(2)}px/ms).\nFull trace:\n${txTrace}`,
      ).toBe(0);
    }

    // FRAME-TO-FRAME x-DELTA CONTINUITY — the gate's own highest-priority
    // fix. Once `layout` is removed, `chat` carries no transform channel of
    // its own at all (animate.x is 0 for a focused, non-in-between column),
    // so tx above trivially stays 0/identity every frame and the assertion
    // above is now STRUCTURALLY INCAPABLE of ever failing — it would pass
    // identically whether the corruption were dead or merely moved to a
    // channel this test doesn't look at. This assertion measures the REAL,
    // gBCR-painted position instead, which stays live regardless of which
    // channel (if any) drives it.
    //
    // Threshold derivation, NOT a reuse of MAX_LEGIT_RATE_PER_MS above (that
    // one is calibrated to tx's transform-spring velocity profile, not real
    // gBCR position deltas — reusing it would be exactly the self-
    // referential-bound mistake 885c40d's own commit message warns
    // against). This fixture has no clean "single uninterrupted toggle"
    // legit-rate baseline to measure the way tx's did (see the
    // "Evidence-state carryforward" investigation this session, 2026-07-30:
    // `chat`'s x-position teleports within a single frame even for ONE
    // toggle now — the current mechanism is a depth-deck position-mode
    // snap, disposition 4, not FLIP re-snapshotting — so a legit-rate
    // calibration would itself measure a snap). Threshold derived
    // analytically instead, from the same spring physics 885c40d's own
    // round-3 message used for its argued-not-measured leg (c): for this
    // fixture's ~571px transient amplitude, v ≈ amplitude·ω·0.6 (ω =
    // sqrt(stiffness/mass) = sqrt(300) ≈ 17.32 rad/s, 0.6 the same
    // underdamped-envelope scaling factor measured empirically on this
    // exact spring config in that investigation) ≈ 5.9px/ms for a
    // genuinely smooth transit of this distance. MAX_LEGIT_X_RATE_PER_MS
    // is set to 24 — ~4x over that analytical estimate, comfortably below
    // the observed disposition-4 snap rate (~57-71px/ms measured this
    // session on this exact fixture).
    //
    // Passing (ui#17 Slice 1, anchor/object restructure): disposition 4
    // (the depth-deck flex<->absolute position-mode transition) is fixed —
    // the anchor stays a permanent zero-footprint in-flow node (never
    // leaves flex), and the visible glass OBJECT's own position-mode flip
    // is provably zero-pixel by construction (the shared-origin geometric
    // argument this file's own zero-pixel-flip tests establish), so
    // there's no snap for this assertion to catch anymore.
    const MAX_LEGIT_X_RATE_PER_MS = 24;
    const xSpikes: { from: (typeof samples)[number]; to: (typeof samples)[number]; rate: number }[] = [];
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1]!;
      const cur = samples[i]!;
      const dt = cur.t - prev.t;
      if (dt <= 0) continue;
      const rate = Math.abs(cur.x - prev.x) / dt;
      if (rate > MAX_LEGIT_X_RATE_PER_MS) {
        xSpikes.push({ from: prev, to: cur, rate });
      }
    }
    if (xSpikes.length > 0) {
      const worst = xSpikes.reduce((a, b) => (b.rate > a.rate ? b : a));
      const xTrace = samples.map((s) => `t=${s.t.toFixed(1)} x=${s.x.toFixed(2)} tx=${s.tx.toFixed(2)}`).join("\n");
      expect(
        xSpikes.length,
        `${xSpikes.length} frame-to-frame x-delta spike(s) exceeded ${MAX_LEGIT_X_RATE_PER_MS}px/ms, worst: ` +
          `t=${worst.from.t.toFixed(1)}ms x=${worst.from.x.toFixed(2)} -> t=${worst.to.t.toFixed(1)}ms x=${worst.to.x.toFixed(2)} ` +
          `(${worst.rate.toFixed(2)}px/ms).\nFull trace:\n${xTrace}`,
      ).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ui#17 Slice 1: the "clicks-land" criterion, ported unchanged (per the
// plan's explicit instruction) from `885c40d`'s FINAL (round-3) shape — a
// user tracking a target button with their eyes aims a click at its
// legitimate, pre-transition (at-rest) screen position, and the target
// should still receive it even though a sibling-driven sweep carries it away
// mid-transition. Dispatches a real hit-tested click (`elementFromPoint` +
// `dispatchEvent`) at coordinates valid immediately before the transition —
// see 885c40d's own commit message for the three discrimination-sever
// findings that shaped this exact fixture design (target must be a
// bystander whose own focus never changes; must be swept by a genuine
// sibling-driven reflow, not just an animation artifact; position must be
// captured before EITHER toggle fires, not between them).
// ---------------------------------------------------------------------------

describe("Column transition gate: clicks land during a sibling focus toggle (ui#o9)", () => {
  test("a click aimed at the target's pre-transition position lands on the target, not wherever the sibling-driven sweep left it stranded", async () => {
    let targetClicked = false;

    function ClicksLandDemo() {
      const [detailFocused, setDetailFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle-detail" onClick={() => setDetailFocused((v) => !v)}>
            toggle
          </button>
          <Scene>
            <SceneColumn name="list">
              <SceneObject name="list-object" focused style={{ width: 200, height: "100%" }}>
                <div style={{ width: "100%", height: "100%" }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="detail">
              <SceneObject
                name="detail-object"
                focused={detailFocused}
                style={{ width: 300, height: "100%" }}
              >
                <div style={{ width: "100%", height: "100%" }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="chat">
              <SceneObject name="chat-object" focused style={{ width: 300, height: "100%" }}>
                <div data-testid="chat-content" style={{ width: "100%", height: "100%" }}>
                  <button
                    data-testid="chat-target"
                    onClick={() => {
                      targetClicked = true;
                    }}
                  >
                    target
                  </button>
                </div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<ClicksLandDemo />);
    await wait(600);

    const target = getByTestId("chat-target").element() as HTMLElement;
    const toggleBtn = getByTestId("toggle-detail").element() as HTMLElement;
    const scene = getByTestId("scene").element() as HTMLElement;

    // The target's TRUE resting position for the CURRENT committed state,
    // captured BEFORE either toggle below fires — see 885c40d's message for
    // why this is the only capture point that survives all three
    // discrimination-sever findings.
    const preRect = target.getBoundingClientRect();
    const clickX = preRect.x + preRect.width / 2;
    const clickY = preRect.y + preRect.height / 2;

    // Capture-phase document click listener records where the dispatched
    // click actually lands — direct precedent: repro package §3d.
    let landedOn = "none";
    const listener = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      landedOn = t ? `${t.tagName}[data-testid=${t.getAttribute("data-testid")}]` : "null";
    };
    document.addEventListener("click", listener, true);

    // The transition under test: unfocus "detail" (triggers the
    // sibling-driven sweep on "chat"), then — WITHOUT waiting for it to
    // settle — refocus it again, returning to the ORIGINAL committed state.
    toggleBtn.click();
    await wait(100); // mid-sweep, deliberately NOT settled
    toggleBtn.click();

    // ui#20 remap: a fixed 600ms wait (the pre-ui#20 value) is no longer
    // reliably long enough here — the interrupted-then-resettled double
    // toggle now also has to clear Scene-wide `transitionPending` (ui#20's
    // scene-wide inertness gate, which the settle counter's own claim/
    // retire sequence for this exact interrupted-transition shape can take
    // a little past 600ms to reach zero on), not just visually reach its
    // resting position. Poll on `data-ui-scene-settled` (bounded) instead of
    // guessing a duration — the click below is only meaningful once the
    // scene has genuinely gone quiet.
    for (let i = 0; i < 40 && scene.getAttribute("data-ui-scene-settled") !== "true"; i++) {
      await wait(50);
    }
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("true");

    // A real hit-tested click at fixed screen coordinates.
    const hitEl = document.elementFromPoint(clickX, clickY);
    hitEl?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: clickX, clientY: clickY }));

    document.removeEventListener("click", listener, true);

    expect(
      targetClicked,
      `click aimed at the target's pre-transition position (${clickX.toFixed(1)}, ${clickY.toFixed(1)}) ` +
        `landed on ${landedOn} instead of the target — the sibling-driven sweep had already carried ` +
        `the target away by the time the click dispatched`,
    ).toBe(true);
  });

  // Uninterrupted variant: each toggle is allowed to FULLY settle before
  // the next fires (unlike the test above, which interrupts mid-spring).
  // Guards the settle-signal mechanism itself (Scene.tsx's
  // SettleSignalContext) directly — a sibling column returning to focus
  // must leave the camera's own stageLeft at the TRUE settled position,
  // not a stale snapshot from the moment of the focus-toggle commit.
  // Tolerance derived empirically (5 repeated runs, both this scenario and
  // the interrupted one above, post-settle-signal-fix): observed deltas
  // ranged -1.56px to 2.69px — 5px gives real margin over that range while
  // staying two orders of magnitude tighter than the pre-fix failure mode
  // (86px measured for the interrupted case, 37-44px for this one).
  test("uninterrupted variant: a sibling column that fully settles before refocusing leaves the camera at the true position", async () => {
    function ClicksLandDemo() {
      const [detailFocused, setDetailFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle-detail" onClick={() => setDetailFocused((v) => !v)}>
            toggle
          </button>
          <Scene>
            <SceneColumn name="list">
              <SceneObject name="list-object" focused style={{ width: 200, height: "100%" }}>
                <div style={{ width: "100%", height: "100%" }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="detail">
              <SceneObject
                name="detail-object"
                focused={detailFocused}
                style={{ width: 300, height: "100%" }}
              >
                <div style={{ width: "100%", height: "100%" }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="chat">
              <SceneObject name="chat-object" focused style={{ width: 300, height: "100%" }}>
                <div data-testid="chat-content" style={{ width: "100%", height: "100%" }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<ClicksLandDemo />);
    await wait(600);

    const chatContent = getByTestId("chat-content").element() as HTMLElement;
    const preRect = chatContent.getBoundingClientRect();
    const toggleBtn = getByTestId("toggle-detail").element() as HTMLElement;

    toggleBtn.click();
    await wait(700); // fully settled (deck-entry spring)
    toggleBtn.click();
    await wait(700); // fully settled (refocus spring)

    const finalRect = chatContent.getBoundingClientRect();
    const delta = Math.abs(finalRect.left - preRect.left);

    expect(
      delta,
      `chat's settled position drifted ${delta.toFixed(2)}px from its pre-transition position ` +
        `after "detail" fully settled through an unfocus/refocus cycle — the camera's stageLeft ` +
        `should return to the true value once every owned channel signals settled`,
    ).toBeLessThan(5);
  });
});
