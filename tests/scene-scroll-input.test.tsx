import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { TestWrapper } from "./test-wrapper";
import { wait, waitForAnimationFrame, createMotionSeamRecorder } from "./utils/animation";
import { buildScene } from "./utils/sceneFixtures";
import { MotionSeamContext } from "../src/components/scene/motionSeam";

// ---------------------------------------------------------------------------
// Phase 5c: Keyboard scroll + scroll position management
// ---------------------------------------------------------------------------

describe("Scene keyboard scroll", () => {
  test("Page Down scrolls column containing keyboard focus by viewport height", async () => {
    // When the user presses Page Down while keyboard focus is inside a focused
    // column, the column should scroll by approximately one viewport height.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }}>
                {/* A focusable element so keyboard focus can land inside */}
                <button data-testid="focusable-btn">click me</button>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // Focus an element inside the column so keyboard events route there
    const btn = getByTestId("focusable-btn").element() as HTMLElement;
    btn.focus();

    // Before: top should be 0
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(0);

    // Dispatch Page Down on the column
    column.dispatchEvent(
      new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }),
    );

    await waitForAnimationFrame();

    // Should scroll by approximately viewport height (800px)
    const topAfter = parseFloat(contentWrapper.style.top || "0");
    // top is negative, so scrolled amount is the absolute value.
    // Page Down scrolls by viewport height (800px), clamped to maxScroll (400px).
    expect(topAfter).toBeLessThanOrEqual(-400); // at least as much as maxScroll
    expect(topAfter).toBeLessThan(-200); // at least half viewport scroll
  });

  test("Arrow Down scrolls column by 40px", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }}>
                <button data-testid="focusable-btn">click me</button>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    const btn = getByTestId("focusable-btn").element() as HTMLElement;
    btn.focus();

    column.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );

    await waitForAnimationFrame();

    const topAfter = parseFloat(contentWrapper.style.top || "0");
    expect(topAfter).toBe(-40);
  });

  test("Home key scrolls column to top (offset 0)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }}>
                <button data-testid="focusable-btn">click me</button>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    const btn = getByTestId("focusable-btn").element() as HTMLElement;
    btn.focus();

    // Scroll down first
    column.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    await waitForAnimationFrame();
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-40);

    // Then Home to return to top
    column.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
    );
    await waitForAnimationFrame();
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(0);
  });

  test("End key scrolls column to bottom (maxScroll offset)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }}>
                <button data-testid="focusable-btn">click me</button>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    const btn = getByTestId("focusable-btn").element() as HTMLElement;
    btn.focus();

    // End key scrolls to max
    column.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }),
    );
    await waitForAnimationFrame();

    const topAfter = parseFloat(contentWrapper.style.top || "0");
    // maxScroll = 1200 - 800 = 400, so top should be -400
    expect(topAfter).toBeLessThan(-300);
  });
});

// ---------------------------------------------------------------------------
// S5: input controller — keyboard exemption (D1, DELTA-1)
// ---------------------------------------------------------------------------

describe("Scene keyboard scroll — interactive element exemption (D1)", () => {
  test("D1: pressing Space on a button inside a scrollable focused column does not hijack the keypress (button keeps Space)", async () => {
    // Regression for the naive isInteractiveElement matcher: Space must
    // activate the button, not scroll the column.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div style={{ width: 400, height: 1200 }}>
                <button data-testid="action-btn">action</button>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const btn = getByTestId("action-btn").element() as HTMLElement;

    btn.focus();
    const notPrevented = btn.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
    );
    await waitForAnimationFrame();

    // The column must not have scrolled...
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(0);
    // ...and the keydown must not have been intercepted (defaultPrevented
    // false — a real button's native Space-activation behavior stays intact).
    expect(notPrevented).toBe(true);
  });

  test("DELTA-1: keyboard-focusing the scrollable content wrapper itself and pressing ArrowDown still scrolls the column (role=region must not self-exempt)", async () => {
    // The regression a naive [role]/[tabindex] matcher would cause: it would
    // exempt the column's OWN content wrapper (role="region", tabIndex=0 —
    // D2), breaking the tab-to-region-then-arrow-scroll keyboard path.
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

    contentWrapper.focus();
    expect(document.activeElement).toBe(contentWrapper);

    contentWrapper.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    await waitForAnimationFrame();

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-40);
  });

  test("fix round: a focusable no-role widget nested inside scrollable content keeps its own ArrowDown (column does not scroll)", async () => {
    // Gate finding: isInteractiveElement's content-wrapper exemption used a
    // closest()-based (self-OR-ancestor) check, which wrongly exempted every
    // nested focusable element too — since all consumer content lives inside
    // [data-column-content] by construction, ANY nested widget with a bare
    // tabindex (a roving-tabindex list item, a focusable message bubble) had
    // its own arrow/Space keys hijacked by column scroll. The fix scopes the
    // content-wrapper exemption to a SELF-ONLY check.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div style={{ width: 400, height: 1200 }}>
                <div data-testid="widget" tabIndex={0}>widget</div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const widget = getByTestId("widget").element() as HTMLElement;

    widget.focus();
    expect(document.activeElement).toBe(widget);

    const notPrevented = widget.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    await waitForAnimationFrame();

    // The column must NOT have scrolled...
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(0);
    // ...and the keydown must not have been intercepted — the widget keeps
    // its own ArrowDown for whatever internal purpose it has.
    expect(notPrevented).toBe(true);
  });

  test("F8c: an interior overflow-y:auto scroll island that fills its column is implicitly keyboard-focusable, but the column's own handler already declines — no fix needed for this shape", async () => {
    // F8c commit 1 finding (probe-confirmed at pickup): Chromium makes an
    // unattributed overflow-y:auto element with real overflow implicitly
    // keyboard-focusable (.focus() succeeds, getAttribute("tabindex") stays
    // null) — isInteractiveElement would NOT exempt it via the tabindex
    // path if the column's handler ever reached that check. But it never
    // does here: the column's own keydown handler bails BEFORE consulting
    // isInteractiveElement whenever the column itself has nothing to
    // scroll (`if (maxScrollRef.current <= 0) return;`, SceneColumn.tsx) —
    // exactly this shape, where the island absorbs all the column's
    // overflow (maxScroll=0 for the column). This pins that finding as a
    // regression guard; no production change was needed for this case.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
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

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const island = getByTestId("scroll-container").element() as HTMLElement;

    island.focus();
    // Confirms the implicit-focusability premise itself, not just the
    // downstream consequence — without this, a future browser change that
    // stopped making scroll regions implicitly focusable could silently
    // turn this into a vacuous test.
    expect(document.activeElement).toBe(island);
    expect(island.getAttribute("tabindex")).toBeNull();

    const notPrevented = island.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    await waitForAnimationFrame();

    // The column has nothing of its own to scroll — its handler declines
    // before ever reaching isInteractiveElement, so the key is never
    // hijacked; the island keeps it for whatever native/internal purpose.
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(0);
    expect(notPrevented).toBe(true);
  });
});

describe("Scene scroll position management", () => {
  test("vertical scroll resets to 0 when column first becomes focused", async () => {
    // A newly-focused column should start with scrollOffset = 0.
    // (It has never been focused before, so there's no saved position.)
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

    // On first render, scroll offset should be 0 (top of content)
    const top = parseFloat(contentWrapper.style.top || "0");
    expect(top).toBe(0);
  });

  test("scroll offset is clamped when maxScroll decreases (content shrinks)", async () => {
    // If the column is scrolled and then the content shrinks so that
    // maxScroll decreases, scrollOffset should be clamped to the new maxScroll.
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

    // Shrink content so maxScroll drops to 100px (content height 900px in 800px viewport)
    await rerender(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 900, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();

    // scrollOffset should be clamped to new maxScroll = 900 - 800 = 100
    const topAfter = parseFloat(contentWrapper.style.top || "0");
    expect(topAfter).toBeGreaterThanOrEqual(-100);
    expect(topAfter).toBeLessThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 5e: Edge cases — diagonal scroll and viewport resize
// ---------------------------------------------------------------------------

describe("Scene scroll edge cases", () => {
  test("diagonal trackpad gesture pans and scrolls both axes simultaneously (ui#19: deltaX drives the camera, not native scroll)", async () => {
    // A wheel event with both deltaX and deltaY should:
    // - Route deltaY to the column's vertical scroll state
    // - Route deltaX to the camera's panOffset
    // Both should happen from the SAME event, not sequentially.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="panel1" focused>
              <div data-testid="content1" style={{ minWidth: 800, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused>
              <div data-testid="content2" style={{ minWidth: 800, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-stage]") as HTMLElement;
    const col1 = getByTestId("content1")
      .element()
      .closest("[data-column]") as HTMLElement;
    const col1Content = col1.querySelector("[data-column-content]") as HTMLElement;
    const col1Rect = col1.getBoundingClientRect();

    // Initial state: no vertical scroll, camera at its canonical position.
    expect(parseFloat(col1Content.style.top || "0")).toBe(0);
    const stageLeftBefore = parseFloat(stage.style.left);

    // Diagonal wheel event: deltaX pans the camera, deltaY scrolls col1.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 100,
        deltaY: 150,
        clientX: col1Rect.left + col1Rect.width / 2,
        clientY: col1Rect.top + col1Rect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );

    // Input is rAF-coalesced as of F17 (both axes, ui#19 extended the
    // buffering to deltaX too) — both writes are buffered and applied on
    // the NEXT real animation frame, from the SAME dispatched event.
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    // Vertical: col1 should have scrolled by 150px.
    const verticalTop = parseFloat(col1Content.style.top || "0");
    expect(verticalTop).toBe(-150);

    // Horizontal: the camera should have panned — positive deltaX (native
    // "scroll right" convention) reveals content further right, moving
    // stage.left more negative (sign convention documented at
    // panOffsetRef's declaration in Scene.tsx).
    const stageLeftAfter = parseFloat(stage.style.left);
    expect(stageLeftAfter).toBeCloseTo(stageLeftBefore - 100, 0);
  });

  test("viewport resize: content now fits — scrollbar disappears", async () => {
    // When content overflows the viewport, a scrollbar should appear.
    // When the content shrinks to fit, the scrollbar should disappear.
    const { rerender, getByTestId } = await render(
      // Tall content — overflows 800px viewport
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 1200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;

    // Verify scrollbar is present
    expect(scene.querySelector("[data-scrollbar]")).not.toBeNull();

    // Swap in content that fits the viewport
    await rerender(
      // Short content — fits within 800px viewport
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 400, height: 200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // Scrollbar should be gone
    expect(scene.querySelector("[data-scrollbar]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S5: input controller — wheel (normalizeWheelDelta, decideWheelTargetColumn)
// ---------------------------------------------------------------------------

describe("Scene wheel input controller (S5)", () => {
  test("ctrl+wheel (pinch-zoom) does not scroll and does not preventDefault", async () => {
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
    const colRect = column.getBoundingClientRect();

    const notPrevented = scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 100,
        ctrlKey: true,
        clientX: colRect.left + colRect.width / 2,
        clientY: colRect.top + colRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(0);
    // dispatchEvent returns true when preventDefault was never called.
    expect(notPrevented).toBe(true);
  });

  test("deltaMode=LINE scales deltaY by 16px per line (3 lines -> 48px)", async () => {
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
    const colRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 3,
        deltaMode: 1, // DOM_DELTA_LINE
        clientX: colRect.left + colRect.width / 2,
        clientY: colRect.top + colRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Input is rAF-coalesced as of F17 — needs one extra waitForAnimationFrame().
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-48);
  });

  test("A10: wheel anywhere in the viewport scrolls the single scrollable focused column, even off-column", async () => {
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "a", objects: [{ name: "a-obj", focused: true, width: 400, height: 1200, testId: "content-a" }] },
          { name: "b", objects: [{ name: "b-obj", focused: true, width: 400, height: 100, testId: "content-b" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const colA = getByTestId("content-a").element().closest("[data-column]") as HTMLElement;
    const colAContent = colA.querySelector("[data-column-content]") as HTMLElement;
    const colB = getByTestId("content-b").element().closest("[data-column]") as HTMLElement;
    const colBRect = colB.getBoundingClientRect();

    // Cursor is over column B (not scrollable) — column A must still scroll
    // since it's the ONLY scrollable focused column in the viewport (A10
    // fallback: no dead margins when only one column can possibly respond).
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: colBRect.left + colBRect.width / 2,
        clientY: colBRect.top + colBRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Input is rAF-coalesced as of F17 — needs one extra waitForAnimationFrame().
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    expect(parseFloat(colAContent.style.top || "0")).toBe(-60);
  });

  test("multiple scrollable focused columns: wheel routes to the column under the cursor (unchanged hit-test behavior)", async () => {
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "a", objects: [{ name: "a-obj", focused: true, width: 400, height: 1200, testId: "content-a" }] },
          { name: "b", objects: [{ name: "b-obj", focused: true, width: 400, height: 1200, testId: "content-b" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const colA = getByTestId("content-a").element().closest("[data-column]") as HTMLElement;
    const colAContent = colA.querySelector("[data-column-content]") as HTMLElement;
    const colB = getByTestId("content-b").element().closest("[data-column]") as HTMLElement;
    const colBContent = colB.querySelector("[data-column-content]") as HTMLElement;
    const colBRect = colB.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: colBRect.left + colBRect.width / 2,
        clientY: colBRect.top + colBRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Input is rAF-coalesced as of F17 — needs one extra waitForAnimationFrame().
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    expect(parseFloat(colBContent.style.top || "0")).toBe(-60);
    expect(parseFloat(colAContent.style.top || "0")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ui#19 slice (b): horizontal pan (deltaX -> panOffset)
// ---------------------------------------------------------------------------

describe("Scene horizontal pan (ui#19 slice (b))", () => {
  test("pan within bounds: a moderate deltaX moves the camera by exactly that amount, well short of either bound", async () => {
    // Two 1000px columns (2000px total) in a 1280px viewport, padding=0 ->
    // range = 2000 - 1280 + 0 = 720. A 100px pan is nowhere near either
    // bound (0 or -720).
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
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
    const stage = scene.querySelector("[data-stage]") as HTMLElement;
    const vpRect = scene.getBoundingClientRect();
    const stageLeftBefore = parseFloat(stage.style.left);

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 100,
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
    const stageLeftAfter = parseFloat(stage.style.left);
    // Positive deltaX moves panOffset (and therefore stage.left) more
    // negative — sign convention documented at panOffsetRef's declaration.
    expect(stageLeftAfter).toBeCloseTo(stageLeftBefore - 100, 0);
  });

  test("clamp at both ends: a deltaX far exceeding the range clamps to the bound, not the raw delta — in EITHER direction", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
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
    const stage = scene.querySelector("[data-stage]") as HTMLElement;
    const vpRect = scene.getBoundingClientRect();
    const stageLeftAtOffset0 = parseFloat(stage.style.left);
    // Measured, not hardcoded — mirrors this file's own established
    // padding-cluster convention (real scrollWidth/clientWidth reads stay
    // valid under clip; only the SCROLLING mechanism they used to drive is
    // gone). scrollWidth reflects the stage's true rendered content extent
    // (including its own CSS padding) regardless of overflow:clip.
    const expectedRange = scene.scrollWidth - scene.clientWidth;

    // Pan far past the right end (positive deltaX, clamps at panOffset = -range).
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
    const stageLeftAtMin = parseFloat(stage.style.left);
    expect(stageLeftAtMin).toBeCloseTo(stageLeftAtOffset0 - expectedRange, 0);

    // One more huge positive deltaX must NOT move it any further (already
    // at the bound) — proves the clamp, not just a coincidentally-matching
    // single delta.
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
    expect(parseFloat(stage.style.left)).toBeCloseTo(stageLeftAtMin, 0);

    // Pan far past the LEFT end (negative deltaX, clamps at panOffset = 0
    // — back to canonical, never past it).
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: -5000,
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
    expect(parseFloat(stage.style.left)).toBeCloseTo(stageLeftAtOffset0, 0);
  });

  test("F8a horizontal twin: wheel deltaX over an interior overflow-x:auto island declines to route — the camera does not pan", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="island-col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowX: "auto" }}
              >
                <div style={{ width: 3000, height: 400 }}>wide content</div>
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="sibling-col">
            <SceneObject name="sibling-obj" focused>
              <div data-testid="sibling-content" style={{ minWidth: 1000, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-stage]") as HTMLElement;
    const island = getByTestId("scroll-container").element() as HTMLElement;
    const islandRect = island.getBoundingClientRect();
    const stageLeftBefore = parseFloat(stage.style.left);

    const notPrevented = island.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 60,
        deltaY: 0,
        clientX: islandRect.left + islandRect.width / 2,
        clientY: islandRect.top + islandRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    // The camera never panned, and Scene declined to preventDefault —
    // letting the browser's native horizontal scroll run on the island
    // exactly as it would outside a Scene. (Matches this file's existing
    // vertical F8a claim-gate test: a synthetic/untrusted WheelEvent
    // doesn't trigger the browser's OWN native scroll in this test
    // environment, so island.scrollLeft itself isn't asserted here either
    // — same limitation, same established pattern.)
    expect(parseFloat(stage.style.left)).toBe(stageLeftBefore);
    expect(notPrevented).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ui#19 slice (d): horizontal pan keyboard parity
// ---------------------------------------------------------------------------

describe("Scene horizontal pan keyboard parity (ui#19 slice (d))", () => {
  test("ArrowRight pans right by 40px; ArrowLeft reverses it", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
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
    const stage = scene.querySelector("[data-stage]") as HTMLElement;
    const stageLeftBefore = parseFloat(stage.style.left);

    scene.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    await waitForAnimationFrame();
    // ArrowRight (pan right, reveal further-right content) decreases
    // panOffset/stage.left — same sign convention as a positive wheel deltaX.
    expect(parseFloat(stage.style.left)).toBeCloseTo(stageLeftBefore - 40, 0);

    scene.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    await waitForAnimationFrame();
    expect(parseFloat(stage.style.left)).toBeCloseTo(stageLeftBefore, 0);
  });

  test("Home jumps to the canonical position (panOffset 0); End jumps to the fully-panned bound", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
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
    const stage = scene.querySelector("[data-stage]") as HTMLElement;
    const stageLeftAtHome = parseFloat(stage.style.left);
    const expectedRange = scene.scrollWidth - scene.clientWidth;

    scene.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    await waitForAnimationFrame();
    expect(scene.scrollLeft).toBe(0);
    expect(parseFloat(stage.style.left)).toBeCloseTo(stageLeftAtHome - expectedRange, 0);

    scene.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    await waitForAnimationFrame();
    expect(parseFloat(stage.style.left)).toBeCloseTo(stageLeftAtHome, 0);
  });

  test("no pan range: ArrowRight is not intercepted (declines, does not preventDefault)", async () => {
    // A single 200px column fits the 1280px viewport — zero pan range.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj" focused>
              <div data-testid="content" style={{ minWidth: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const notPrevented = scene.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    expect(notPrevented).toBe(true);
  });

  test("interactive/editable element exemption: typing ArrowRight inside a text input does not pan", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ minWidth: 1000, height: 200 }} />
              <input data-testid="text-input" type="text" />
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
    const stage = scene.querySelector("[data-stage]") as HTMLElement;
    const input = getByTestId("text-input").element() as HTMLElement;
    const stageLeftBefore = parseFloat(stage.style.left);

    const notPrevented = input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    await waitForAnimationFrame();

    expect(notPrevented).toBe(true);
    expect(parseFloat(stage.style.left)).toBe(stageLeftBefore);
  });
});

// ---------------------------------------------------------------------------
// Phase 6a: Outer unfocused column positioning
// ---------------------------------------------------------------------------

describe("Scene outer unfocused column positioning", () => {
  test("unfocused column left of all focused is classified outer-left and stays in flex flow", async () => {
    // Outer-left columns remain in the flex row at position: relative.
    // The Camera pans right to show the focused column, leaving the outer-left
    // column outside the viewport — clipped by the viewport, not moved by transform.
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: false, width: 300, height: 200, testId: "content-left" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 300, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const leftCol = getByTestId("content-left").element().closest("[data-column]") as HTMLElement;
    // Column should be classified as outer-left
    expect(leftCol.getAttribute("data-column-position")).toBe("outer-left");
    // Outer-left stays in flex flow at position: relative (no translateX offscreen)
    expect(window.getComputedStyle(leftCol).position).toBe("relative");
    await waitForAnimationFrame();
    // No translateX applied — column has x=0 animate target
    const transform = leftCol.style.transform;
    expect(transform).not.toContain("translateX(-1280");
  });

  test("unfocused column right of all focused is classified outer-right and stays in flex flow", async () => {
    // Outer-right columns remain in the flex row at position: relative.
    // They are positioned naturally after the focused column in DOM order.
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 300, height: 200, testId: "content-left" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: false, width: 300, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const rightCol = getByTestId("content-right").element().closest("[data-column]") as HTMLElement;
    // Column should be classified as outer-right
    expect(rightCol.getAttribute("data-column-position")).toBe("outer-right");
    // Outer-right stays in flex flow at position: relative
    expect(window.getComputedStyle(rightCol).position).toBe("relative");
    await waitForAnimationFrame();
    // No translateX applied — column has x=0 animate target
    const transform = rightCol.style.transform;
    expect(transform).not.toContain("translateX(1280");
  });

  test("refocusing outer column animates it back into viewport", async () => {
    // An unfocused outer-right column should slide back into view when focused.
    const { rerender, getByTestId } = await render(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 300, height: 200, testId: "content-left" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: false, width: 300, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const rightCol = getByTestId("content-right").element().closest("[data-column]") as HTMLElement;
    // Initially offscreen right
    expect(rightCol.getAttribute("data-column-position")).toBe("outer-right");

    await rerender(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 300, height: 200, testId: "content-left" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 300, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // After refocus, column is back in the flex layout (position: relative)
    const style = window.getComputedStyle(rightCol);
    expect(style.position).toBe("relative");
    // No longer classified as outer
    expect(rightCol.getAttribute("data-column-position")).not.toBe("outer-right");
  });

  test("all unfocused — columns stay at last position (camera does not move)", async () => {
    // When all columns are unfocused, they should keep their last frozen
    // position rather than jumping to offscreen. This prevents layout thrash
    // when nothing is focused (the camera stays still).
    const { rerender, getByTestId } = await render(
      buildScene(
        [
          { name: "col-a", objects: [{ name: "obj-a", focused: true, width: 300, height: 200, testId: "content-a" }] },
          { name: "col-b", objects: [{ name: "obj-b", focused: true, width: 300, height: 200, testId: "content-b" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // Record positions while both are focused
    const colA = getByTestId("content-a").element().closest("[data-column]") as HTMLElement;
    const colB = getByTestId("content-b").element().closest("[data-column]") as HTMLElement;

    await rerender(
      buildScene(
        [
          { name: "col-a", objects: [{ name: "obj-a", focused: false, width: 300, height: 200, testId: "content-a" }] },
          { name: "col-b", objects: [{ name: "obj-b", focused: false, width: 300, height: 200, testId: "content-b" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // When no columns are focused, neither should be classified as outer
    // (they stay put rather than flying offscreen)
    expect(colA.getAttribute("data-column-position")).not.toBe("outer-left");
    expect(colA.getAttribute("data-column-position")).not.toBe("outer-right");
    expect(colB.getAttribute("data-column-position")).not.toBe("outer-left");
    expect(colB.getAttribute("data-column-position")).not.toBe("outer-right");
  });
});

// ---------------------------------------------------------------------------
// ui#27: keyboard-scope regression for the wheel cliff detector. The
// detector's silence-timer mechanism observes the same applyScrollCommand
// entry point keyboard/scrollbar-thumb-drag commands flow through — an
// origin tag (`source: "wheel"`, set only at Scene's wheel-flush call site)
// is what excludes these paths by construction, an ALLOWLIST rather than an
// enumerated exclusion list. These two cases prove the allowlist actually
// holds for BOTH keyboard-scroll emitters the forecast gate identified: the
// column's own keydown handler AND the scrollbar thumb's native keydown
// handler (Scrollbar.tsx, D4) — a held ArrowDown/PageDown from either must
// keep springing exactly as before, never getting cliff-truncated, even
// when the burst leaves real outstanding spring debt past the detector's
// silence window (diagnostic-confirmed against current source: a 6-press,
// 15ms-apart burst leaves ~191px of a 240px target still owed at the last
// keydown, settling naturally over ~600ms — the exact "large delta,
// meaningful debt, past the silence window" shape the wheel detector fires
// on, minus the wheel tag).
// ---------------------------------------------------------------------------

describe("Scene keyboard scroll — wheel cliff detector must not intercept (ui#27)", () => {
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

  test("(i) a held ArrowDown burst on the focused column keeps springing at its normal pace, past the wheel-cliff silence window", async () => {
    const recorder = createMotionSeamRecorder();
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="panel" focused>
                <div style={{ width: 400, height: 43000 }}>
                  <button data-testid="focusable-btn">click me</button>
                </div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const btn = getByTestId("focusable-btn").element() as HTMLElement;
    btn.focus();

    const sy = recorder.values.get("scrollY:col")!;

    // Six ArrowDown presses, 15ms apart — a real, sustained hold-repeat
    // burst. No `source` tag exists on this path at all (only Scene's
    // wheel-flush call site ever sets it).
    for (let i = 0; i < 6; i++) {
      column.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
      await wait(15);
    }

    // A wrongly-firing detector would snap this to the 240px target within
    // ~100-120ms of the last keydown (a jump, not a spring). The real
    // spring takes far longer — asserting a floor well above the jump
    // window, comfortably below the real spring settle time, distinguishes
    // the two unambiguously.
    const { ms, final } = await settle(() => sy.get());
    expect(ms).toBeGreaterThan(300);
    expect(final).toBeCloseTo(240, 0);
  });

  test("(ii) a held PageDown/ArrowDown on a focused scrollbar thumb keeps springing at its normal pace, past the wheel-cliff silence window", async () => {
    const recorder = createMotionSeamRecorder();
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="panel" focused>
                <div style={{ width: 400, height: 43000 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const thumb = column.querySelector('[role="scrollbar"]') as HTMLElement;
    thumb.focus();

    const sy = recorder.values.get("scrollY:col")!;

    // D4's own native (non-React) keydown listener is the fourth scrollBy
    // emitter the forecast gate caught — routed through onCommand straight
    // into applyScrollCommand, with no `source` tag either.
    for (let i = 0; i < 6; i++) {
      thumb.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
      await wait(15);
    }

    const { ms, final } = await settle(() => sy.get());
    expect(ms).toBeGreaterThan(300);
    expect(final).toBeCloseTo(240, 0);
  });
});
