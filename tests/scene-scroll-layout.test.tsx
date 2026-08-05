import { describe, test, expect } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame, awaitStyleFlush } from "./utils/animation";
import { buildScene } from "./utils/sceneFixtures";

// ---------------------------------------------------------------------------
// S7 coverage backfill: Alignment & Centering (scene-scroll.feature, each
// axis handled independently — these assert BOTH axes together in one
// scenario, which the pre-existing per-axis tests above don't do).
// ---------------------------------------------------------------------------

describe("Scene alignment & centering (S7 coverage)", () => {
  test("content fits both axes — centered horizontally and vertically", async () => {
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

    const scene = getByTestId("scene").element() as HTMLElement;
    const contentWrapper = scene.querySelector("[data-ui-scene-column-content]") as HTMLElement;
    const content = getByTestId("content").element() as HTMLElement;

    // ui#17: see awaitStyleFlush's own doc comment (rAF-batched MotionValue
    // writes — a geometry read immediately after render() can observe a
    // stale/default value).
    await awaitStyleFlush();

    // Vertical: margin-top centers the 100px content in the 800px viewport.
    const marginTop = parseFloat(window.getComputedStyle(contentWrapper).marginTop);
    expect(marginTop).toBeGreaterThan(0);
    expect(Math.abs(marginTop - (800 - 100) / 2)).toBeLessThan(2);

    // Horizontal: the stage centers the 200px column in the 1280px viewport.
    const rect = content.getBoundingClientRect();
    expect(Math.abs(rect.left - (1280 - 200) / 2)).toBeLessThan(2);
  });

  test("focused column overflows vertically — top-aligned, still centered horizontally", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              {/* 1000px tall overflows the 800px viewport; 300px wide fits */}
              <div data-testid="content" style={{ minWidth: 300, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const contentWrapper = scene.querySelector("[data-ui-scene-column-content]") as HTMLElement;
    const content = getByTestId("content").element() as HTMLElement;

    // Vertical: top-aligned (no centering margin) since it overflows.
    const marginTop = parseFloat(window.getComputedStyle(contentWrapper).marginTop);
    expect(marginTop).toBe(0);

    // Horizontal: still centered — overflow on one axis doesn't affect the other.
    const rect = content.getBoundingClientRect();
    expect(Math.abs(rect.left - (1280 - 300) / 2)).toBeLessThan(2);
  });

  test("focused columns overflow horizontally — left-aligned, columns still centered vertically", async () => {
    const { getByTestId } = await render(
      // Three 500px columns (1500px total) exceed the 1280px viewport;
      // 100px height fits the 800px viewport.
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
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement;

    // ui#17: see awaitStyleFlush's own doc comment (rAF-batched MotionValue
    // writes — a geometry read immediately after render() can observe a
    // stale/default value).
    await awaitStyleFlush();

    // Horizontal: left-aligned — stage left is 0 (focused region starts at
    // the stage origin, so no leftward pan is needed).
    const stageLeft = parseFloat(window.getComputedStyle(stage).left);
    expect(stageLeft).toBe(0);

    // Vertical: each column's content is still centered independently.
    for (const testId of ["content1", "content2", "content3"]) {
      const contentWrapper = getByTestId(testId)
        .element()
        .closest("[data-ui-scene-column-anchor]")!
        .querySelector("[data-ui-scene-column-content]") as HTMLElement;
      const marginTop = parseFloat(window.getComputedStyle(contentWrapper).marginTop);
      expect(marginTop).toBeGreaterThan(0);
      expect(Math.abs(marginTop - (800 - 100) / 2)).toBeLessThan(2);
    }
  });

  test("focused content overflows both axes — top-left corner visible", async () => {
    const { getByTestId } = await render(
      // 1500px wide and 1000px tall overflow both the 1280x800 viewport.
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 1500, height: 1000, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement;
    const contentWrapper = scene.querySelector("[data-ui-scene-column-content]") as HTMLElement;

    // Horizontal: left-aligned (no leftward pan needed past the origin).
    const stageLeft = parseFloat(window.getComputedStyle(stage).left);
    expect(stageLeft).toBe(0);

    // Vertical: top-aligned (no centering margin).
    const marginTop = parseFloat(window.getComputedStyle(contentWrapper).marginTop);
    expect(marginTop).toBe(0);

    // The content's own top-left corner is therefore at the viewport's
    // top-left corner (0, 0).
    const rect = getByTestId("content").element().getBoundingClientRect();
    expect(Math.abs(rect.left)).toBeLessThan(2);
    expect(Math.abs(rect.top)).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// S7 coverage: scrollbar placement (scene-scroll.feature "Each overflowing
// column gets its own vertical scrollbar") — each overflowing column's
// scrollbar sits at ITS OWN column's right edge (Scrollbar.tsx's track is
// `position: absolute; right: 0` relative to its column). Camera-right-edge
// alignment is emergent, not a rule: it only coincides when a focused
// column's own right edge happens to land on the Camera's, e.g. when
// focused columns' combined width spans the viewport.
// ---------------------------------------------------------------------------

describe("Scene scrollbar placement (S7 coverage)", () => {
  // Fork adjudicated by Michael, 2026-07-21 (main feed 1491: "pin what we
  // have") — no design latitude on this fork; the as-implemented placement
  // IS the ruled behavior. Previously left skipped: the spec's old wording
  // ("the rightmost column's scrollbar should appear at the right edge of
  // the Camera") only holds by coincidence in a fixture where the focused
  // columns' combined width spans the viewport. With two narrower centered
  // 400px columns under the 1280px viewport, the layout CENTERS them (they
  // don't overflow width), so the rightmost column's own right edge lands at
  // ~1040px, not the viewport's 1280px right edge — confirmed by the math
  // (240px centering offset + 800px combined width = 1040). specs/
  // scene-scroll.feature's Then clauses are corrected to the ruled per-
  // column wording; this test now pins to that, not the old Camera-edge
  // letter.
  test("each overflowing column's scrollbar sits at its own column's right edge", async () => {
    const { getByTestId } = await render(
      // Two columns, each individually overflowing vertically, sized to
      // fit side by side within the 1280px viewport.
      buildScene(
        [
          { name: "left", objects: [{ name: "left-obj", focused: true, width: 400, height: 1200, testId: "content-left" }] },
          { name: "right", objects: [{ name: "right-obj", focused: true, width: 400, height: 1200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // The "scene" testid element IS the Camera viewport (viewportRef is
    // attached to the same node, per Scene.tsx).
    const cameraViewport = getByTestId("scene").element() as HTMLElement;
    const cameraRect = cameraViewport.getBoundingClientRect();

    const leftColumn = getByTestId("content-left").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const rightColumn = getByTestId("content-right").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const leftScrollbar = leftColumn.querySelector("[data-ui-scene-scrollbar]") as HTMLElement;
    const rightScrollbar = rightColumn.querySelector("[data-ui-scene-scrollbar]") as HTMLElement;
    expect(leftScrollbar).not.toBeNull();
    expect(rightScrollbar).not.toBeNull();

    // Each column's scrollbar sits at ITS OWN column's right edge.
    const rightColumnRect = rightColumn.getBoundingClientRect();
    const rightScrollbarRect = rightScrollbar.getBoundingClientRect();
    expect(Math.abs(rightScrollbarRect.right - rightColumnRect.right)).toBeLessThan(2);

    const leftColumnRect = leftColumn.getBoundingClientRect();
    const leftScrollbarRect = leftScrollbar.getBoundingClientRect();
    expect(Math.abs(leftScrollbarRect.right - leftColumnRect.right)).toBeLessThan(2);

    // The non-rightmost (left) column's scrollbar therefore sits BETWEEN the
    // two columns, not flush with either the right column or the Camera.
    expect(leftScrollbarRect.right).toBeLessThan(rightColumnRect.left);

    // Documents the ruled divergence from the spec's old "at the Camera
    // edge" wording for this centered, non-width-overflowing fixture: the
    // rightmost column's own right edge doesn't reach the Camera's.
    expect(rightScrollbarRect.right).toBeLessThan(cameraRect.right - 10);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: Gaps and padding
// ---------------------------------------------------------------------------

describe("Scene gaps and padding", () => {
  test("columnGap creates space between focused columns", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} columnGap={40}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div data-testid="content2" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // The stage flex container should have gap applied. Measure the visual gap
    // between the right edge of col1 and the left edge of col2.
    const col1 = getByTestId("content1").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const col2 = getByTestId("content2").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    const right1 = col1.getBoundingClientRect().right;
    const left2 = col2.getBoundingClientRect().left;
    const gap = left2 - right1;

    expect(gap).toBe(40);
  });

  test("objectGap creates space between focused objects in a column", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" objectGap={24}>
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const objA = getByTestId("content-a").element().closest("[data-ui-scene-id]") as HTMLElement;
    const objB = getByTestId("content-b").element().closest("[data-ui-scene-id]") as HTMLElement;

    const bottomA = objA.getBoundingClientRect().bottom;
    const topB = objB.getBoundingClientRect().top;
    const gap = topB - bottomA;

    expect(gap).toBe(24);
  });

  test("default column gap is 8px — columns have 8px space between them", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div data-testid="content2" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const col1 = getByTestId("content1").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const col2 = getByTestId("content2").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    const right1 = col1.getBoundingClientRect().right;
    const left2 = col2.getBoundingClientRect().left;
    expect(left2 - right1).toBe(16);
  });

  test("padding adds space around focused columns in the stage", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} padding={32}>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div data-testid="content" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement | null;
    expect(stage).not.toBeNull();

    const stageStyle = window.getComputedStyle(stage!);
    expect(parseFloat(stageStyle.paddingTop)).toBe(32);
    expect(parseFloat(stageStyle.paddingRight)).toBe(32);
    expect(parseFloat(stageStyle.paddingBottom)).toBe(32);
    expect(parseFloat(stageStyle.paddingLeft)).toBe(32);
  });

  test("default padding is zero", async () => {
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

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement | null;
    expect(stage).not.toBeNull();

    const stageStyle = window.getComputedStyle(stage!);
    expect(parseFloat(stageStyle.padding)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 4: Horizontal scroll (camera movement)
// ---------------------------------------------------------------------------

describe("Scene horizontal scroll", () => {
  test("ui#19 degradation-trap regression pin: computed overflow-x AND overflow-y are BOTH clip, unconditionally — regardless of whether focused content overflows", async () => {
    // CSS Overflow 3's degradation rule: `clip` on one axis silently
    // computes back to `hidden` (resurrecting a real scroll container —
    // exactly the corruption class this arc eliminates) whenever the OTHER
    // axis is anything but `visible` or `clip` itself. Probe-verified
    // before this arc: overflow-x:clip + overflow-y:hidden computed to
    // hidden/hidden, not clip/clip — this is Scene's OWN old real
    // combination (overflow-y was permanently hidden), so simply changing
    // overflow-x alone would have silently re-broken this. Both axes must
    // read "clip" together, in EVERY layout state — checked here in both
    // the overflowing and non-overflowing case, since the retired
    // overflowsX state used to make this conditional.
    const { getByTestId: overflowing } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ minWidth: 800, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div data-testid="content2" style={{ minWidth: 800, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    const overflowingScene = overflowing("scene").element() as HTMLElement;
    expect(overflowingScene.scrollWidth).toBeGreaterThan(overflowingScene.clientWidth);
    const overflowingStyle = window.getComputedStyle(overflowingScene);
    expect(overflowingStyle.overflowX).toBe("clip");
    expect(overflowingStyle.overflowY).toBe("clip");
    // cleanup() (not unmount()) between mounts within one test — matches
    // this file's established pattern (see the "AnotherStrayReadout"
    // remount test above) for remounting without destabilizing subsequent
    // tests' render roots.
    await cleanup();

    const { getByTestId: fitting } = await render(
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
    const fittingScene = fitting("scene").element() as HTMLElement;
    expect(fittingScene.scrollWidth).toBe(fittingScene.clientWidth);
    const fittingStyle = window.getComputedStyle(fittingScene);
    expect(fittingStyle.overflowX).toBe("clip");
    expect(fittingStyle.overflowY).toBe("clip");
  });

  test("focused columns fit viewport — no horizontal overflow", async () => {
    // A 200px column in a 1280px viewport fits — no overflow.
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
    // No overflow — scrollWidth should equal clientWidth
    expect(scene.scrollWidth).toBe(scene.clientWidth);
  });

  test("horizontal scroll range = total focused width - viewport width", async () => {
    // Two 800px columns → 1600px total. In a 1280px viewport, scroll range ≥ 320px.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ minWidth: 800, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div data-testid="content2" style={{ minWidth: 800, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // scrollWidth - clientWidth should be ≥ 320px (the overflow amount)
    const scrollRange = scene.scrollWidth - scene.clientWidth;
    expect(scrollRange).toBeGreaterThanOrEqual(320);
  });

  test("stage left is recomputed to center focused content on focus change", async () => {
    // On focus layout change, the Camera recomputes stageLeft to center the new
    // focused region. With one 800px focused column in a 1280px viewport,
    // stageLeft = (1280 - 800) / 2 = 240px.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ minWidth: 800, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div data-testid="content2" style={{ minWidth: 800, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement | null;
    expect(stage).not.toBeNull();

    // Two 800px columns → 1600px total, overflows 1280px viewport → stageLeft = 0
    const stageLeftInitial = parseFloat(window.getComputedStyle(stage!).left);
    expect(stageLeftInitial).toBe(0);

    // Change focus layout — col2 becomes unfocused, col1 (800px) is the only focused column
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ minWidth: 800, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused={false}>
              <div data-testid="content2" style={{ minWidth: 800, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // stageLeft = (1280 - 800) / 2 - 0 = 240 (focused column is at stage origin)
    const stageLeftAfter = parseFloat(window.getComputedStyle(stage!).left);
    expect(stageLeftAfter).toBeGreaterThan(0);
  });

  test("pan resets when the focused column set changes, even if the new layout still overflows (B1, ui#19: panOffset replaces native scrollLeft)", async () => {
    // Four 500px columns; three are focused at a time (a sliding window) so
    // the focused region overflows the 1280px viewport in both the before
    // and after layouts. This isolates the real bug B1 guards against: the
    // Camera's stageLeft re-centers for the newly-focused region, but
    // nothing resets a separate user-pan layer, which would otherwise stay
    // stuck at an offset calibrated to the OLD focused region.
    const { rerender, getByTestId } = await render(
      buildScene(
        [
          { name: "col1", objects: [{ name: "obj1", focused: true, width: 500, height: 100, testId: "content1" }] },
          { name: "col2", objects: [{ name: "obj2", focused: true, width: 500, height: 100, testId: "content2" }] },
          { name: "col3", objects: [{ name: "obj3", focused: true, width: 500, height: 100, testId: "content3" }] },
          { name: "col4", objects: [{ name: "obj4", focused: false, width: 500, height: 100, testId: "content4" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement;
    expect(window.getComputedStyle(scene).overflowX).toBe("clip");

    const canonicalBeforePan = stage.style.left;

    // Synthetic wheel deltaX through the REAL handler (not a direct
    // scrollLeft write — that's a permanent no-op under clip, confirmed
    // elsewhere in this file) establishes a nonzero pan.
    const sceneRect = scene.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 300,
        deltaY: 0,
        clientX: sceneRect.left + sceneRect.width / 2,
        clientY: sceneRect.top + sceneRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();
    expect(stage.style.left).not.toBe(canonicalBeforePan);

    // Focus shifts to a different column set (col2+col3+col4 instead of
    // col1+col2+col3) — the layout as a whole still overflows the viewport.
    await rerender(
      buildScene(
        [
          { name: "col1", objects: [{ name: "obj1", focused: false, width: 500, height: 100, testId: "content1" }] },
          { name: "col2", objects: [{ name: "obj2", focused: true, width: 500, height: 100, testId: "content2" }] },
          { name: "col3", objects: [{ name: "obj3", focused: true, width: 500, height: 100, testId: "content3" }] },
          { name: "col4", objects: [{ name: "obj4", focused: true, width: 500, height: 100, testId: "content4" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );
    await waitForAnimationFrame();

    expect(window.getComputedStyle(scene).overflowX).toBe("clip");
    // Proof that the pan reset to 0 (not merely that stage.left moved SOME
    // amount — a stale nonzero pan compounded onto the new canonical would
    // ALSO move stage.left, just to the WRONG place): compare against a
    // fresh, never-panned render of the identical post-rerender layout.
    // Never asserts on scrollLeft (ui#19 — scrollLeft is not the mechanism
    // anymore). Captured before cleanup(), even though .style is a plain
    // property on the (still-referenced) detached element and would read
    // back fine either way — avoids any ambiguity about DOM-connection.
    const stageLeftAfterReset = stage.style.left;
    await cleanup();
    const { getByTestId: fresh } = await render(
      buildScene(
        [
          { name: "col1", objects: [{ name: "obj1", focused: false, width: 500, height: 100, testId: "content1" }] },
          { name: "col2", objects: [{ name: "obj2", focused: true, width: 500, height: 100, testId: "content2" }] },
          { name: "col3", objects: [{ name: "obj3", focused: true, width: 500, height: 100, testId: "content3" }] },
          { name: "col4", objects: [{ name: "obj4", focused: true, width: 500, height: 100, testId: "content4" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );
    const freshScene = fresh("scene").element() as HTMLElement;
    const freshStage = freshScene.querySelector("[data-ui-scene-stage]") as HTMLElement;
    expect(parseFloat(stageLeftAfterReset)).toBeCloseTo(parseFloat(freshStage.style.left), 0);
  });

  // H10 test DELETED (ui#19 slice (a)) — obsolete, not failing: it pinned
  // clientHeight stability across the OLD overflowX auto<->hidden toggle,
  // which no longer exists (overflow is now unconditionally clip on both
  // axes, never toggling). The wobble H10 investigated can no longer occur
  // even in principle — clip never establishes a scrollbar under any
  // circumstance, so there's nothing left for this pin to guard against.
  // See Scene.tsx's viewport style comment (ui#19) for the historical
  // writeup; git history has the full original investigation and test.
});

// ---------------------------------------------------------------------------
// Phase 5: Vertical scroll (per-column JS scroll state)
// ---------------------------------------------------------------------------

describe("Scene vertical scroll", () => {
  test("column taller than viewport gets a vertical scrollbar", async () => {
    // A focused column whose content height exceeds the viewport height should
    // have a scrollbar rendered ([data-ui-scene-scrollbar] element inside the column).
    const { getByTestId } = await render(
      buildScene(
        [
          {
            name: "col",
            objects: [
              // Taller than the 800px viewport.
              { name: "object", focused: true, width: 400, height: 1200, testId: "content" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // A scrollbar should be present for the overflowing column
    const scrollbar = scene.querySelector("[data-ui-scene-scrollbar]");
    expect(scrollbar).not.toBeNull();
  });

  test("column fitting viewport has no scrollbar", async () => {
    // A focused column whose content fits within the viewport height should not
    // have a scrollbar rendered.
    const { getByTestId } = await render(
      buildScene(
        [
          {
            name: "col",
            objects: [
              // Shorter than the 800px viewport.
              { name: "object", focused: true, width: 400, height: 200, testId: "content" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const scrollbar = scene.querySelector("[data-ui-scene-scrollbar]");
    expect(scrollbar).toBeNull();
  });

  test("scroll range = focused content height - viewport height", async () => {
    // The scrollbar thumb size should reflect the scroll range:
    // maxScroll = contentHeight - viewportHeight = 1200 - 800 = 400
    // The thumb should not be at the top AND be smaller than the track,
    // showing that scroll range > 0.
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 400, height: 1200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-ui-scene-column-anchor]") as HTMLElement;

    // Column should expose its scroll state on a data attribute
    const maxScroll = column.getAttribute("data-ui-scene-max-scroll");
    expect(maxScroll).not.toBeNull();
    // maxScroll = 1200 - 800 = 400 (approximately)
    expect(parseFloat(maxScroll!)).toBeGreaterThan(0);
  });

  test("unfocused objects in column don't extend scroll range", async () => {
    // Only focused content should contribute to the scroll range.
    // An unfocused sibling is position: absolute (out of flow) and should not
    // extend maxScroll.
    const { getByTestId } = await render(
      buildScene(
        [
          {
            name: "col",
            objects: [
              // Fits within viewport.
              { name: "focused-obj", focused: true, width: 400, height: 300, testId: "content-a" },
              // Would overflow if counted — but it's unfocused.
              { name: "unfocused-obj", focused: false, width: 400, height: 1200, testId: "content-b" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // Only focused content (300px) fits within 800px viewport — no scrollbar
    const scrollbar = scene.querySelector("[data-ui-scene-scrollbar]");
    expect(scrollbar).toBeNull();
  });

  test("scroll offset drives column content top position", async () => {
    // When a wheel event fires with deltaY=100, the column content wrapper
    // should move its top offset by -100 (content slides up by 100px).
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 400, height: 1200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-ui-scene-column-anchor]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-ui-scene-column-content]") as HTMLElement;

    // Get position of the column center for the wheel event target
    const columnRect = column.getBoundingClientRect();
    const centerX = columnRect.left + columnRect.width / 2;
    const centerY = columnRect.top + columnRect.height / 2;

    // Before scroll: top should be 0
    const topBefore = parseFloat(contentWrapper.style.top || "0");
    expect(topBefore).toBe(0);

    // Fire a wheel event on the viewport with deltaY=100
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 100,
        clientX: centerX,
        clientY: centerY,
        bubbles: true,
        cancelable: true,
      }),
    );

    // Wait for React state update and motion to apply the new top value.
    // Two rAF ticks: one for React commit, one for motion's style write.
    // duration=0 commits immediately in theory, but motion v12 sometimes
    // delays the inline-style write to the following frame.
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    // After scroll: top should be -100 (content moved up)
    const topAfter = parseFloat(contentWrapper.style.top || "0");
    expect(topAfter).toBe(-100);
  });

  test("non-overflowing sibling stays centered during scroll", async () => {
    // When one column scrolls vertically, a non-overflowing sibling column
    // should remain centered (unaffected by the other column's scroll state).
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "tall-col", objects: [{ name: "tall-object", focused: true, width: 400, height: 1200, testId: "tall-content" }] },
          { name: "short-col", objects: [{ name: "short-object", focused: true, width: 400, height: 200, testId: "short-content" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;

    // Find the tall column to target the wheel event at it
    const tallColumn = getByTestId("tall-content")
      .element()
      .closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const tallRect = tallColumn.getBoundingClientRect();
    const tallCenterX = tallRect.left + tallRect.width / 2;
    const tallCenterY = tallRect.top + tallRect.height / 2;

    // Get the short column's content wrapper margin-top before scroll
    const shortColumn = getByTestId("short-content")
      .element()
      .closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const shortContent = shortColumn.querySelector("[data-ui-scene-column-content]") as HTMLElement;
    // ui#17: see awaitStyleFlush's own doc comment (rAF-batched MotionValue
    // writes — a geometry read immediately after render() can observe a
    // stale/default value).
    await awaitStyleFlush();
    const marginTopBefore = parseFloat(window.getComputedStyle(shortContent).marginTop);
    expect(marginTopBefore).toBeGreaterThan(0); // should be centered

    // Scroll the tall column
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 200,
        clientX: tallCenterX,
        clientY: tallCenterY,
        bubbles: true,
        cancelable: true,
      }),
    );

    // Wait for React state update to propagate
    await waitForAnimationFrame();

    // Short column's centering should be unaffected
    const marginTopAfter = parseFloat(window.getComputedStyle(shortContent).marginTop);
    expect(marginTopAfter).toBe(marginTopBefore);
  });

  test("async content growth without a prop change updates maxScroll and shows a scrollbar (B2)", async () => {
    // Simulates e.g. an image finishing load and growing its container's
    // intrinsic height — no Scene prop changes, so nothing else would
    // trigger a re-render. The geometry store's ResizeObserver must pick
    // this up on its own.
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 400, height: 300, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // Content fits the 800px viewport initially — no scrollbar yet.
    expect(scene.querySelector("[data-ui-scene-scrollbar]")).toBeNull();

    // Grow the content directly via the DOM — no React re-render, no prop change.
    const content = getByTestId("content").element() as HTMLElement;
    content.style.height = "2500px";

    // Poll for the ResizeObserver-driven update (probe-measured ~1 rAF
    // frame in this harness; generous headroom against occasional slow frames).
    const column = scene.querySelector("[data-ui-scene-column-anchor]") as HTMLElement;
    let maxScroll = 0;
    for (let i = 0; i < 20; i++) {
      await waitForAnimationFrame();
      maxScroll = parseFloat(column.getAttribute("data-ui-scene-max-scroll") ?? "0");
      if (maxScroll > 0) break;
    }

    expect(maxScroll).toBeGreaterThan(0);
    expect(scene.querySelector("[data-ui-scene-scrollbar]")).not.toBeNull();
  });
});
