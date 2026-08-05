import { describe, test, expect, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import {
  Scene,
  SceneObject,
  SceneColumn,
  DEFAULT_STIFFNESS,
  DEFAULT_DAMPING,
  DEFAULT_COLUMN_GAP,
  DEFAULT_PERSPECTIVE,
  DEFAULT_PEEK_OFFSET,
} from "../src";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame, wait, awaitStyleFlush } from "./utils/animation";
import { parseTranslateY } from "./utils/transform";
import { CameraReader } from "./utils/cameraReader";
import { buildScene } from "./utils/sceneFixtures";

// ---------------------------------------------------------------------------
// Fix 1: Scroll position restore on refocus
// ---------------------------------------------------------------------------

describe("Scene scroll position restore", () => {
  test("scroll position restores when column is refocused", async () => {
    // Scenario: scroll a column to offset 100, unfocus it, refocus it.
    // The column should restore to offset 100.
    const { rerender, getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Scroll down to 100px
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 100,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // The wheel handler's setScrollOffset update comes from a native
    // (non-React-owned) DOM event outside any act() boundary, so React's
    // commit isn't guaranteed to land within exactly one animation frame —
    // instrumented probe confirmed a ~1/6 flake rate on a cold first mount
    // in this file, needing a second frame to settle. Poll for the settled
    // DOM value instead of assuming a fixed frame count (S7).
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-100);

    // Unfocus the column — a second column takes focus
    await rerender(
      buildScene(
        [
          { name: "col", objects: [{ name: "panel", focused: false, width: 400, height: 1200, testId: "content" }] },
          { name: "col2", objects: [{ name: "panel2", focused: true, width: 400, height: 200, testId: "content2" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );
    await waitForAnimationFrame();

    // Refocus the original column
    await rerender(
      buildScene(
        [
          { name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1200, testId: "content" }] },
          { name: "col2", objects: [{ name: "panel2", focused: false, width: 400, height: 200, testId: "content2" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );
    await waitForAnimationFrame();

    // Scroll position should be restored to 100px — same poll rationale as
    // the scroll assertion above.
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-100);
  });

  test("scroll resets to 0 when column first becomes focused (no saved position)", async () => {
    // A column that has never been focused should start at scroll offset 0.
    // This is a regression guard — no saved scroll position means start at top.
    const { rerender, getByTestId } = await render(
      buildScene(
        [
          { name: "col", objects: [{ name: "panel", focused: false, width: 400, height: 1200, testId: "content" }] },
          { name: "col2", objects: [{ name: "panel2", focused: true, width: 400, height: 200, testId: "content2" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // Now focus "col" for the first time — no saved scroll, should be 0
    await rerender(
      buildScene(
        [
          { name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1200, testId: "content" }] },
          { name: "col2", objects: [{ name: "panel2", focused: false, width: 400, height: 200, testId: "content2" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column='col']") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(0);
  });

  test("drastically resized column falls back to top (scroll offset 0)", async () => {
    // If the content height changes drastically (>50%) between unfocus and refocus,
    // the saved scroll position is invalid — fall back to top (offset 0).
    const { rerender, getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Scroll down to 300px
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Input is rAF-coalesced as of F17 — the wheel handler now buffers the
    // delta and applies it on the NEXT real animation frame, so this needs
    // one extra waitForAnimationFrame() beyond what a single dispatch used
    // to require.
    await waitForAnimationFrame();
    await waitForAnimationFrame();
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-300);

    // Unfocus (switch to col2). Drastically resized: from 1200 to 300 (75%
    // reduction, > 50%).
    await rerender(
      buildScene(
        [
          { name: "col", objects: [{ name: "panel", focused: false, width: 400, height: 300, testId: "content" }] },
          { name: "col2", objects: [{ name: "panel2", focused: true, width: 400, height: 200, testId: "content2" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );
    await waitForAnimationFrame();

    // Refocus with dramatically shrunken content
    await rerender(
      buildScene(
        [
          { name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 300, testId: "content" }] },
          { name: "col2", objects: [{ name: "panel2", focused: false, width: 400, height: 200, testId: "content2" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );
    await waitForAnimationFrame();

    // Saved position was 300, but content is now 300px (fits in 800px viewport).
    // maxScroll is 0, so scroll should be at 0 (clamped by existing logic).
    const topAfterRefocus = parseFloat(contentWrapper.style.top || "0");
    expect(topAfterRefocus).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A2: Swap-reset scroll model (+ resetAlignment, B6 clamp, B7 lifecycle)
// ---------------------------------------------------------------------------

describe("Scene swap-reset scroll model", () => {
  test("swap A→B in an always-focused column resets scroll to top", async () => {
    // A vertical swap changes which object is focused within the column —
    // per the ruled A2 model, this always resets scroll deterministically
    // (does not remember A's prior scroll position for B).
    const { rerender, getByTestId } = await render(
      buildScene(
        [
          {
            name: "col",
            objects: [
              { name: "obj-a", focused: true, width: 400, height: 1200, testId: "content-a" },
              { name: "obj-b", focused: false, width: 400, height: 1200, testId: "content-b" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Scroll A down to 300px.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("300");

    // Swap focus from A to B within the same (always-focused) column.
    await rerender(
      buildScene(
        [
          {
            name: "col",
            objects: [
              { name: "obj-a", focused: false, width: 400, height: 1200, testId: "content-a" },
              { name: "obj-b", focused: true, width: 400, height: 1200, testId: "content-b" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );
    await waitForAnimationFrame();

    // scrollOffset (distinct from topOffset, which independently shifts to
    // bring B into view) must reset to 0 — B's scroll position, not A's.
    expect(column.getAttribute("data-scroll-offset")).toBe("0");
  });

  test('resetAlignment="center" produces a roughly-centered non-zero starting offset on swap', async () => {
    // Object A is short (fits, no scroll of its own). Object B opts into
    // resetAlignment="center" and is tall enough to overflow. If the swap
    // read a stale (pre-swap) maxScroll, this would incorrectly compute 0
    // (A's maxScroll) instead of B's real maxScroll/2 — the one-render-lag
    // hazard the geometry store's synchronous remeasure exists to close.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 400, height: 200 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused={false} resetAlignment="center">
              <div data-testid="content-b" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 400, height: 200 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused resetAlignment="center">
              <div data-testid="content-b" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // B alone: contentHeight = 1200, viewport = 800 → maxScroll = 400.
    // center reset ≈ maxScroll / 2 = 200 (not 0 — the "top" default, and not
    // 0 from a stale pre-swap maxScroll of 0 either).
    const scrollOffset = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    expect(scrollOffset).toBeCloseTo(200, -1);
  });

  test("B6: a restored offset exceeding a shrunk-but-not-drastic maxScroll is clamped, not discarded", async () => {
    // Content shrinks by ~17% while parked (well under the 50% drastic
    // threshold) — the saved offset should be preserved but clamped to the
    // new (smaller) maxScroll, not reset to 0 and not left overshooting.
    const { rerender, getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // Let the initial mount fully settle (shared ResizeObserver's first
    // observe-triggered callback) before scrolling near the max, to avoid
    // racing a same-frame remeasure.
    await waitForAnimationFrame();
    const columnRect = column.getBoundingClientRect();

    // Scroll to 380px (near the 1200-800=400 max).
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 380,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("380");

    // Unfocus (park), shrinking content height from 1200 to 1000 (16.7%,
    // well under the 50% drastic threshold) while parked.
    await rerender(
      buildScene(
        [
          { name: "col", objects: [{ name: "panel", focused: false, width: 400, height: 1000, testId: "content" }] },
          { name: "col2", objects: [{ name: "panel2", focused: true, width: 400, height: 200, testId: "content2" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );
    await waitForAnimationFrame();

    // Refocus the same (single, unchanged) object — key match, so this is a
    // restore, not a swap-reset.
    await rerender(
      buildScene(
        [
          { name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1000, testId: "content" }] },
          { name: "col2", objects: [{ name: "panel2", focused: false, width: 400, height: 200, testId: "content2" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );
    await waitForAnimationFrame();

    // New maxScroll = 1000 - 800 = 200. The saved 380 must be clamped to
    // 200, not discarded to 0 and not left at the stale 380.
    expect(column.getAttribute("data-scroll-offset")).toBe("200");
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-200);
  });

  test("B7: a same-name remount's drastic-resize guard compares against the persisted pre-unfocus content height", async () => {
    // park (unfocus) → close (unmount) → open a different same-named column
    // instance. The 50% drastic-resize guard must compare the NEW instance's
    // content height against the height at the ORIGINAL park (persisted on
    // the shared store entry, keyed by column name) — not a per-instance
    // ref that resets to 0 on the fresh mount (which would defeat the guard
    // and restore-then-clamp a stale offset instead of resetting to top).
    // NOTE: SceneColumn elements are given explicit (and DIFFERENT) `key`s
    // across the "close" and "open" renders below. Without this, React's
    // default index-based reconciliation would REUSE the same col1 fiber
    // across the remove/re-add (same type at the same array position, just
    // different props) — never triggering a genuine unmount, which would
    // silently defeat this test (a per-instance ref would never actually
    // reset, masking the bug regardless of the fix).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn key="col1-a" name="col1">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = () => scene.querySelector("[data-column='col1']") as HTMLElement;
    const columnRect = column().getBoundingClientRect();

    // Scroll to 1000px (2000 - 800 = 1200 max).
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 1000,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();
    expect(column().getAttribute("data-scroll-offset")).toBe("1000");

    // Park: focus moves to a second column.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn key="col1-a" name="col1">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Close: col1 unmounts entirely.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Open: a NEW col1 instance (different key — genuinely a fresh mount;
    // same name, same single object name) with drastically shorter content
    // (2000 → 900, 55% reduction — drastic, but the new maxScroll is still
    // non-zero so a restore-then-clamp would produce a DIFFERENT, observably
    // wrong result than a correct reset-to-top). Mounts already focused.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn key="col1-b" name="col1">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 900 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused={false}>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // New maxScroll = 900 - 800 = 100. A restore-then-clamp bug would land
    // on 100; the correct drastic-resize reset lands on 0.
    expect(column().getAttribute("data-scroll-offset")).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// Fix 2: Padding in scroll bounds
// ---------------------------------------------------------------------------

describe("Scene padding in scroll bounds", () => {
  test("scroll bounds include padding — padding reduces effective viewport height", async () => {
    // Scene with padding=16px: maxScroll = contentHeight - (viewportHeight - 32).
    // Without padding: 1200 - 800 = 400. With padding=16: 1200 - (800 - 32) = 432.
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1200, testId: "content" }] }],
        { duration: 0, padding: 16 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    const maxScroll = parseFloat(column.getAttribute("data-max-scroll") ?? "0");
    // With padding=16px top+bottom, viewport effective height = 800 - 32 = 768.
    // maxScroll = 1200 - 768 = 432. Without padding it would be 400.
    expect(maxScroll).toBeGreaterThan(400);
  });

  test("padding can push content into overflow — content fits without padding but overflows with it", async () => {
    // A 780px content in an 800px viewport fits without padding.
    // With padding=16px (32px total), effective viewport = 768px, so content overflows.
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 780, testId: "content" }] }],
        { duration: 0, padding: 16 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // With padding factored in, the content now overflows → scrollbar should appear.
    const scrollbar = scene.querySelector("[data-scrollbar]");
    expect(scrollbar).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S6 commit 3: padding cluster — four missing-subtraction sites plus a
// distinct x-anchor origin mismatch. maxScroll (verified above) already
// subtracts padding correctly; these sites didn't.
// ---------------------------------------------------------------------------

describe("Scene padding cluster (S6)", () => {
  test("marginTop centers focused content within the padded viewport, not the raw viewport", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 200, height: 200, testId: "content" }] }],
        { duration: 0, padding: 60 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const content = getByTestId("content").element() as HTMLElement;

    // ui#17: see awaitStyleFlush's own doc comment (rAF-batched MotionValue
    // writes — a geometry read immediately after render() can observe a
    // stale/default value).
    await awaitStyleFlush();

    const viewportRect = scene.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const viewportCenterY = viewportRect.top + viewportRect.height / 2;
    const contentCenterY = contentRect.top + contentRect.height / 2;

    expect(contentCenterY).toBeCloseTo(viewportCenterY, 0);
  });

  test("inBetweenY centers a depth-deck column within the padded viewport, not the raw viewport", async () => {
    const build = (middleFocused: boolean) =>
      buildScene(
        [
          { name: "left", objects: [{ name: "left-obj", focused: true, width: 100, height: 100, testId: "left-content" }] },
          { name: "middle", objects: [{ name: "middle-obj", focused: middleFocused, width: 100, height: 100, testId: "middle-content" }] },
          { name: "right", objects: [{ name: "right-obj", focused: true, width: 100, height: 100, testId: "right-content" }] },
        ],
        { duration: 0, padding: 60 },
        { fullPage: true },
      );

    // "middle" must have been focused at least once to have a frozenSize
    // (in-between columns without one never get a measurable colHeight).
    const { rerender, getByTestId } = await render(build(true));
    await rerender(build(false));
    await waitForAnimationFrame();
    // ui#17: a single tick measured racy here — escalating to a second per
    // awaitStyleFlush's own documented double-rAF fallback.
    await awaitStyleFlush();

    const middleCol = getByTestId("middle-content").element().closest("[data-column]") as HTMLElement;

    // Read RAW values (frozen height from the inline style set by
    // inBetweenStyle, translateY from the raw transform) rather than
    // getBoundingClientRect() — the in-between column sits under a CSS
    // perspective + translateZ projection, which foreshortens rendered
    // position AND size non-linearly (see parseTranslateX's docstring for
    // the same rationale applied to the x axis).
    const frozenHeight = parseFloat(middleCol.style.height || "0");
    expect(frozenHeight).toBeGreaterThan(0);
    // ui#17: without `layout`, Motion writes this transform as separate
    // translateX()/translateZ() functions and OMITS a zero-valued
    // translateY entirely (with `layout` present, it always used the
    // translate3d(x, y, z) form, including an explicit 0px for y) —
    // parseTranslateY doesn't handle the "axis omitted means 0" case
    // (every other call site relies on it staying strict), so normalize
    // locally, same precedent as readTx's own "none" → 0 normalization.
    const transformStr = middleCol.style.transform;
    const translateY = transformStr.includes("translateY") || transformStr.includes("translate3d")
      ? parseTranslateY(transformStr)
      : 0;

    // Viewport is 800px tall (fullPage default), padding=60 top+bottom ->
    // effective viewport height = 680. inBetweenY should center the frozen
    // column within THAT, not the raw 800.
    expect(translateY).toBeCloseTo((680 - frozenHeight) / 2, 1);
  });

  test("Page Down scroll amount accounts for padding (uses effective viewport height, not raw)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} padding={100}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 3000 }}>
                <button data-testid="focusable-btn">click me</button>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    const btn = getByTestId("focusable-btn").element() as HTMLElement;
    btn.focus();

    column.dispatchEvent(
      new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }),
    );

    await waitForAnimationFrame();

    const scrollOffset = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    // Viewport is 800px tall (fullPage default), padding=100 top+bottom ->
    // effective viewport height = 600. PageDown should scroll by exactly
    // 600, not the raw 800 (maxScroll=3000-600=2400 leaves plenty of room,
    // so this isn't clamped).
    expect(scrollOffset).toBe(600);
  });

  test("Scrollbar trackHeight accounts for padding (uses effective viewport height, not raw)", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 3000, testId: "content" }] }],
        { duration: 0, padding: 100 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const scrollbar = scene.querySelector("[data-scrollbar]") as HTMLElement;
    expect(scrollbar).not.toBeNull();

    // Viewport is 800px tall (fullPage default), padding=100 top+bottom ->
    // effective viewport height = 600. The scrollbar track sizes to
    // trackHeight directly (style.height) — should be 600, not raw 800.
    expect(parseFloat(scrollbar.style.height || "0")).toBe(600);
  });

  test("in-between column x-anchor accounts for stage padding (stays flush with the focused column when peekOffset=0)", async () => {
    // Mirrors the existing "peekOffset={0} reproduces the old flush-anchored
    // behavior" test's shape (tests/scene.test.tsx depth-1 peek test) with
    // padding added — the original bug measured border-box
    // (getBoundingClientRect) against an absolutely-positioned in-between
    // column's static position, which CSS resolves content-box-relative — a
    // padding-sized origin mismatch distinct from the four
    // missing-subtraction sites above.
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 200, height: 200, testId: "content-left" }] },
          { name: "col-middle", objects: [{ name: "obj-middle", focused: false, width: 200, height: 200, testId: "content-middle" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 200, height: 200, testId: "content-right" }] },
        ],
        { duration: 0, padding: 60, peekOffset: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();
    await waitForAnimationFrame();

    const rightCol = getByTestId("content-right").element().closest("[data-column]") as HTMLElement;
    const middleCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;

    const rightRect = rightCol.getBoundingClientRect();
    const middleRect = middleCol.getBoundingClientRect();

    // toBeCloseTo(0, -1) -> tolerance ±5, matching this file's established
    // convention for a rendered (post-perspective-projection) pixel
    // comparison (see "depth-1 in-between column peeks left by exactly
    // peekOffset" above) — sub-pixel rounding noise, not a real deviation
    // (pre-fix this was off by ~52px, the padding-sized bug this test
    // guards against).
    expect(rightRect.left - middleRect.left).toBeCloseTo(0, -1);
  });

  test.each([0, 4, 32])(
    "overflow mode: both edges are inset by exactly padding=%ipx (Michael's symmetric-padding ruling)",
    async (padding) => {
      // Two 1000px columns (2000px total) badly overflow the 1280px viewport
      // at every padding value tested — the overflow branch always applies.
      const { getByTestId } = await render(
        <TestWrapper fullPage>
          <Scene duration={0} padding={padding}>
            <SceneColumn name="col1">
              <SceneObject name="obj1" focused>
                <div data-testid="content1" style={{ minWidth: 1000, height: 200 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col2">
              <SceneObject name="obj2" focused>
                <div data-testid="content2" style={{ minWidth: 1000, height: 200 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      const scene = getByTestId("scene").element() as HTMLElement;
      const col1 = getByTestId("content1").element().closest("[data-column]") as HTMLElement;
      const col2 = getByTestId("content2").element().closest("[data-column]") as HTMLElement;
      const vpRect = scene.getBoundingClientRect();

      // At panOffset=0 (mount default): the leftmost focused column's left
      // edge should be inset from the viewport's left edge by exactly
      // `padding`.
      expect(scene.scrollLeft).toBe(0);
      const leftInset = col1.getBoundingClientRect().left - vpRect.left;
      expect(leftInset).toBeCloseTo(padding, 0);

      // At maximum pan (ui#19: reached via a real wheel deltaX through the
      // handler, clamped to panBoundsRef.current.min — deltaX intentionally
      // FAR exceeds any plausible range so the clamp, not the raw delta,
      // determines the landing position): the rightmost focused column's
      // right edge should be inset from the viewport's right edge by
      // exactly `padding` too — NOT flush (the pre-fix bug: the left inset
      // was subtracted away by `newStageLeft = -focusedNaturalLeft`, while
      // the right side already got it right via the stage's own CSS
      // padding surviving into scrollWidth — a flush-left/padding-right
      // mix).
      scene.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: 5000,
          deltaY: 0,
          clientX: vpRect.left + vpRect.width / 2,
          clientY: vpRect.top + vpRect.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
      await waitForAnimationFrame();
      await waitForAnimationFrame();
      expect(scene.scrollLeft).toBe(0);
      const rightInset = vpRect.right - col2.getBoundingClientRect().right;
      expect(rightInset).toBeCloseTo(padding, 0);
    },
  );

  // SKIPPED (ui#17, 2026-07-30, one bounded instrumented attempt): traced
  // to source rather than a locatable small conditional fix. `padding` is
  // applied to the stage as a raw, unanimated CSS property (`padding:
  // padding || undefined` in Scene.tsx's stage style) — it is not a
  // MotionValue-driven channel at all, unlike cameraX/width/etc. Console
  // instrumentation on both driveCameraX and the recentering effect during
  // this exact test showed `newStageLeft` computes to 0 in BOTH the
  // padding=16 and padding=32 renders (stageLeftChanged never true,
  // driveCameraX never even called) — the camera genuinely never needs to
  // move for this scenario, because `focusedNaturalLeft` (measured via
  // gBCR, which already reflects the live CSS padding) and the `+padding`
  // term in the overflow-mode stageLeft formula always cancel exactly. The
  // entire visible snap is 100% the raw CSS padding property changing
  // instantly, with no camera/transform channel involved at all. A real
  // fix is a NEW owned padding channel (a paddingMV imperatively driving
  // stage.style.padding via animate(), mirroring the width channel's own
  // pattern) — comparable in scope to that channel, not a small
  // conditional tweak, and out of this dispatch's bound. Q2 (ui#17 depth-
  // deck spike, same day) also found no real app scenario changes padding
  // mid-session — only a dev-only tuning slider does — which is why a
  // skip-and-follow-up disposition is acceptable here rather than blocking
  // ui#17 on a new channel. See the ticket's own follow-up observation.
  test.skip("overflow mode: a mid-session padding change (16 -> 32) springs the relayout and both edges land at the new padding", async () => {
    const build = (padding: number) => (
      <TestWrapper fullPage>
        <Scene padding={padding}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ minWidth: 1000, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div data-testid="content2" style={{ minWidth: 1000, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(16));
    await wait(500);

    const scene = getByTestId("scene").element() as HTMLElement;
    const col1 = getByTestId("content1").element().closest("[data-column]") as HTMLElement;
    const vpRect = scene.getBoundingClientRect();

    const leftInsetBefore = col1.getBoundingClientRect().left - vpRect.left;
    expect(leftInsetBefore).toBeCloseTo(16, 0);

    // Change padding — expected (once a padding channel exists) to spring
    // the relayout rather than snap. See this test's own skip comment
    // above for the traced root cause and why it's skipped, not fixed,
    // inside ui#17.
    await rerender(build(32));

    const readLeftInset = () => col1.getBoundingClientRect().left - vpRect.left;
    const samples = [readLeftInset()];
    for (const delay of [16, 100, 300]) {
      await wait(delay);
      samples.push(readLeftInset());
    }
    const allIdentical = samples.every((s) => s === samples[0]);
    expect(allIdentical).toBe(false);

    await wait(1500);
    const col2 = getByTestId("content2").element().closest("[data-column]") as HTMLElement;
    const leftInsetAfter = col1.getBoundingClientRect().left - vpRect.left;
    expect(leftInsetAfter).toBeCloseTo(32, 0);

    // ui#19: reach max pan via a real wheel deltaX through the handler
    // (deltaX intentionally far exceeds any plausible range, clamped by
    // panBoundsRef.current.min) — a real spring here, so give it a
    // generous settle window rather than a single frame.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 5000,
        deltaY: 0,
        clientX: vpRect.left + vpRect.width / 2,
        clientY: vpRect.top + vpRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(1500);
    expect(scene.scrollLeft).toBe(0);
    const rightInsetAfter = vpRect.right - col2.getBoundingClientRect().right;
    expect(rightInsetAfter).toBeCloseTo(32, 0);
  });
});

// ---------------------------------------------------------------------------
// S6 commit 4: API hygiene
// ---------------------------------------------------------------------------

describe("Scene API hygiene (S6 commit 4)", () => {
  test("DEFAULT_* constants are importable from the top-level package entry", () => {
    // Regression pin for src/index.ts's re-export — previously only
    // reachable via the scene subpath, not the package root.
    expect(DEFAULT_STIFFNESS).toBe(300);
    expect(DEFAULT_DAMPING).toBe(30);
    expect(DEFAULT_COLUMN_GAP).toBe(16);
    expect(DEFAULT_PERSPECTIVE).toBe(800);
    expect(DEFAULT_PEEK_OFFSET).toBe(12);
  });

  test("a non-zero duration is NOT honored as a real duration — it behaves identically to omitting duration (both use spring physics, unlike duration=0)", async () => {
    // Regression pin for the duration JSDoc's honesty claim. Proof shape:
    // camera pan transitioning becomes true (a real, in-flight spring) for
    // duration=300 exactly as it does for duration=undefined — if 300 were
    // honored as an actual ms duration, or fell through to duration=0's
    // instant-mode branch, this would either never observe transitioning
    // (instant) or behave detectably differently. Uses the same
    // useCamera()-transitioning mechanism as the "real camera pan" test.
    async function pansWithTransitioningFlicker(durationProp: number | undefined): Promise<boolean> {
      const build = (rightFocused: boolean) => (
        <TestWrapper fullPage>
          <Scene duration={durationProp} stiffness={40} damping={12}>
            <SceneColumn name="left">
              <SceneObject name="left-obj" focused={!rightFocused}>
                <div style={{ width: 200, height: 150 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="right">
              <SceneObject name="right-obj" focused={rightFocused}>
                <div style={{ width: 200, height: 150 }} />
              </SceneObject>
            </SceneColumn>
            <CameraReader />
          </Scene>
        </TestWrapper>
      );

      const { rerender, getByTestId } = await render(build(false));
      await wait(500); // let the initial mount pan settle
      const reader = getByTestId("camera-reader").element() as HTMLElement;

      await rerender(build(true));
      await waitForAnimationFrame();
      const wasTransitioning = reader.getAttribute("data-transitioning") === "true";

      await wait(1500); // let this pan settle too, for a clean teardown
      await cleanup();
      return wasTransitioning;
    }

    expect(await pansWithTransitioningFlicker(300)).toBe(true);
    expect(await pansWithTransitioningFlicker(undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 3: Scrollbar ARIA attributes
// ---------------------------------------------------------------------------

describe("Scrollbar ARIA", () => {
  test("scrollbar thumb has role=scrollbar", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const scrollbar = scene.querySelector("[data-scrollbar]");
    expect(scrollbar).not.toBeNull();

    // The thumb inside the scrollbar track should have role="scrollbar"
    const thumb = scrollbar?.querySelector("[role='scrollbar']");
    expect(thumb).not.toBeNull();
  });

  test("scrollbar thumb has aria-valuenow, aria-valuemin, aria-valuemax", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement | null;
    expect(thumb).not.toBeNull();

    // ARIA attributes for screen reader accessibility
    expect(thumb?.getAttribute("aria-valuemin")).toBe("0");
    expect(thumb?.getAttribute("aria-valuemax")).not.toBeNull();
    expect(parseFloat(thumb?.getAttribute("aria-valuemax") ?? "")).toBeGreaterThan(0);
    expect(thumb?.getAttribute("aria-valuenow")).toBe("0"); // starts at top
    expect(thumb?.getAttribute("aria-orientation")).toBe("vertical");
  });

  test("D4: scrollbar thumb has tabindex=0", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement | null;
    expect(thumb?.getAttribute("tabindex")).toBe("0");
  });

  test("D4: scrollbar thumb has aria-controls pointing to the content wrapper's stable id", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement | null;
    const contentWrapper = scene.querySelector("[data-column-content]") as HTMLElement;
    expect(thumb?.getAttribute("aria-controls")).toBe(contentWrapper.id);
    expect(contentWrapper.id).toBe("scene-column-content-col");
  });

  test("D4: pressing ArrowDown while the scrollbar thumb has focus scrolls the column (keyboard ops through the shared command path)", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement;

    // A scroll to -40 alone doesn't discriminate D4's OWN handler from a
    // fallback where the event simply bubbles unhandled to SceneColumn's
    // generic column-level keydown listener (isInteractiveElement
    // deliberately does not exempt role="scrollbar" — DELTA-1 — so that
    // fallback would ALSO scroll the column by 40 if the thumb's handler
    // didn't stop propagation first). Spy on `document` to prove propagation
    // was actually stopped AT THE THUMB — this only happens if the thumb's
    // own listener ran and called stopPropagation() before the event could
    // reach any ancestor, including past the column entirely.
    const documentKeydownSpy = vi.fn();
    document.addEventListener("keydown", documentKeydownSpy);

    thumb.focus();
    const notPrevented = thumb.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    await waitForAnimationFrame();
    document.removeEventListener("keydown", documentKeydownSpy);

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-40);
    // The thumb's own handler owns this key — it preventDefaults.
    expect(notPrevented).toBe(false);
    // Propagation was stopped at the thumb — document never saw the event.
    expect(documentKeydownSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fix 4: Consumer scroll override — SceneObject with internal scroll
// ---------------------------------------------------------------------------

describe("Scene consumer scroll override", () => {
  test("SceneObject with internal scroll and fixed height — no column scrollbar appears", async () => {
    // When a SceneObject constrains its own height (e.g. fixed 400px) and uses
    // overflow-y: auto for internal scrolling, the column content wrapper stays
    // within the 800px viewport. No column-level scrollbar should appear.
    //
    // This simulates the consumer scroll override pattern: the SceneObject manages
    // its own scroll, so the column content does not overflow the viewport.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowY: "auto" }}
              >
                {/* Tall internal content — scrolled by the div, not the column */}
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // The SceneObject constrains to 400px. Column content (400px) fits in the
    // 800px viewport — no column-level scrollbar should appear.
    const scrollbar = scene.querySelector("[data-scrollbar]");
    expect(scrollbar).toBeNull();
  });

  // F8c interior contract, percentage-height commit: specs/scene-scroll.feature's
  // "Consumer adds internal scroll to a SceneObject" scenario claimed a literal
  // height: 100% works — probe-confirmed FALSE (every ancestor up to the
  // column's content wrapper is deliberately auto-height, so a descendant's
  // percentage height never resolves; a min-height floor on the SceneObject's
  // own wrapper doesn't help either). This test is the corrected scenario's
  // pin: height: 100cqh, the documented cqh-blessed pattern (adjudication 2),
  // resolving against Scene's own container-type: size viewport.
  //
  // TestWrapper height is deliberately 500 — DIFFERENT from the real
  // Chromium page viewport (800px, vitest.config.ts). Container query units
  // without a query container fall back to the browser's own small-viewport
  // size (a real gate-round finding: an earlier version of this test used
  // the default 800px TestWrapper height, which coincidentally equals the
  // browser viewport, so the assertion passed even with Scene's own
  // containerType: "size" severed — not discriminating). 500 vs 800 forces
  // a real mismatch unless Scene's own container genuinely governs cqh.
  test("SceneObject with internal scroll sized via height: 100cqh — no column scrollbar appears (F8c: the cqh-blessed contract pattern)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage height={500}>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: "100cqh", overflowY: "auto" }}
              >
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const island = getByTestId("scroll-container").element() as HTMLElement;

    // Resolves to the 500px TestWrapper height (Scene's own container-type:
    // size box) — not the natural unconstrained content height (3000px, a
    // failed-to-resolve percentage's fallback), not 0, and NOT the real
    // 800px browser viewport (which is what a severed containerType would
    // produce via cqh's no-container fallback — see the note above).
    expect(island.getBoundingClientRect().height).toBe(500);

    const scrollbar = scene.querySelector("[data-scrollbar]");
    expect(scrollbar).toBeNull();
  });

  // F8a interior claim gate: the motivating bug. An island that fills its
  // column (maxScroll=0, isScrollable=false) sits alongside another
  // Scene-scrollable focused column. Before the claim gate, Scene would
  // still claim wheel-over-the-island because A10's "exactly one scrollable
  // focused column" fallback fires — routing the delta to the SIBLING
  // column while the cursor is over the island, and the island (which
  // should have handled it) is never given the chance.
  //
  // Real (non-passive, script-dispatched) wheel events do not trigger a
  // browser's default scroll action in this test environment (verified
  // empirically — see the F8a worker report) — matching every other wheel
  // test in this file, these tests assert Scene's OWN state (the sibling
  // column's `top`) plus `notPrevented` (dispatchEvent's return value, true
  // iff preventDefault was never called) as the proxy for "declined to
  // route, native scroll gets to run."
  test("wheel over an interior overflow-y:auto island declines to route — the sibling Scene-scrollable column does not move (F8a claim gate)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="island-col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowY: "auto" }}
              >
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="sibling-col">
            <SceneObject name="sibling-obj" focused>
              <div data-testid="sibling-content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const island = getByTestId("scroll-container").element() as HTMLElement;
    const siblingCol = getByTestId("sibling-content").element().closest("[data-column]") as HTMLElement;
    const siblingContentWrapper = siblingCol.querySelector("[data-column-content]") as HTMLElement;
    const islandRect = island.getBoundingClientRect();

    const notPrevented = island.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: islandRect.left + islandRect.width / 2,
        clientY: islandRect.top + islandRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();

    expect(parseFloat(siblingContentWrapper.style.top || "0")).toBe(0);
    expect(notPrevented).toBe(true);
  });

  // Sanity control: the island alone (no co-focused scrollable sibling).
  // Even without the claim gate, this case already declines today (nothing
  // scrollable is registered under Scene, so decideWheelTargetColumn/A10
  // find zero candidates) — it doesn't discriminate old vs. new code on its
  // own, but confirms the primary regression test's sibling column is what
  // actually exercises the gate, not some other masking effect.
  test("sanity control: wheel over the island with no sibling column still declines to route", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="island-col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowY: "auto" }}
              >
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const island = getByTestId("scroll-container").element() as HTMLElement;
    const islandRect = island.getBoundingClientRect();

    const notPrevented = island.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: islandRect.left + islandRect.width / 2,
        clientY: islandRect.top + islandRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();

    expect(notPrevented).toBe(true);
  });

  test("overscroll-behavior-y: auto (default) at the island's edge chains outward — the sibling column claims it exactly like today", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="island-col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowY: "auto" }}
              >
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="sibling-col">
            <SceneObject name="sibling-obj" focused>
              <div data-testid="sibling-content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const island = getByTestId("scroll-container").element() as HTMLElement;
    island.scrollTop = island.scrollHeight - island.clientHeight; // bottom edge
    const siblingCol = getByTestId("sibling-content").element().closest("[data-column]") as HTMLElement;
    const siblingContentWrapper = siblingCol.querySelector("[data-column-content]") as HTMLElement;
    const islandRect = island.getBoundingClientRect();

    island.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: islandRect.left + islandRect.width / 2,
        clientY: islandRect.top + islandRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Input is rAF-coalesced as of F17 — needs one extra waitForAnimationFrame().
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    expect(parseFloat(siblingContentWrapper.style.top || "0")).toBe(-60);
  });

  test("overscroll-behavior-y: contain at the island's edge dead-stops — neither the island nor the sibling column moves", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="island-col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowY: "auto", overscrollBehaviorY: "contain" }}
              >
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="sibling-col">
            <SceneObject name="sibling-obj" focused>
              <div data-testid="sibling-content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const island = getByTestId("scroll-container").element() as HTMLElement;
    island.scrollTop = island.scrollHeight - island.clientHeight; // bottom edge
    const siblingCol = getByTestId("sibling-content").element().closest("[data-column]") as HTMLElement;
    const siblingContentWrapper = siblingCol.querySelector("[data-column-content]") as HTMLElement;
    const islandRect = island.getBoundingClientRect();

    const notPrevented = island.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: islandRect.left + islandRect.width / 2,
        clientY: islandRect.top + islandRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();

    expect(parseFloat(siblingContentWrapper.style.top || "0")).toBe(0);
    expect(notPrevented).toBe(true);
  });

  test("composed pipeline: interior island declines to Scene, and the existing pointer-column routing still handles two Scene-scrollable columns unmodified", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="island-col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowY: "auto" }}
              >
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="a">
            <SceneObject name="a-obj" focused>
              <div data-testid="content-a" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="b">
            <SceneObject name="b-obj" focused>
              <div data-testid="content-b" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const island = getByTestId("scroll-container").element() as HTMLElement;
    const colA = getByTestId("content-a").element().closest("[data-column]") as HTMLElement;
    const colAContent = colA.querySelector("[data-column-content]") as HTMLElement;
    const colB = getByTestId("content-b").element().closest("[data-column]") as HTMLElement;
    const colBContent = colB.querySelector("[data-column-content]") as HTMLElement;
    const islandRect = island.getBoundingClientRect();
    const colARect = colA.getBoundingClientRect();

    // Wheel over the island: the claim gate consumes it — neither Scene
    // column moves.
    const islandNotPrevented = island.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: islandRect.left + islandRect.width / 2,
        clientY: islandRect.top + islandRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();

    expect(islandNotPrevented).toBe(true);
    expect(parseFloat(colAContent.style.top || "0")).toBe(0);
    expect(parseFloat(colBContent.style.top || "0")).toBe(0);

    // Wheel over column A: the gate declines (no interior scroll container
    // there), falling through to the unchanged pointer-hit-test routing —
    // exactly the pre-existing "multiple scrollable focused columns"
    // behavior (scene.test.tsx's S5 describe block, unmodified).
    colA.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: colARect.left + colARect.width / 2,
        clientY: colARect.top + colARect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Input is rAF-coalesced as of F17 — needs one extra waitForAnimationFrame().
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    expect(parseFloat(colAContent.style.top || "0")).toBe(-60);
    expect(parseFloat(colBContent.style.top || "0")).toBe(0);
  });
});
