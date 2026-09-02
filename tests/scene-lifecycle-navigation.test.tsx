import { describe, test, expect, vi } from "vitest";
import { useState } from "react";
import { render } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { TestWrapper } from "./test-wrapper";
import { wait, waitForAnimationFrame } from "./utils/animation";
import { buildScene } from "./utils/sceneFixtures";

// ---------------------------------------------------------------------------
// Initial layout: All columns visible, content-sized (spec lines 22-35)
// ---------------------------------------------------------------------------

describe("Scene initial layout", () => {
  test("all columns visible on initial render when none focused", async () => {
    const { getByTestId } = await render(
      // All columns should be in the flex row at position: relative with
      // opacity: 1 even when nothing is focused — the scene is a real
      // space, not hidden objects.
      buildScene(
        [
          { name: "col-a", objects: [{ name: "obj-a", focused: false, width: 200, height: 100, testId: "content-a" }] },
          { name: "col-b", objects: [{ name: "obj-b", focused: false, width: 200, height: 100, testId: "content-b" }] },
          { name: "col-c", objects: [{ name: "obj-c", focused: false, width: 200, height: 100, testId: "content-c" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const colA = getByTestId("content-a").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const colB = getByTestId("content-b").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const colC = getByTestId("content-c").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    // All columns: position relative, opacity 1 (no position null = no-position = stays in flow)
    for (const col of [colA, colB, colC]) {
      expect(window.getComputedStyle(col).position).toBe("relative");
    }
    // No column has a null-position classification (they have no-position / null data attr)
    expect(colA.getAttribute("data-ui-scene-column-position")).toBeNull();
    expect(colB.getAttribute("data-ui-scene-column-position")).toBeNull();
    expect(colC.getAttribute("data-ui-scene-column-position")).toBeNull();
  });

  test("column size is based on content by default", async () => {
    // A focused column with a 400px wide child should be 400px wide.
    // With flex: 0 1 auto, the column doesn't stretch to fill available space.
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 400, height: 100, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const col = getByTestId("content").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const width = col.getBoundingClientRect().width;
    // Column should be content-sized (400px), not viewport-width (1280px)
    expect(width).toBeCloseTo(400, -1); // within 10px
    expect(width).toBeLessThan(500);
  });

  test("consumer can override column sizing via content that has an explicit width", async () => {
    // When content has an explicit width larger than the natural content size,
    // the column expands to fit it — flex: 0 1 auto lets content dictate size.
    const { getByTestId } = await render(
      buildScene(
        [
          {
            name: "col",
            objects: [
              // Explicit 600px width — column should match.
              { name: "object", focused: true, width: 600, height: 100, testId: "content" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const col = getByTestId("content").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const width = col.getBoundingClientRect().width;
    // Column should be ~600px to fit the content
    expect(width).toBeCloseTo(600, -1);
    expect(width).toBeLessThan(700);
  });

  test("a focused column's width transition does not visually distort text content (ui#17 criterion 6, focused-column width path)", async () => {
    // ui/t:17 Test-design section ("stretch regression pin"): the FOCUSED
    // width path (widthTarget = computeFocusedWidth, the widest currently-
    // focused object's own measured width — SceneColumn.tsx's own comment)
    // is a DIFFERENT code path from the in-between/deck path's tests above
    // — no frozenSize pin, no overflow:clip, the width channel writes the
    // OUTER column's real CSS width directly (never a transform). Swapping
    // which sibling is focused (narrow -> wide) springs that width target,
    // exercising this path's own width-changing transition. Real duration
    // (no duration={0}) — the spring must actually run for a distortion
    // (or its absence) to be observable across intermediate frames, same
    // rationale as H11's own real-mode sampling above.
    function Demo() {
      const [wideFocused, setWideFocused] = useState(false);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setWideFocused((v) => !v)}>
            toggle
          </button>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="narrow-obj" focused={!wideFocused}>
                <div data-testid="narrow-content" style={{ width: 200, height: 200 }} />
              </SceneObject>
              <SceneObject name="wide-obj" focused={wideFocused}>
                <div data-testid="wide-content" style={{ width: 500, height: 200 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<Demo />);
    await wait(500);

    const col = getByTestId("narrow-content").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const wrapper = col.querySelector("[data-ui-scene-column-content]") as HTMLElement;
    (getByTestId("toggle").element() as HTMLElement).click();

    // Sample the CONTENT WRAPPER's rendered vs. layout aspect ratio across
    // the width spring (narrow 200px -> wide 500px) — not the outer column
    // (Motion actively writes `transform` to the outer via its own
    // animate={{x,y}} prop, an unrelated concern that would confound a
    // transform-based check there); the wrapper only carries
    // animate={{marginTop}}, a non-transform property, making it the clean
    // measurement site — same choice the in-between path's own aspect-ratio
    // assertion above makes, and the wrapper is what actually holds the
    // rendered TEXT content criterion 6 protects. A uniform scale would be
    // legitimate here too, in principle, though nothing in this path ever
    // applies one; a non-uniform, horizontal-only stretch is what this
    // catches.
    const samples: { t: number; renderedAspect: number; layoutAspect: number }[] = [];
    const start = performance.now();
    for (const delay of [0, 16, 32, 50, 100, 150, 200, 300]) {
      await wait(Math.max(0, delay - (performance.now() - start)));
      const rect = wrapper.getBoundingClientRect();
      samples.push({
        t: performance.now() - start,
        renderedAspect: rect.width / rect.height,
        layoutAspect: wrapper.offsetWidth / wrapper.offsetHeight,
      });
    }
    for (const s of samples) {
      expect(s.renderedAspect).toBeCloseTo(s.layoutAspect, 2);
    }
  });

  test("Camera viewport has container-type: size", async () => {
    // The Camera viewport has container-type: size so consumers can use
    // cqw/cqh units to size columns relative to the viewport dimensions.
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 100, height: 100, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const style = window.getComputedStyle(scene);
    expect(style.containerType).toBe("size");
  });
});

// ---------------------------------------------------------------------------
// Phase 7a: Dynamic mount/unmount
// ---------------------------------------------------------------------------

describe("Scene dynamic mount/unmount", () => {
  test("new focused column mounts — layout includes it in the flex row", async () => {
    // When a new SceneColumn with a focused object mounts into the scene, it
    // should immediately participate in the flex layout alongside existing
    // focused columns.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-a">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Initially only one column is focused.
    const colA = getByTestId("content-a").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    expect(window.getComputedStyle(colA).position).toBe("relative");

    // Mount a second focused column
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-a">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-b">
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    // The new column should exist and be in the flex layout
    const colB = getByTestId("content-b").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    expect(window.getComputedStyle(colA).position).toBe("relative");
    expect(window.getComputedStyle(colB).position).toBe("relative");

    // col-b should appear to the right of col-a (flex row ordering)
    const rectA = colA.getBoundingClientRect();
    const rectB = colB.getBoundingClientRect();
    expect(rectB.left).toBeGreaterThanOrEqual(rectA.right - 2);
  });

  test("focused column unmounts — remaining column is still in flex layout", async () => {
    // When a focused column unmounts, the remaining focused column should
    // still be part of the flex layout (position: relative).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-a">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-b">
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const colA = getByTestId("content-a").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    // Unmount col-b
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-a">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    // col-a should still be in flex layout after col-b unmounts
    expect(window.getComputedStyle(colA).position).toBe("relative");

    // col-b should no longer exist in the DOM
    const colB = document.querySelector("[data-ui-scene-column-anchor='col-b']");
    expect(colB).toBeNull();
  });

  test("unfocused column unmounting to right re-centers focused content", async () => {
    // Outer unfocused columns are position: relative and take up space in the
    // flex row. Unmounting one to the right removes that space, causing the
    // stage to re-center via margin-inline: auto.
    const { rerender, getByTestId } = await render(
      buildScene(
        [
          { name: "col-focused", objects: [{ name: "obj-focused", focused: true, width: 300, height: 200, testId: "content-focused" }] },
          { name: "col-unfocused", objects: [{ name: "obj-unfocused", focused: false, width: 300, height: 200, testId: "content-unfocused" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const focusedCol = getByTestId("content-focused").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    await waitForAnimationFrame();

    // Unmount the unfocused column to the right
    await rerender(
      buildScene(
        [{ name: "col-focused", objects: [{ name: "obj-focused", focused: true, width: 300, height: 200, testId: "content-focused" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();

    // After unmounting, only the focused column remains — the stage re-centers.
    // Width should be unchanged (column content hasn't changed).
    const rectAfter = focusedCol.getBoundingClientRect();
    expect(Math.abs(rectAfter.width - 300)).toBeLessThan(2);
    // Focused column should be centered in the 1280px viewport.
    const expectedLeft = (1280 - 300) / 2;
    expect(Math.abs(rectAfter.left - expectedLeft)).toBeLessThan(2);
  });

  test("consumer CSS change causes layout reflow", async () => {
    // When consumer CSS on a focused object changes (e.g. minWidth),
    // the flex layout should reflow to accommodate the new size. The column
    // should grow to fit the new minimum width.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              {/* Start with 200px min-width */}
              <div data-testid="content" style={{ minWidth: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const col = getByTestId("content").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    // Record the initial column width — should be at least 200px
    const widthBefore = col.getBoundingClientRect().width;
    expect(widthBefore).toBeGreaterThanOrEqual(200);

    // Increase the min-width — the layout should reflow
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div data-testid="content" style={{ minWidth: 600, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    // Column should now be at least 600px wide
    const widthAfter = col.getBoundingClientRect().width;
    expect(widthAfter).toBeGreaterThanOrEqual(600);
    expect(widthAfter).toBeGreaterThan(widthBefore);
  });
});

// ---------------------------------------------------------------------------
// Phase 7c: Navigation depth — new column entering from right
// ---------------------------------------------------------------------------

describe("Scene navigation depth", () => {
  test("new focused column enters the flex layout at its natural position", async () => {
    // When a new focused SceneColumn mounts, it should end up in the correct
    // flex position (to the right of existing focused columns).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-1">
            <SceneObject name="obj-1" focused>
              <div data-testid="content-1" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Mount col-2 focused to the right of col-1
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-1">
            <SceneObject name="obj-1" focused>
              <div data-testid="content-1" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-2">
            <SceneObject name="obj-2" focused>
              <div data-testid="content-2" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const col1 = getByTestId("content-1").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const col2 = getByTestId("content-2").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    // col-2 should appear to the right of col-1 in the flex layout.
    const rect1 = col1.getBoundingClientRect();
    const rect2 = col2.getBoundingClientRect();
    expect(rect2.left).toBeGreaterThanOrEqual(rect1.right - 2);

    // Both should be in flex flow (position: relative)
    expect(window.getComputedStyle(col2).position).toBe("relative");
  });

  test("back navigation: outer-left unfocused column can become focused again", async () => {
    // When navigating back, a previously outer-left unfocused column becomes focused.
    // After the transition it should be in the flex layout and visible.
    const { rerender, getByTestId } = await render(
      buildScene(
        [
          { name: "nav", objects: [{ name: "nav-object", focused: false, width: 300, height: 200, testId: "content-nav" }] },
          { name: "article", objects: [{ name: "article-object", focused: true, width: 300, height: 200, testId: "content-article" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const navCol = getByTestId("content-nav").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    // Initially nav is outer-left (unfocused, to the left of focused article)
    expect(navCol.getAttribute("data-ui-scene-column-position")).toBe("outer-left");

    // Navigate back: nav becomes focused, article stays focused
    await rerender(
      buildScene(
        [
          { name: "nav", objects: [{ name: "nav-object", focused: true, width: 300, height: 200, testId: "content-nav" }] },
          { name: "article", objects: [{ name: "article-object", focused: true, width: 300, height: 200, testId: "content-article" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();

    // Nav column should now be in the flex layout (focused)
    expect(window.getComputedStyle(navCol).position).toBe("relative");
    expect(navCol.getAttribute("data-ui-scene-column-position")).toBeNull();

    // Nav should appear to the left of article (in DOM order)
    const articleCol = getByTestId("content-article").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const navRect = navCol.getBoundingClientRect();
    const articleRect = articleCol.getBoundingClientRect();
    expect(navRect.left).toBeLessThan(articleRect.left);
  });

  test("column removed to the right of focused content re-centers focused content", async () => {
    // Outer unfocused columns are position: relative and take up space in the
    // flex row. Removing Column 2 (outer-right) causes the stage to re-center
    // via margin-inline: auto so Column 1 shifts to the viewport center.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-1">
            <SceneObject name="obj-1" focused>
              <div data-testid="content-1" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-2">
            <SceneObject name="obj-2" focused={false}>
              <div data-testid="content-2" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const col1 = getByTestId("content-1").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    // Remove col-2 (unfocused, to the right)
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-1">
            <SceneObject name="obj-1" focused>
              <div data-testid="content-1" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const rectAfter = col1.getBoundingClientRect();
    // Width should be unchanged — col-1 content hasn't changed.
    expect(Math.abs(rectAfter.width - 300)).toBeLessThan(2);
    // After removal, only col-1 remains in the stage — it re-centers in the
    // 1280px viewport.
    const expectedLeft = (1280 - 300) / 2;
    expect(Math.abs(rectAfter.left - expectedLeft)).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// Phase 7c: Navigation animation — mount/unmount transitions
// ---------------------------------------------------------------------------

describe("Scene navigation animation", () => {
  test("newly mounted focused column enters the flex layout, focused", async () => {
    // A focused column that mounts for the first time (never-focused before)
    // ends up in the flex layout like any other focused column.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-1">
            <SceneObject name="obj-1" focused>
              <div data-testid="content-1" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Mount col-2 as focused.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-1">
            <SceneObject name="obj-1" focused>
              <div data-testid="content-1" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-2">
            <SceneObject name="obj-2" focused>
              <div data-testid="content-2" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const col2 = getByTestId("content-2").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    // The column should be in the flex layout after mounting
    expect(window.getComputedStyle(col2).position).toBe("relative");
    // With duration=0, animations are instant — verify final state is correct
    expect(col2.getAttribute("data-ui-scene-column-focused")).toBe("true");
  });

  test("focused column that was outer-left transitions back into flex layout", async () => {
    // When navigating back, a previously outer-left unfocused column should
    // smoothly animate from its offscreen position back into the flex row.
    // The column uses motion layout FLIP for this transition.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="nav-object" focused={false}>
              <div data-testid="content-nav" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="article">
            <SceneObject name="article-object" focused>
              <div data-testid="content-article" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const navCol = getByTestId("content-nav").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    expect(navCol.getAttribute("data-ui-scene-column-position")).toBe("outer-left");

    // Navigate back: nav becomes focused
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="nav-object" focused>
              <div data-testid="content-nav" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="article">
            <SceneObject name="article-object" focused>
              <div data-testid="content-article" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    // After transition: nav is in flex layout
    expect(window.getComputedStyle(navCol).position).toBe("relative");
    // Nav column's x-transform should be 0 at rest (no offscreen offset)
    const navRect = navCol.getBoundingClientRect();
    expect(navRect.left).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 8a: Click-to-focus
// ---------------------------------------------------------------------------

describe("SceneObject click-to-focus", () => {
  test("clicking unfocused SceneObject fires onActivate", async () => {
    let activated = false;
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused={false} onActivate={() => { activated = true; }}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const outer = getByTestId("content").element().closest("[data-ui-scene-id]") as HTMLElement;
    outer.click();
    expect(activated).toBe(true);
  });

  test("clicking focused SceneObject does NOT fire onActivate", async () => {
    let activateCount = 0;
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused onActivate={() => { activateCount++; }}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const outer = getByTestId("content").element().closest("[data-ui-scene-id]") as HTMLElement;
    outer.click();
    // onActivate should NOT fire when the object is already focused.
    expect(activateCount).toBe(0);
  });

  test("unfocused SceneObject inner content wrapper has inert attribute (blocks child interaction)", async () => {
    // The inner content wrapper is inert when unfocused. The `inert` attribute
    // prevents descendants from being focused or activated by pointer events.
    // We verify the attribute is present (native browser enforcement handles the rest).
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused={false}>
              <button data-testid="child-btn">click me</button>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const btn = getByTestId("child-btn").element() as HTMLElement;
    // The button is inside the inert wrapper — find the inert ancestor.
    const inertWrapper = btn.closest("[inert]");
    expect(inertWrapper).not.toBeNull();
    expect(inertWrapper?.hasAttribute("inert")).toBe(true);
  });

  test("SceneObject outer wrapper is clickable even when unfocused (outer not inert)", async () => {
    // The outer wrapper must NOT be inert — only the inner content wrapper is.
    // This is what enables click-to-focus: the outer div receives click events
    // even though the content inside is inert.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused={false}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const outer = getByTestId("content").element().closest("[data-ui-scene-id]") as HTMLElement;
    // The outer wrapper itself should not have the inert attribute.
    expect(outer.hasAttribute("inert")).toBe(false);
    // The inner wrapper (parent of content) should have inert.
    const innerWrapper = getByTestId("content").element().parentElement;
    expect(innerWrapper?.hasAttribute("inert")).toBe(true);
  });

  test("D3: an unfocused SceneObject with onActivate has role=button and tabIndex=0 on the outer wrapper", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused={false} onActivate={() => {}}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const outer = getByTestId("content").element().closest("[data-ui-scene-id]") as HTMLElement;
    expect(outer.getAttribute("role")).toBe("button");
    expect(outer.getAttribute("tabindex")).toBe("0");
  });

  test("D3: an unfocused SceneObject WITHOUT onActivate has no role=button and a permanent tabIndex=-1 (D5 fallback baseline)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused={false}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const outer = getByTestId("content").element().closest("[data-ui-scene-id]") as HTMLElement;
    expect(outer.hasAttribute("role")).toBe(false);
    expect(outer.getAttribute("tabindex")).toBe("-1");
  });

  test("D3: pressing Enter on an unfocused SceneObject's outer wrapper (with onActivate) fires onActivate", async () => {
    let activated = false;
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused={false} onActivate={() => { activated = true; }}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const outer = getByTestId("content").element().closest("[data-ui-scene-id]") as HTMLElement;
    outer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(activated).toBe(true);
  });

  test("D3: pressing Space on an unfocused SceneObject's outer wrapper (with onActivate) fires onActivate and preventDefault is called", async () => {
    let activated = false;
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused={false} onActivate={() => { activated = true; }}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const outer = getByTestId("content").element().closest("[data-ui-scene-id]") as HTMLElement;
    const notPrevented = outer.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
    );
    expect(activated).toBe(true);
    // preventDefault WAS called (Space must not also scroll the page).
    expect(notPrevented).toBe(false);
  });

  test("DELTA-2 (ui#19: pure immunity assertion): tab-focusing a parked (offscreen) column's D3 activation wrapper leaves the camera's horizontal framing unchanged, and Enter still activates it normally", async () => {
    // DELTA-2's original regression was the browser's native scroll-into-
    // view-on-focus dragging the viewport's native scrollLeft out from
    // under the camera's own stageLeft pan (probe-confirmed pre-ui/t:19: 0 ->
    // 782 with stageLeft unchanged) — that mechanism required correcting
    // AFTER the fact (DELTA-2's bare reset, then absorb-and-re-pan). Under
    // ui/t:19's unconditional overflow-x:clip, native scroll-into-view cannot
    // move scrollLeft at all (probe-confirmed bulletproof — see this
    // codebase's ui/t:19 clip probe), so there is nothing to correct; this is
    // now a pure immunity assertion, not a correction-cycle test. Layout:
    // three 400px columns in a 500px viewport, only "a" focused — "c" is
    // parked well outside the visible region.
    let activated = false;
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "a", objects: [{ name: "a-obj", focused: true, width: 400, height: 300, testId: "content-a" }] },
          { name: "b", objects: [{ name: "b-obj", focused: false, width: 400, height: 300, testId: "content-b", onActivate: () => {} }] },
          {
            name: "c",
            objects: [
              { name: "c-obj", focused: false, width: 400, height: 300, testId: "content-c", onActivate: () => { activated = true; } },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true, width: 500, height: 600 },
      ),
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement;
    const cWrapper = getByTestId("content-c").element().closest("[data-ui-scene-id]") as HTMLElement;

    expect(scene.scrollLeft).toBe(0);
    const stageLeftBefore = stage.style.left;

    cWrapper.focus();
    await waitForAnimationFrame();

    expect(document.activeElement).toBe(cWrapper);
    // The camera's own pan target is untouched...
    expect(stage.style.left).toBe(stageLeftBefore);
    // ...and scrollLeft was never able to move at all (clip immunity, not
    // a correction) — the browser's native scroll-into-view attempt is
    // structurally a no-op against a clip container.
    expect(scene.scrollLeft).toBe(0);

    // Enter still activates it normally.
    cWrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(activated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scene horizontal scrollLeft immunity (ui/t:19 single-writer). History:
// DELTA-2's bare `el.scrollLeft = 0` reset-on-focusin restored the correct
// FINAL resting position but was itself a native scroll mutation landing
// mid-click-gesture — measured in the consuming app: 21/21 + 27/27 + 24/24
// clicks eaten across three N=20 loops (96% of events). An interim
// "absorb-and-re-pan" fix (compensate stage.left by the corruption's delta,
// then explicitly re-pan via Motion) closed that, but remained a TWO-WRITER
// system needing reconciliation code — and that reconciliation code shipped
// a real regression of its own: a Promise/`.then()`-tracked "already
// animating toward this target" guard could get permanently orphaned when a
// second correction's `cameraX.jump()` cancelled the first's still-in-
// flight re-pan spring before its `.then()` fired, silently stranding the
// camera ~450px off canonical for the rest of the interaction. THE LESSON —
// no Promise/`.then()`-tracked in-flight guards, ever; idempotent re-issue
// instead (SceneColumn.tsx F17's driveBoundedSpring pattern) — carries
// forward as a standing rule for every cameraX-driving function ui/t:19 adds
// (see Scene.tsx's viewport style comment for the durable constraint this
// history left behind).
//
// ui/t:19 removes the second writer entirely: overflow-x/-y are
// unconditionally clip, so there is no corrupted scrollLeft to ever
// reconcile — no correction handler exists anymore. The tests below assert
// IMMUNITY, not correction.
//
// Environment note (probe-confirmed): calling `.focus()` directly on an
// off-viewport element does NOT trigger native scroll-into-view in this
// headless Chromium test environment (unlike a real browser with real
// window/OS focus) — `element.scrollIntoView()` and a direct
// `el.scrollLeft = x` write both DO reliably attempt the corruption here,
// and both fire the native "scroll" event exactly the way a real
// multi-tick native auto-scroll's own intermediate ticks would. The tests
// below use a direct scrollLeft write as the corruption-ATTEMPT technique
// for this reason.
// ---------------------------------------------------------------------------

describe("Scene horizontal scrollLeft immunity (ui#19)", () => {
  test("frame-sampling immunity guard: no sampled frame — nor the object's own position — ever shows any effect of a scrollLeft corruption attempt, across a real multi-frame window", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage width={500} height={600}>
        <Scene>
          <SceneColumn name="a">
            <SceneObject name="a-obj" focused>
              <div data-testid="content-a" style={{ width: 400, height: 300 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="b">
            <SceneObject name="b-obj" focused={false} onActivate={() => {}}>
              <div data-testid="content-b" style={{ width: 400, height: 300 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="c">
            <SceneObject name="c-obj" focused={false} onActivate={() => {}}>
              <div data-testid="content-c" style={{ width: 400, height: 300 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    for (let i = 0; i < 30; i++) await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const stableObj = getByTestId("content-a").element() as HTMLElement;
    const cWrapper = getByTestId("content-c").element().closest("[data-ui-scene-id]") as HTMLElement;
    const preRect = stableObj.getBoundingClientRect();

    // Two independent corruption-attempt techniques, back to back (a direct
    // write, then scrollIntoView on a parked column) — both probe-confirmed
    // elsewhere in this codebase to attempt a real native scroll.
    scene.scrollLeft = 150;
    cWrapper.scrollIntoView();

    const samples: { frame: number; scrollLeft: number; x: number }[] = [];
    for (let i = 0; i < 60; i++) {
      await waitForAnimationFrame();
      samples.push({ frame: i, scrollLeft: scene.scrollLeft, x: stableObj.getBoundingClientRect().x });
    }

    const violating = samples.filter((s) => s.scrollLeft !== 0 || Math.abs(s.x - preRect.x) >= 1);
    expect(
      violating.length,
      `${violating.length} sampled frame(s) observed a corruption effect (nonzero scrollLeft or object movement): ${JSON.stringify(violating)}`,
    ).toBe(0);
  });

  test("mid-gesture click-eater regression: a scrollLeft corruption attempt between pointerdown and click does not leave the click target permanently stranded", async () => {
    let clicked = false;
    const { getByTestId } = await render(
      <TestWrapper fullPage width={500} height={600}>
        <Scene duration={0}>
          <SceneColumn name="a">
            <SceneObject name="a-obj" focused>
              <button data-testid="target-btn" onClick={() => { clicked = true; }}>target</button>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="b">
            <SceneObject name="b-obj" focused={false} onActivate={() => {}}>
              <div data-testid="content-b" style={{ width: 400, height: 300 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="c">
            <SceneObject name="c-obj" focused={false} onActivate={() => {}}>
              <div data-testid="content-c" style={{ width: 400, height: 300 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const target = getByTestId("target-btn").element() as HTMLElement;

    const rect = target.getBoundingClientRect();
    const clickX = rect.x + rect.width / 2;
    const clickY = rect.y + rect.height / 2;

    // Capture-phase pointerdown listener attempts to corrupt scrollLeft
    // mid-gesture, a direct property write standing in for a real native
    // auto-scroll (see this describe block's header comment for why —
    // .focus() doesn't trigger native scroll-into-view in this headless
    // environment, but a direct write fires the identical "scroll" event a
    // real multi-tick native auto-scroll's own ticks would).
    const pdListener = () => {
      scene.scrollLeft = 300;
    };
    document.addEventListener("pointerdown", pdListener, true);
    const pdHitEl = document.elementFromPoint(clickX, clickY)!;
    expect(pdHitEl.getAttribute("data-testid")).toBe("target-btn");
    pdHitEl.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: clickX, clientY: clickY }));
    document.removeEventListener("pointerdown", pdListener, true);

    // The corruption attempt is a no-op under clip — nothing to wait for,
    // but one frame costs nothing and keeps this test structurally similar
    // to a real gesture's timing.
    await waitForAnimationFrame();

    expect(scene.scrollLeft).toBe(0);
    const clickHitEl = document.elementFromPoint(clickX, clickY)!;
    clickHitEl.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: clickX, clientY: clickY }));

    expect(clickHitEl.getAttribute("data-testid")).toBe("target-btn");
    expect(clicked).toBe(true);
  });

  // "double-correction race" test DELETED (ui#19 slice (a)) — its entire
  // premise (a second scrollLeft corruption arriving while the first
  // correction's re-pan spring is still in flight) requires the
  // absorb-and-re-pan correction mechanism this slice removes; there is no
  // more re-pan spring to race against. The LESSON it caught — see this
  // describe block's header comment — carries forward as a standing rule
  // for this arc, not as a test against dead code. git history has the
  // full original investigation and test.
});

// ---------------------------------------------------------------------------
// ui/t:19 slice (d): ancestor scroll-chaining mount warning
// ---------------------------------------------------------------------------

describe("Scene ancestor scroll-chaining warning (ui#19 slice (d))", () => {
  test("warns once when mounted inside a genuinely horizontally-scrollable ancestor", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const scrollableAncestor = document.createElement("div");
    scrollableAncestor.setAttribute("data-testid", "scrollable-ancestor");
    scrollableAncestor.style.width = "300px";
    scrollableAncestor.style.overflowX = "auto";
    const widener = document.createElement("div");
    widener.style.width = "900px";
    widener.style.height = "10px";
    scrollableAncestor.appendChild(widener);
    document.body.appendChild(scrollableAncestor);

    try {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col">
              <SceneObject name="obj" focused>
                <div style={{ width: 100, height: 100 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
        { container: scrollableAncestor },
      );

      expect(warnSpy).toHaveBeenCalled();
      const message = String(warnSpy.mock.calls[0]?.[0]);
      expect(message).toContain("horizontally-scrollable ancestor");
      expect(message).toMatch(/overflow-x:clip/);
    } finally {
      warnSpy.mockRestore();
      scrollableAncestor.remove();
    }
  });
});
