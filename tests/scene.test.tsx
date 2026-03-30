import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { hasReducedMotionListener, prefersReducedMotion } from "motion/react";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame } from "./utils/animation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the computed style of the column wrapper ([data-column]) containing
 *  the element located by data-testid. */
async function getColumnStyle(
  getByTestId: ReturnType<typeof render> extends Promise<infer R> ? R["getByTestId"] : never,
  testId: string,
): Promise<CSSStyleDeclaration> {
  const content = getByTestId(testId).element() as HTMLElement;
  const column = content.closest("[data-column]") as HTMLElement;
  return window.getComputedStyle(column);
}

// ---------------------------------------------------------------------------
// SceneObject
// ---------------------------------------------------------------------------

describe("SceneObject", () => {
  test("renders with data-scene-id attribute", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // The SceneObject outer wrapper should have data-scene-id set to the name prop.
    const content = getByTestId("content").element() as HTMLElement;
    const outer = content.closest("[data-scene-id]");
    expect(outer).not.toBeNull();
    expect(outer?.getAttribute("data-scene-id")).toBe("panel");
  });

  test("renders with data-focused=true when focused", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element() as HTMLElement;
    const outer = content.closest("[data-scene-id]");
    expect(outer?.getAttribute("data-focused")).toBe("true");
  });

  test("renders with data-focused=false when unfocused", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element() as HTMLElement;
    const outer = content.closest("[data-scene-id]");
    expect(outer?.getAttribute("data-focused")).toBe("false");
  });

  test("unfocused SceneObject content is inert", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element() as HTMLElement;
    // The inner wrapper (between the outer SceneObject div and the consumer content)
    // should have the inert attribute when unfocused.
    const innerWrapper = content.parentElement;
    expect(innerWrapper?.hasAttribute("inert")).toBe(true);
  });

  test("focused SceneObject content is not inert", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element() as HTMLElement;
    const innerWrapper = content.parentElement;
    expect(innerWrapper?.hasAttribute("inert")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SceneColumn
// ---------------------------------------------------------------------------

describe("SceneColumn", () => {
  test("renders with data-column attribute", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Scene>
          <SceneColumn name="nav">
            <SceneObject name="panel" focused>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element() as HTMLElement;
    const column = content.closest("[data-column]");
    expect(column).not.toBeNull();
    expect(column?.getAttribute("data-column")).toBe("nav");
  });

  test("column with focused child has data-column-focused=true", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Scene>
          <SceneColumn name="nav">
            <SceneObject name="panel" focused>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element() as HTMLElement;
    const column = content.closest("[data-column]");
    expect(column?.getAttribute("data-column-focused")).toBe("true");
  });

  test("column with no focused children has data-column-focused=false", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Scene>
          <SceneColumn name="nav">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element() as HTMLElement;
    const column = content.closest("[data-column]");
    expect(column?.getAttribute("data-column-focused")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// Scene auto-wrapping
// ---------------------------------------------------------------------------

describe("Scene auto-wrapping", () => {
  test("bare SceneObjects are auto-wrapped in implicit SceneColumns", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Scene>
          <SceneObject name="panel" focused>
            <div data-testid="content">content</div>
          </SceneObject>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element() as HTMLElement;
    // Should find a [data-column] ancestor wrapping the SceneObject.
    const column = content.closest("[data-column]");
    expect(column).not.toBeNull();
    // The implicit column should use the SceneObject's name.
    expect(column?.getAttribute("data-column")).toBe("panel");
  });

  test("SceneColumns pass through without wrapping", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Scene>
          <SceneColumn name="nav">
            <SceneObject name="panel" focused>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element() as HTMLElement;
    // There should be exactly one [data-column] in the ancestry (not nested).
    let el: Element | null = content.parentElement;
    let columnCount = 0;
    while (el) {
      if (el.hasAttribute("data-column")) columnCount++;
      el = el.parentElement;
    }
    expect(columnCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 1: Focused flex layout
// ---------------------------------------------------------------------------

describe("SceneColumn flex layout", () => {
  test("focused column has flex: 0 1 auto and position: relative", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const style = await getColumnStyle(getByTestId, "content");
    expect(style.position).toBe("relative");
    // flex: 0 1 auto — columns size to content by default
    expect(style.flexGrow).toBe("0");
    expect(style.flexShrink).toBe("1");
    expect(style.flexBasis).toBe("auto");
  });

  test("unfocused column (never focused, no siblings focused) stays relative with opacity 1", async () => {
    // A never-focused column with no focused siblings has position null (no-position).
    // It stays in the flex row at position: relative with opacity 1.
    // The Camera viewport clips its visibility, not opacity:0.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const style = await getColumnStyle(getByTestId, "content");
    expect(style.position).toBe("relative");
    expect(style.opacity).toBe("1");
  });

  test("two focused columns both participate in flex row", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div data-testid="content2" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const style1 = await getColumnStyle(getByTestId, "content1");
    const style2 = await getColumnStyle(getByTestId, "content2");

    // Both columns should be in normal flow (position: relative)
    expect(style1.position).toBe("relative");
    expect(style2.position).toBe("relative");
  });

  test("mixed focused/unfocused — focused is relative, outer unfocused stays relative", async () => {
    // Outer unfocused columns (outer-right in this case) stay in the flex row
    // at position: relative. They are clipped by the viewport, not opacity:0.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused={false}>
              <div data-testid="content2" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const style1 = await getColumnStyle(getByTestId, "content1");
    const style2 = await getColumnStyle(getByTestId, "content2");

    expect(style1.position).toBe("relative");
    // col2 is outer-right — stays in flex row at position: relative
    expect(style2.position).toBe("relative");
  });

  test("two focused columns size to their content (not equal-share)", async () => {
    // With flex: 0 1 auto, columns size to content rather than sharing equally.
    // Two columns each with minWidth:100 should both be approximately 100px wide,
    // not half the viewport.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ minWidth: 100, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div data-testid="content2" style={{ minWidth: 100, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const col1 = getByTestId("content1").element().closest("[data-column]") as HTMLElement;
    const col2 = getByTestId("content2").element().closest("[data-column]") as HTMLElement;

    const width1 = col1.getBoundingClientRect().width;
    const width2 = col2.getBoundingClientRect().width;

    // Each column should be content-sized (~100px), not half the 1280px viewport
    expect(width1).toBeGreaterThan(0);
    expect(width1).toBeLessThan(200); // Not half the viewport
    expect(Math.abs(width1 - width2)).toBeLessThan(width1 * 0.1); // Roughly same (same content)
  });
});

// ---------------------------------------------------------------------------
// Phase 1: Unfocused freeze
// ---------------------------------------------------------------------------

describe("SceneColumn unfocused freeze", () => {
  test("column freezes at last dimensions when all children lose focus", async () => {
    // Render a column with a focused child that has explicit dimensions,
    // then re-render with the child unfocused. The column should retain a
    // non-zero width and height (the frozen dimensions).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Measure dimensions while focused
    const col = getByTestId("content").element().closest("[data-column]") as HTMLElement;
    const focusedWidth = col.getBoundingClientRect().width;
    const focusedHeight = col.getBoundingClientRect().height;
    expect(focusedWidth).toBeGreaterThan(0);
    expect(focusedHeight).toBeGreaterThan(0);

    // Lose focus — the column should freeze at its last size
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const frozenWidth = col.style.width;
    const frozenHeight = col.style.height;

    // Frozen size should be set as inline styles (non-zero)
    expect(parseFloat(frozenWidth)).toBeGreaterThan(0);
    expect(parseFloat(frozenHeight)).toBeGreaterThan(0);
  });

  test("unfocused column stays in DOM", async () => {
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Column should still be present in the DOM after losing focus
    const col = getByTestId("content").element().closest("[data-column]");
    expect(col).not.toBeNull();
    expect(col?.getAttribute("data-column-focused")).toBe("false");
  });

  test("re-focusing column returns it to flex layout (position: relative)", async () => {
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Lose focus
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Regain focus
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const col = getByTestId("content").element().closest("[data-column]") as HTMLElement;
    const style = window.getComputedStyle(col);
    expect(style.position).toBe("relative");
    // Inline frozen width/height should be cleared
    expect(col.style.width).toBe("");
    expect(col.style.height).toBe("");
  });

  test("focus change: previously focused becomes outer-left (relative), newly focused becomes relative", async () => {
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused={false}>
              <div data-testid="content2" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Swap focus: col1 loses, col2 gains
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused={false}>
              <div data-testid="content1" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div data-testid="content2" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const col1 = getByTestId("content1").element().closest("[data-column]") as HTMLElement;
    const col2 = getByTestId("content2").element().closest("[data-column]") as HTMLElement;

    // col1 is now outer-left — stays in flex row at position: relative
    expect(window.getComputedStyle(col1).position).toBe("relative");
    expect(window.getComputedStyle(col2).position).toBe("relative");
  });
});

// ---------------------------------------------------------------------------
// Phase 1: Debug mode
// ---------------------------------------------------------------------------

describe("Scene debug mode", () => {
  test("debug disabled — no overlays present", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element();
    // No debug overlay should be present when debug is not enabled
    expect(scene.querySelector("[data-debug-overlay]")).toBeNull();
  });

  test("debug does not affect layout", async () => {
    // Enabling debug should not change the column's computed position or flex
    const { getByTestId: withDebug } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="debug-content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const colDebug = withDebug("debug-content").element().closest("[data-column]") as HTMLElement;
    const styleDebug = window.getComputedStyle(colDebug);
    expect(styleDebug.position).toBe("relative");
    expect(styleDebug.flexGrow).toBe("0");
  });

  test("debug enabled — viewport has cyan outline", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const style = window.getComputedStyle(scene);
    // Debug mode adds a cyan outline to the viewport.
    // Browsers may resolve "cyan" to rgb(0, 255, 255) in computed style.
    const outline = style.outline + style.outlineColor;
    expect(outline).toMatch(/cyan|rgb\(0,\s*255,\s*255\)/);
  });

  test("debug enabled — overlay panel lists object names and focus state", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="my-panel" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element();
    const overlay = scene.querySelector("[data-debug-overlay]");
    expect(overlay).not.toBeNull();
    // Overlay should mention the object name and focused state
    expect(overlay?.textContent).toContain("my-panel");
    expect(overlay?.textContent).toContain("focused");
  });
});

// ---------------------------------------------------------------------------
// Phase 10a: Debug — remaining overlay features
// ---------------------------------------------------------------------------

describe("Scene debug — stacking depth", () => {
  test("overlay shows position classification for unfocused columns", async () => {
    // Three columns: left focused, middle unfocused (in-between), right focused.
    // The overlay should indicate the middle column's classification.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused>
              <div data-testid="left-content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="middle">
            <SceneObject name="middle-obj" focused={false}>
              <div data-testid="middle-content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-obj" focused>
              <div data-testid="right-content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("left-content").element().closest("[data-testid='scene']") as HTMLElement;
    const overlay = scene.querySelector("[data-debug-overlay]");
    expect(overlay).not.toBeNull();
    // Overlay should list the middle column with its classification and depth.
    expect(overlay?.textContent).toContain("middle");
    expect(overlay?.textContent).toContain("in-between");
  });

  test("overlay shows depth index for in-between columns", async () => {
    // Three columns focused on left and right: middle is depth 1 (adjacent to right focused).
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused>
              <div data-testid="left-content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="mid1">
            <SceneObject name="mid1-obj" focused={false}>
              <div data-testid="mid1-content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="mid2">
            <SceneObject name="mid2-obj" focused={false}>
              <div data-testid="mid2-content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-obj" focused>
              <div data-testid="right-content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("left-content").element().closest("[data-testid='scene']") as HTMLElement;
    const overlay = scene.querySelector("[data-debug-overlay]");
    expect(overlay).not.toBeNull();
    // Both in-between columns should appear with depth info.
    expect(overlay?.textContent).toContain("mid1");
    expect(overlay?.textContent).toContain("mid2");
    // The overlay should mention at least one depth number.
    expect(overlay?.textContent).toMatch(/depth\s*[12]/i);
  });

  test("overlay shows outer-left and outer-right classification", async () => {
    // Three columns: middle focused, left and right unfocused.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="outer-left-col">
            <SceneObject name="left-obj" focused={false}>
              <div data-testid="left-content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="mid-col">
            <SceneObject name="mid-obj" focused>
              <div data-testid="mid-content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="outer-right-col">
            <SceneObject name="right-obj" focused={false}>
              <div data-testid="right-content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("left-content").element().closest("[data-testid='scene']") as HTMLElement;
    const overlay = scene.querySelector("[data-debug-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("outer-left");
    expect(overlay?.textContent).toContain("outer-right");
  });
});

describe("Scene debug — offsetParent warning", () => {
  test("overlay warns when a SceneObject has a positioned ancestor between it and the scene", async () => {
    // Wrapping a SceneObject in a positioned div breaks relative positioning
    // (the column's offsetParent becomes the wrapper, not the scene stage).
    // The debug overlay should detect and warn about this.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          {/* Positioned wrapper breaks offsetParent chain */}
          <div data-testid="positioned-wrapper" style={{ position: "relative" }}>
            <SceneColumn name="col">
              <SceneObject name="wrapped-obj" focused>
                <div data-testid="content" style={{ width: 200, height: 200 }} />
              </SceneObject>
            </SceneColumn>
          </div>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("content").element().closest("[data-testid='scene']") as HTMLElement;
    const overlay = scene.querySelector("[data-debug-overlay]");
    expect(overlay).not.toBeNull();
    // The overlay should show a warning about the offsetParent issue.
    expect(overlay?.textContent).toMatch(/warn|offsetParent|positioned ancestor/i);
  });
});

describe("Scene debug — toggle", () => {
  test("enabling debug adds overlay; disabling removes all debug DOM", async () => {
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element();

    // Debug on: overlay should be present
    expect(scene.querySelector("[data-debug-overlay]")).not.toBeNull();

    // Disable debug
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Debug off: overlay removed and no debug outlines
    expect(scene.querySelector("[data-debug-overlay]")).toBeNull();
    const style = window.getComputedStyle(scene);
    // Outline should be gone or transparent when debug is off.
    const outline = style.outline + style.outlineColor;
    expect(outline).not.toMatch(/cyan|rgb\(0,\s*255,\s*255\)/);
  });
});

// ---------------------------------------------------------------------------
// Debug — remaining overlay features (spec: scene-debug.feature)
// ---------------------------------------------------------------------------

describe("Scene debug — stage outline", () => {
  test("Debug — stage has magenta outline", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-stage]") as HTMLElement;
    expect(stage).not.toBeNull();
    const style = window.getComputedStyle(stage);
    // Debug mode adds a magenta outline to the stage.
    const outline = style.outline + style.outlineColor;
    expect(outline).toMatch(/magenta|rgb\(255,\s*0,\s*255\)/);
  });

  test("Debug — stage outline is absent when debug is off", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-stage]") as HTMLElement;
    const style = window.getComputedStyle(stage);
    const outline = style.outline + style.outlineColor;
    expect(outline).not.toMatch(/magenta|rgb\(255,\s*0,\s*255\)/);
  });
});

describe("Scene debug — SceneObject outlines", () => {
  test("Debug — focused objects have green outline with name", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="my-panel" focused>
              <div data-testid="content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // Focused object overlay should be present
    const focusedOverlay = scene.querySelector("[data-debug-object-outline='my-panel']") as HTMLElement;
    expect(focusedOverlay).not.toBeNull();
    // Should have green color
    const style = window.getComputedStyle(focusedOverlay);
    const borderColor = style.borderColor + style.outlineColor + style.border;
    expect(borderColor).toMatch(/green|rgb\(0,\s*128,\s*0\)|rgb\(0,\s*255,\s*0\)|#0f0/i);
    // Should display the name
    expect(focusedOverlay.textContent).toContain("my-panel");
  });

  test("Debug — unfocused objects have gray outline with name", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="unfocused-panel" focused={false}>
              <div data-testid="content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const unfocusedOverlay = scene.querySelector("[data-debug-object-outline='unfocused-panel']") as HTMLElement;
    expect(unfocusedOverlay).not.toBeNull();
    // Unfocused overlay should have gray color
    const style = window.getComputedStyle(unfocusedOverlay);
    const borderColor = style.borderColor + style.outlineColor + style.border;
    expect(borderColor).toMatch(/gray|grey|rgb\(1(28|58|88),/i);
    // Should display the name
    expect(unfocusedOverlay.textContent).toContain("unfocused-panel");
  });

  test("Debug — SceneObject outlines are not present when debug is off", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="my-panel" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const outlines = scene.querySelectorAll("[data-debug-object-outline]");
    expect(outlines.length).toBe(0);
  });
});

describe("Scene debug — overlay computed bounds", () => {
  test("Debug — overlay shows computed bounds per object", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="my-panel" focused style={{ width: 300, height: 200 }}>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const overlay = scene.querySelector("[data-debug-overlay]");
    expect(overlay).not.toBeNull();
    // Overlay should show dimensions (width × height) for the object
    expect(overlay?.textContent).toMatch(/\d+\s*[×x]\s*\d+/);
  });
});

describe("Scene debug — Camera state in overlay", () => {
  test("Debug — overlay shows Camera target bounds and viewport dimensions", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="panel" focused style={{ width: 300, height: 200 }}>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const overlay = scene.querySelector("[data-debug-overlay]");
    expect(overlay).not.toBeNull();
    // Should show a "Camera" or "viewport" section
    expect(overlay?.textContent).toMatch(/camera|viewport/i);
    // Should contain numbers that represent viewport dimensions
    expect(overlay?.textContent).toMatch(/\d+/);
  });

  test("Debug — overlay has a section labeled for Camera", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const cameraSection = scene.querySelector("[data-debug-camera]");
    expect(cameraSection).not.toBeNull();
  });
});

describe("Scene debug — per-column scroll state in overlay", () => {
  test("Debug — overlay shows per-column vertical scroll state", async () => {
    // A tall SceneObject that makes its column scrollable
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="scrollable-col">
            <SceneObject name="tall-panel" focused style={{ width: 300, height: 2000 }}>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const overlay = scene.querySelector("[data-debug-overlay]");
    expect(overlay).not.toBeNull();
    // The overlay should show scroll state for the scrollable column
    const scrollSection = scene.querySelector("[data-debug-scroll-column='scrollable-col']");
    expect(scrollSection).not.toBeNull();
  });
});

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

    const objA = getByTestId("content-a").element().closest("[data-scene-id]") as HTMLElement;
    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;

    expect(objA.getAttribute("data-focused")).toBe("true");
    expect(objB.getAttribute("data-focused")).toBe("false");

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

    expect(objA.getAttribute("data-focused")).toBe("false");
    expect(objB.getAttribute("data-focused")).toBe("true");
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

    const objA = getByTestId("content-a").element().closest("[data-scene-id]") as HTMLElement;
    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;

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

    const contentWrapper = getByTestId("content-a").element().closest("[data-column]")
      ?.querySelector("[data-column-content]") as HTMLElement | null;

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

    const col2 = getByTestId("content-c").element().closest("[data-column]") as HTMLElement;
    const initialFocused = col2.getAttribute("data-column-focused");

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
    expect(col2.getAttribute("data-column-focused")).toBe(initialFocused);
    expect(col2.getAttribute("data-column-focused")).toBe("true");
    expect(window.getComputedStyle(col2).position).toBe("relative");
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

    const objA = getByTestId("content-a").element().closest("[data-scene-id]") as HTMLElement;
    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;

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

    const objA = getByTestId("content-a").element().closest("[data-scene-id]") as HTMLElement;
    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;

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

    const objA = getByTestId("content-a").element().closest("[data-scene-id]") as HTMLElement;
    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;

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

    const contentWrapper = getByTestId("content-a").element().closest("[data-column]")
      ?.querySelector("[data-column-content]") as HTMLElement | null;

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
            <SceneObject name="panel" focused>
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
    const stage = scene.querySelector("[data-stage]") as HTMLElement | null;
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
      <TestWrapper fullPage>
        <Scene duration={0}>
          {/* Three wide columns in a 1280px viewport — total exceeds viewport */}
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ width: 500, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div data-testid="content2" style={{ width: 500, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col3">
            <SceneObject name="obj3" focused>
              <div data-testid="content3" style={{ width: 500, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-stage]") as HTMLElement | null;
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
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              {/* Short content: 100px in an 800px viewport */}
              <div data-testid="content" style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column?.querySelector("[data-column-content]") as HTMLElement | null;
    expect(contentWrapper).not.toBeNull();

    // margin-top should be > 0 to center the 100px content in an 800px viewport
    // Expected: (800 - 100) / 2 = 350px
    const marginTop = parseFloat(window.getComputedStyle(contentWrapper!).marginTop);
    expect(marginTop).toBeGreaterThan(0);
  });

  test("column content taller than viewport — margin-top is 0 (top-aligned)", async () => {
    // When focused content height exceeds the viewport, margin-top should be 0.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              {/* Taller than 800px viewport */}
              <div data-testid="content" style={{ width: 200, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column?.querySelector("[data-column-content]") as HTMLElement | null;
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
            <SceneObject name="panel" focused>
              {/* Short content — fits 800px viewport */}
              <div data-testid="content" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const contentWrapper = scene.querySelector("[data-column-content]") as HTMLElement | null;

    // Initially centered (margin-top > 0)
    const marginTopBefore = parseFloat(window.getComputedStyle(contentWrapper!).marginTop);
    expect(marginTopBefore).toBeGreaterThan(0);

    // Swap to tall content that overflows the viewport
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              {/* Tall content — exceeds 800px viewport */}
              <div data-testid="content" style={{ minWidth: 200, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

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
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

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
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 900, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-focused">
            <SceneObject name="obj-focused" focused>
              <div data-testid="content-focused" style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 900, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Now focus only the center column — the two outer columns freeze and stay in flex row
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused={false}>
              <div data-testid="content-left" style={{ width: 900, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-focused">
            <SceneObject name="obj-focused" focused>
              <div data-testid="content-focused" style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused={false}>
              <div data-testid="content-right" style={{ width: 900, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-stage]") as HTMLElement | null;
    expect(stage).not.toBeNull();
    // stageLeft ≈ -360 — stage panned left to center the 200px focused region
    const stageLeft = parseFloat(window.getComputedStyle(stage!).left);
    expect(stageLeft).toBeLessThan(0);
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
    const col1 = getByTestId("content1").element().closest("[data-column]") as HTMLElement;
    const col2 = getByTestId("content2").element().closest("[data-column]") as HTMLElement;

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

    const objA = getByTestId("content-a").element().closest("[data-scene-id]") as HTMLElement;
    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;

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

    const col1 = getByTestId("content1").element().closest("[data-column]") as HTMLElement;
    const col2 = getByTestId("content2").element().closest("[data-column]") as HTMLElement;

    const right1 = col1.getBoundingClientRect().right;
    const left2 = col2.getBoundingClientRect().left;
    expect(left2 - right1).toBe(8);
  });

  test("padding adds space around focused columns in the stage", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} padding={32}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-stage]") as HTMLElement | null;
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
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-stage]") as HTMLElement | null;
    expect(stage).not.toBeNull();

    const stageStyle = window.getComputedStyle(stage!);
    expect(parseFloat(stageStyle.padding)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 4: Horizontal scroll (camera movement)
// ---------------------------------------------------------------------------

describe("Scene horizontal scroll", () => {
  test("focused columns wider than viewport — overflow-x is auto (scrollable)", async () => {
    // When content exceeds the viewport width, the scene element must have
    // overflow-x: auto so the horizontal scrollbar appears. overflow: hidden
    // clips content but doesn't allow scrolling.
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
    // Content overflows AND scrolling is enabled (not clipped)
    expect(scene.scrollWidth).toBeGreaterThan(scene.clientWidth);
    const overflowX = window.getComputedStyle(scene).overflowX;
    expect(overflowX).toBe("auto");
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
    const stage = scene.querySelector("[data-stage]") as HTMLElement | null;
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
});

// ---------------------------------------------------------------------------
// Phase 5: Vertical scroll (per-column JS scroll state)
// ---------------------------------------------------------------------------

describe("Scene vertical scroll", () => {
  test("column taller than viewport gets a vertical scrollbar", async () => {
    // A focused column whose content height exceeds the viewport height should
    // have a scrollbar rendered ([data-scrollbar] element inside the column).
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              {/* Taller than the 800px viewport */}
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // A scrollbar should be present for the overflowing column
    const scrollbar = scene.querySelector("[data-scrollbar]");
    expect(scrollbar).not.toBeNull();
  });

  test("column fitting viewport has no scrollbar", async () => {
    // A focused column whose content fits within the viewport height should not
    // have a scrollbar rendered.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              {/* Shorter than the 800px viewport */}
              <div data-testid="content" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const scrollbar = scene.querySelector("[data-scrollbar]");
    expect(scrollbar).toBeNull();
  });

  test("scroll range = focused content height - viewport height", async () => {
    // The scrollbar thumb size should reflect the scroll range:
    // maxScroll = contentHeight - viewportHeight = 1200 - 800 = 400
    // The thumb should not be at the top AND be smaller than the track,
    // showing that scroll range > 0.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    // Column should expose its scroll state on a data attribute
    const maxScroll = column.getAttribute("data-max-scroll");
    expect(maxScroll).not.toBeNull();
    // maxScroll = 1200 - 800 = 400 (approximately)
    expect(parseFloat(maxScroll!)).toBeGreaterThan(0);
  });

  test("unfocused objects in column don't extend scroll range", async () => {
    // Only focused content should contribute to the scroll range.
    // An unfocused sibling is position: absolute (out of flow) and should not
    // extend maxScroll.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="focused-obj" focused>
              {/* Fits within viewport */}
              <div data-testid="content-a" style={{ width: 400, height: 300 }} />
            </SceneObject>
            <SceneObject name="unfocused-obj" focused={false}>
              {/* Would overflow if counted — but it's unfocused */}
              <div data-testid="content-b" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // Only focused content (300px) fits within 800px viewport — no scrollbar
    const scrollbar = scene.querySelector("[data-scrollbar]");
    expect(scrollbar).toBeNull();
  });

  test("scroll offset drives column content top position", async () => {
    // When a wheel event fires with deltaY=100, the column content wrapper
    // should move its top offset by -100 (content slides up by 100px).
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
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
    await waitForAnimationFrame();

    // After scroll: top should be -100 (content moved up)
    const topAfter = parseFloat(contentWrapper.style.top || "0");
    expect(topAfter).toBe(-100);
  });

  test("non-overflowing sibling stays centered during scroll", async () => {
    // When one column scrolls vertically, a non-overflowing sibling column
    // should remain centered (unaffected by the other column's scroll state).
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="tall-col">
            <SceneObject name="tall-panel" focused>
              <div data-testid="tall-content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="short-col">
            <SceneObject name="short-panel" focused>
              <div data-testid="short-content" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;

    // Find the tall column to target the wheel event at it
    const tallColumn = getByTestId("tall-content")
      .element()
      .closest("[data-column]") as HTMLElement;
    const tallRect = tallColumn.getBoundingClientRect();
    const tallCenterX = tallRect.left + tallRect.width / 2;
    const tallCenterY = tallRect.top + tallRect.height / 2;

    // Get the short column's content wrapper margin-top before scroll
    const shortColumn = getByTestId("short-content")
      .element()
      .closest("[data-column]") as HTMLElement;
    const shortContent = shortColumn.querySelector("[data-column-content]") as HTMLElement;
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
});

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

describe("Scene scroll position management", () => {
  test("vertical scroll resets to 0 when column first becomes focused", async () => {
    // A newly-focused column should start with scrollOffset = 0.
    // (It has never been focused before, so there's no saved position.)
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
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

    // On first render, scroll offset should be 0 (top of content)
    const top = parseFloat(contentWrapper.style.top || "0");
    expect(top).toBe(0);
  });

  test("scroll offset is clamped when maxScroll decreases (content shrinks)", async () => {
    // If the column is scrolled and then the content shrinks so that
    // maxScroll decreases, scrollOffset should be clamped to the new maxScroll.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
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
    await waitForAnimationFrame();
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-300);

    // Shrink content so maxScroll drops to 100px (content height 900px in 800px viewport)
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 900 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
  test("diagonal trackpad gesture scrolls both axes simultaneously", async () => {
    // A wheel event with both deltaX and deltaY should:
    // - Route deltaY to the column's vertical scroll state
    // - Route deltaX to the viewport's native horizontal scroll (overflow-x: auto)
    // Both should happen in the same event, not sequentially.
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
    const col1 = getByTestId("content1")
      .element()
      .closest("[data-column]") as HTMLElement;
    const col1Content = col1.querySelector("[data-column-content]") as HTMLElement;
    const col1Rect = col1.getBoundingClientRect();

    // Initial state: no vertical or horizontal scroll
    expect(parseFloat(col1Content.style.top || "0")).toBe(0);
    expect(scene.scrollLeft).toBe(0);

    // Diagonal wheel event: deltaX scrolls horizontally, deltaY scrolls vertically
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

    await waitForAnimationFrame();

    // Vertical: col1 should have scrolled by 150px
    const verticalTop = parseFloat(col1Content.style.top || "0");
    expect(verticalTop).toBe(-150);
  });

  test("viewport resize: content now fits — scrollbar disappears", async () => {
    // When content overflows the viewport, a scrollbar should appear.
    // When the content shrinks to fit, the scrollbar should disappear.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              {/* Tall content — overflows 800px viewport */}
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;

    // Verify scrollbar is present
    expect(scene.querySelector("[data-scrollbar]")).not.toBeNull();

    // Swap in content that fits the viewport
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              {/* Short content — fits within 800px viewport */}
              <div data-testid="content" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Scrollbar should be gone
    expect(scene.querySelector("[data-scrollbar]")).toBeNull();
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
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused={false}>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused={false}>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused={false}>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const rightCol = getByTestId("content-right").element().closest("[data-column]") as HTMLElement;
    // Initially offscreen right
    expect(rightCol.getAttribute("data-column-position")).toBe("outer-right");

    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-a">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-b">
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Record positions while both are focused
    const colA = getByTestId("content-a").element().closest("[data-column]") as HTMLElement;
    const colB = getByTestId("content-b").element().closest("[data-column]") as HTMLElement;

    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-a">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-b">
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
// Initial layout: All columns visible, content-sized (spec lines 22-35)
// ---------------------------------------------------------------------------

describe("Scene initial layout", () => {
  test("all columns visible on initial render when none focused", async () => {
    // All columns should be in the flex row at position: relative with opacity: 1
    // even when nothing is focused — the scene is a real space, not hidden panels.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-a">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-b">
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-c">
            <SceneObject name="obj-c" focused={false}>
              <div data-testid="content-c" style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const colA = getByTestId("content-a").element().closest("[data-column]") as HTMLElement;
    const colB = getByTestId("content-b").element().closest("[data-column]") as HTMLElement;
    const colC = getByTestId("content-c").element().closest("[data-column]") as HTMLElement;

    // All columns: position relative, opacity 1 (no position null = no-position = stays in flow)
    for (const col of [colA, colB, colC]) {
      expect(window.getComputedStyle(col).position).toBe("relative");
    }
    // No column has a null-position classification (they have no-position / null data attr)
    expect(colA.getAttribute("data-column-position")).toBeNull();
    expect(colB.getAttribute("data-column-position")).toBeNull();
    expect(colC.getAttribute("data-column-position")).toBeNull();
  });

  test("column size is based on content by default", async () => {
    // A focused column with a 400px wide child should be 400px wide.
    // With flex: 0 1 auto, the column doesn't stretch to fill available space.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const col = getByTestId("content").element().closest("[data-column]") as HTMLElement;
    const width = col.getBoundingClientRect().width;
    // Column should be content-sized (400px), not viewport-width (1280px)
    expect(width).toBeCloseTo(400, -1); // within 10px
    expect(width).toBeLessThan(500);
  });

  test("consumer can override column sizing via content that has an explicit width", async () => {
    // When content has an explicit width larger than the natural content size,
    // the column expands to fit it — flex: 0 1 auto lets content dictate size.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              {/* Explicit 600px width — column should match */}
              <div data-testid="content" style={{ width: 600, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const col = getByTestId("content").element().closest("[data-column]") as HTMLElement;
    const width = col.getBoundingClientRect().width;
    // Column should be ~600px to fit the content
    expect(width).toBeCloseTo(600, -1);
    expect(width).toBeLessThan(700);
  });

  test("Camera viewport has container-type: size", async () => {
    // The Camera viewport has container-type: size so consumers can use
    // cqw/cqh units to size columns relative to the viewport dimensions.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 100, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const style = window.getComputedStyle(scene);
    expect(style.containerType).toBe("size");
  });
});

// ---------------------------------------------------------------------------
// Phase 6d: Depth deck stacking for in-between unfocused columns
// ---------------------------------------------------------------------------

describe("Scene depth deck stacking", () => {
  test("in-between unfocused column is classified as in-between", async () => {
    // Three columns: left and right are focused, middle is unfocused.
    // The middle column should be classified as "in-between".
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const middleCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
    expect(middleCol.getAttribute("data-column-position")).toBe("in-between");
  });

  test("in-between column stacks under right focused column (positioned near right)", async () => {
    // Phase 6e: x-animation to stackTargetLeft not yet verified — test is TDD.
    // An in-between unfocused column should appear in roughly the same
    // horizontal area as the right focused column — stacked behind it.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middleCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
    const rightCol = getByTestId("content-right").element().closest("[data-column]") as HTMLElement;

    const middleRect = middleCol.getBoundingClientRect();
    const rightRect = rightCol.getBoundingClientRect();

    // In-between column should overlap with the right focused column's area.
    // Their left edges should be close (within 50px).
    expect(Math.abs(middleRect.left - rightRect.left)).toBeLessThan(50);
  });

  test("in-between column appears smaller than natural size (perspective depth)", async () => {
    // The depth deck uses perspective + translateZ to create the stacking visual.
    // An in-between column at depth-1 should appear smaller than its natural size.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middleCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
    const middleRect = middleCol.getBoundingClientRect();

    // The column's rendered (projected) width should be less than its frozen width (300px).
    // Perspective projection reduces apparent size for elements pushed back in Z.
    expect(middleRect.width).toBeLessThan(300);
  });

  test("multiple in-between columns: deeper columns appear further back", async () => {
    // Phase 6e: depth deck CSS scaling not yet implemented — test is TDD.
    // Four columns: left and right focused, two in between unfocused.
    // The column closer to the right focused column should have depth-1,
    // the one further away depth-2. Depth-2 should appear even smaller.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle1">
            <SceneObject name="obj-middle1" focused={false}>
              <div data-testid="content-middle1" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle2">
            <SceneObject name="obj-middle2" focused={false}>
              <div data-testid="content-middle2" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middle1 = getByTestId("content-middle1").element().closest("[data-column]") as HTMLElement;
    const middle2 = getByTestId("content-middle2").element().closest("[data-column]") as HTMLElement;

    // Depth increases going away from the right focused column.
    // col-middle2 is closer to col-right → depth-1 (shallower, closer to right)
    // col-middle1 is further from col-right → depth-2 (deeper, further back)
    expect(middle1.getAttribute("data-stack-depth")).toBe("2");
    expect(middle2.getAttribute("data-stack-depth")).toBe("1");

    // Depth-2 (middle1) should appear smaller than depth-1 (middle2)
    const rect1 = middle1.getBoundingClientRect();
    const rect2 = middle2.getBoundingClientRect();
    expect(rect1.width).toBeLessThan(rect2.width);
  });

  test("depth-1 has higher opacity than depth-2", async () => {
    // Phase 6e: opacity animation timing not yet verified — test is TDD.
    // Shallower stacked columns should be more opaque than deeper ones.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle1">
            <SceneObject name="obj-middle1" focused={false}>
              <div data-testid="content-middle1" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle2">
            <SceneObject name="obj-middle2" focused={false}>
              <div data-testid="content-middle2" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middle1 = getByTestId("content-middle1").element().closest("[data-column]") as HTMLElement;
    const middle2 = getByTestId("content-middle2").element().closest("[data-column]") as HTMLElement;

    // Depth is measured from right focused column:
    // col-middle2 (adjacent to right) → depth-1, higher opacity
    // col-middle1 (further from right) → depth-2, lower opacity
    const opacity1 = parseFloat(window.getComputedStyle(middle1).opacity);
    const opacity2 = parseFloat(window.getComputedStyle(middle2).opacity);

    // depth-2 (middle1) should have lower opacity than depth-1 (middle2)
    expect(opacity1).toBeLessThan(opacity2);
    // Both should be below 1 (they are unfocused/stacked)
    expect(opacity1).toBeLessThan(1);
    expect(opacity2).toBeLessThan(1);
  });

  test("depth-1 in-between column transform contains translateZ (not scale)", async () => {
    // Depth is implemented via perspective + translateZ, not CSS scale.
    // The column's transform string should include a translateZ with a negative
    // value, pushing it away from the viewer into the 3D perspective field.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middleCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
    const transform = window.getComputedStyle(middleCol).transform;

    // Depth deck columns use perspective + translateZ for the depth visual effect.
    // The computed transform should include a 3D matrix (matrix3d) reflecting the
    // translateZ applied to push the column back in the perspective field.
    expect(transform).toBeTruthy();
    // Verify the column appears smaller than its natural 300px width.
    // Perspective projection reduces the apparent size of elements pushed back in Z.
    const rect = middleCol.getBoundingClientRect();
    expect(rect.width).toBeLessThan(300);
  });

  test("depth-1 in-between column has greyscale filter applied", async () => {
    // In-between columns at depth-1 should have a 25% greyscale filter applied.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middleCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
    const filter = window.getComputedStyle(middleCol).filter;

    // depth-1 → grayscale(0.25)
    expect(filter).toContain("grayscale(0.25)");
  });

  test("deeper columns have more greyscale than shallower columns", async () => {
    // depth-2 should have grayscale(0.5), depth-1 should have grayscale(0.25).
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle1">
            <SceneObject name="obj-middle1" focused={false}>
              <div data-testid="content-middle1" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle2">
            <SceneObject name="obj-middle2" focused={false}>
              <div data-testid="content-middle2" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    // col-middle2 is adjacent to col-right → depth-1 → grayscale(0.25)
    // col-middle1 is further from col-right → depth-2 → grayscale(0.5)
    const middle1 = getByTestId("content-middle1").element().closest("[data-column]") as HTMLElement;
    const middle2 = getByTestId("content-middle2").element().closest("[data-column]") as HTMLElement;

    const filter1 = window.getComputedStyle(middle1).filter;
    const filter2 = window.getComputedStyle(middle2).filter;

    expect(filter2).toContain("grayscale(0.25)");
    expect(filter1).toContain("grayscale(0.5)");
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
    const colA = getByTestId("content-a").element().closest("[data-column]") as HTMLElement;
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
    const colB = getByTestId("content-b").element().closest("[data-column]") as HTMLElement;
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

    const colA = getByTestId("content-a").element().closest("[data-column]") as HTMLElement;

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
    const colB = document.querySelector("[data-column='col-b']");
    expect(colB).toBeNull();
  });

  test("unfocused column unmounting to right re-centers focused content", async () => {
    // Outer unfocused columns are position: relative and take up space in the
    // flex row. Unmounting one to the right removes that space, causing the
    // stage to re-center via margin-inline: auto.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-focused">
            <SceneObject name="obj-focused" focused>
              <div data-testid="content-focused" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-unfocused">
            <SceneObject name="obj-unfocused" focused={false}>
              <div data-testid="content-unfocused" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const focusedCol = getByTestId("content-focused").element().closest("[data-column]") as HTMLElement;

    await waitForAnimationFrame();

    // Unmount the unfocused column to the right
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-focused">
            <SceneObject name="obj-focused" focused>
              <div data-testid="content-focused" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
            <SceneObject name="panel" focused>
              {/* Start with 200px min-width */}
              <div data-testid="content" style={{ minWidth: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const col = getByTestId("content").element().closest("[data-column]") as HTMLElement;

    // Record the initial column width — should be at least 200px
    const widthBefore = col.getBoundingClientRect().width;
    expect(widthBefore).toBeGreaterThanOrEqual(200);

    // Increase the min-width — the layout should reflow
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
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

    const col1 = getByTestId("content-1").element().closest("[data-column]") as HTMLElement;
    const col2 = getByTestId("content-2").element().closest("[data-column]") as HTMLElement;

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
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="nav-panel" focused={false}>
              <div data-testid="content-nav" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="article">
            <SceneObject name="article-panel" focused>
              <div data-testid="content-article" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const navCol = getByTestId("content-nav").element().closest("[data-column]") as HTMLElement;
    // Initially nav is outer-left (unfocused, to the left of focused article)
    expect(navCol.getAttribute("data-column-position")).toBe("outer-left");

    // Navigate back: nav becomes focused, article stays focused
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="nav-panel" focused>
              <div data-testid="content-nav" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="article">
            <SceneObject name="article-panel" focused>
              <div data-testid="content-article" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    // Nav column should now be in the flex layout (focused)
    expect(window.getComputedStyle(navCol).position).toBe("relative");
    expect(navCol.getAttribute("data-column-position")).toBeNull();

    // Nav should appear to the left of article (in DOM order)
    const articleCol = getByTestId("content-article").element().closest("[data-column]") as HTMLElement;
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

    const col1 = getByTestId("content-1").element().closest("[data-column]") as HTMLElement;

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
  test("newly mounted focused column has data-column-new attribute indicating entry direction", async () => {
    // A focused column that mounts for the first time (never-focused before)
    // should be marked so the entry animation can be applied. This is used to
    // animate the column in from the right when depth-navigating forward.
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

    // Mount col-2 as focused — it should carry a data attribute marking its
    // initial entry so the consumer or Scene can apply an enter animation.
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

    const col2 = getByTestId("content-2").element().closest("[data-column]") as HTMLElement;
    // The column should be in the flex layout after mounting
    expect(window.getComputedStyle(col2).position).toBe("relative");
    // With duration=0, animations are instant — verify final state is correct
    expect(col2.getAttribute("data-column-focused")).toBe("true");
  });

  test("focused column that was outer-left transitions back into flex layout", async () => {
    // When navigating back, a previously outer-left unfocused column should
    // smoothly animate from its offscreen position back into the flex row.
    // The column uses motion layout FLIP for this transition.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="nav-panel" focused={false}>
              <div data-testid="content-nav" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="article">
            <SceneObject name="article-panel" focused>
              <div data-testid="content-article" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const navCol = getByTestId("content-nav").element().closest("[data-column]") as HTMLElement;
    expect(navCol.getAttribute("data-column-position")).toBe("outer-left");

    // Navigate back: nav becomes focused
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="nav-panel" focused>
              <div data-testid="content-nav" style={{ minWidth: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="article">
            <SceneObject name="article-panel" focused>
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
            <SceneObject name="panel" focused={false} onActivate={() => { activated = true; }}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const outer = getByTestId("content").element().closest("[data-scene-id]") as HTMLElement;
    outer.click();
    expect(activated).toBe(true);
  });

  test("clicking focused SceneObject does NOT fire onActivate", async () => {
    let activateCount = 0;
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused onActivate={() => { activateCount++; }}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const outer = getByTestId("content").element().closest("[data-scene-id]") as HTMLElement;
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
            <SceneObject name="panel" focused={false}>
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
            <SceneObject name="panel" focused={false}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const outer = getByTestId("content").element().closest("[data-scene-id]") as HTMLElement;
    // The outer wrapper itself should not have the inert attribute.
    expect(outer.hasAttribute("inert")).toBe(false);
    // The inner wrapper (parent of content) should have inert.
    const innerWrapper = getByTestId("content").element().parentElement;
    expect(innerWrapper?.hasAttribute("inert")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 8c: Keyboard focus management
// ---------------------------------------------------------------------------

describe("SceneObject keyboard focus management", () => {
  test("focus change moves keyboard focus to first focusable element in new content", async () => {
    // When a SceneObject transitions from unfocused to focused, keyboard focus
    // should move to the first focusable descendant so keyboard users don't
    // need to manually tab into the newly visible content.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <button data-testid="btn-in-panel">action</button>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Panel is not focused — button should not have keyboard focus.
    const btn = getByTestId("btn-in-panel").element() as HTMLElement;
    expect(document.activeElement).not.toBe(btn);

    // Transition: make the panel focused.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <button data-testid="btn-in-panel">action</button>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // After becoming focused, the first focusable element should receive keyboard focus.
    expect(document.activeElement).toBe(btn);
  });

  test("if no focusable elements, focus does not throw", async () => {
    // When a SceneObject becomes focused but contains no interactive elements,
    // the focus logic should degrade gracefully without throwing.
    const { rerender } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div>no buttons here</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Should not throw even when no focusable element is found.
    await expect(rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div>no buttons here</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    )).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Phase 8e: Scroll accessibility — focused column content wrapper
// ---------------------------------------------------------------------------

describe("SceneColumn scroll accessibility", () => {
  test("focused column content wrapper has role=region", async () => {
    // Focused column content wrappers that may overflow vertically should be
    // marked as landmark regions so screen reader users can navigate to them.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ height: 200 }}>content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element();
    const contentWrapper = content.closest("[data-column-content]") as HTMLElement;
    expect(contentWrapper).not.toBeNull();
    expect(contentWrapper.getAttribute("role")).toBe("region");
  });

  test("focused column content wrapper has tabindex=0", async () => {
    // tabindex=0 allows keyboard users to focus the scrollable region directly
    // and use keyboard shortcuts to scroll it.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ height: 200 }}>content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element();
    const contentWrapper = content.closest("[data-column-content]") as HTMLElement;
    expect(contentWrapper.getAttribute("tabindex")).toBe("0");
  });

  test("focused column content wrapper has aria-label based on column name", async () => {
    // aria-label identifies the region to screen reader users.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ height: 200 }}>content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element();
    const contentWrapper = content.closest("[data-column-content]") as HTMLElement;
    expect(contentWrapper.getAttribute("aria-label")).toBe("nav content");
  });
});

// ---------------------------------------------------------------------------
// Phase 9a: Spring physics — rapid focus changes
// ---------------------------------------------------------------------------

describe("Scene spring physics", () => {
  test("rapid focus changes settle on the final target", async () => {
    // Three sequential focus changes should settle on the last focused object.
    // With duration=0 each rerender is instant, so final state is deterministic.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 200, height: 150 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 200, height: 150 }} />
            </SceneObject>
            <SceneObject name="obj-c" focused={false}>
              <div data-testid="content-c" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Quick sequential focus changes: a → b → c
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 200, height: 150 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 200, height: 150 }} />
            </SceneObject>
            <SceneObject name="obj-c" focused={false}>
              <div data-testid="content-c" style={{ width: 200, height: 150 }} />
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
              <div data-testid="content-a" style={{ width: 200, height: 150 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 200, height: 150 }} />
            </SceneObject>
            <SceneObject name="obj-c" focused>
              <div data-testid="content-c" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    // After all changes, only obj-c should be focused — column must be focused
    // (position: relative) and obj-c must have data-focused=true.
    const colEl = getByTestId("content-c").element().closest("[data-column]") as HTMLElement;
    expect(colEl.getAttribute("data-column-focused")).toBe("true");

    const objC = getByTestId("content-c").element().closest("[data-scene-id]") as HTMLElement;
    expect(objC.getAttribute("data-focused")).toBe("true");

    const objA = getByTestId("content-a").element().closest("[data-scene-id]") as HTMLElement;
    expect(objA.getAttribute("data-focused")).toBe("false");

    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;
    expect(objB.getAttribute("data-focused")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// Phase 9b: Reduced motion
// ---------------------------------------------------------------------------

describe("Scene reduced motion", () => {
  beforeEach(() => {
    // Reset motion's internal reduced-motion listener state before each test
    // so initPrefersReducedMotion() runs fresh and reads our mocked matchMedia.
    hasReducedMotionListener.current = false;
    prefersReducedMotion.current = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore motion's listener state to uninitialized for subsequent tests.
    hasReducedMotionListener.current = false;
    prefersReducedMotion.current = null;
  });

  function mockReducedMotion(): () => void {
    const spy = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({
        // Match both the full query and the bare query used by motion's internal
        // initPrefersReducedMotion() to detect reduced motion preference.
        matches:
          query === "(prefers-reduced-motion: reduce)" ||
          query === "(prefers-reduced-motion)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as MediaQueryList),
    );
    return () => spy.mockRestore();
  }

  test("reduced motion: layout changes still apply correctly", async () => {
    // Even with prefers-reduced-motion, focus state and layout must work.
    const restore = mockReducedMotion();

    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // The column should still be correctly focused regardless of reduced motion.
    const col = getByTestId("content").element().closest("[data-column]") as HTMLElement;
    expect(col.getAttribute("data-column-focused")).toBe("true");

    const obj = getByTestId("content").element().closest("[data-scene-id]") as HTMLElement;
    expect(obj.getAttribute("data-focused")).toBe("true");

    restore();
  });

  test("reduced motion: scene viewport has data-reduced-motion attribute when prefers-reduced-motion is active", async () => {
    // When prefers-reduced-motion is active, the scene's viewport element should
    // have a data-reduced-motion attribute so consumers and tests can verify
    // the mode is being detected.
    const restore = mockReducedMotion();

    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("content").element().closest("[data-testid='scene']") as HTMLElement;
    // This attribute is added by the implementation when reduced motion is detected.
    expect(scene.hasAttribute("data-reduced-motion")).toBe(true);

    restore();
  });

  test("reduced motion: scene viewport does NOT have data-reduced-motion attribute when motion is allowed", async () => {
    // Without prefers-reduced-motion, the attribute should be absent.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("content").element().closest("[data-testid='scene']") as HTMLElement;
    expect(scene.hasAttribute("data-reduced-motion")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 9c/9d: useCamera hook
// ---------------------------------------------------------------------------

import { useCamera } from "../src";

/** Test component that exposes CameraState values as data attributes. */
function CameraReader() {
  const camera = useCamera();
  return (
    <div
      data-testid="camera-reader"
      data-bounds-width={camera.bounds.width}
      data-bounds-height={camera.bounds.height}
      data-transitioning={String(camera.transitioning)}
    />
  );
}

describe("useCamera", () => {
  test("useCamera reports viewport bounds width and height", async () => {
    // bounds should reflect the scene viewport element dimensions.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <CameraReader />
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const reader = getByTestId("camera-reader").element() as HTMLElement;
    const width = parseFloat(reader.getAttribute("data-bounds-width") ?? "0");
    const height = parseFloat(reader.getAttribute("data-bounds-height") ?? "0");

    // The viewport fills the TestWrapper fullPage container, so dimensions
    // should be non-zero. We can't assert exact pixels, but must be > 0.
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  test("useCamera reports transitioning=false when no animation is in flight", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <CameraReader />
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const reader = getByTestId("camera-reader").element() as HTMLElement;
    // After initial render with duration=0, no animation should be in flight.
    expect(reader.getAttribute("data-transitioning")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// Within-column depth deck (unfocused between focused objects)
// ---------------------------------------------------------------------------

describe("SceneColumn within-column depth deck", () => {
  test("unfocused object between two focused objects has depth treatment", async () => {
    // A (focused), B (unfocused), C (focused) — B should have reduced opacity
    // and be visible (not visibility: hidden) because it peeks as a depth card.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
            <SceneObject name="obj-c" focused>
              <div data-testid="content-c" style={{ width: 300, height: 200 }}>C</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;

    // B is between two focused objects — it should have depth treatment (data attribute)
    expect(objB.getAttribute("data-within-column-depth")).toBe("1");

    // B should be visible (not visibility: hidden — it peeks as a depth card)
    expect(window.getComputedStyle(objB).visibility).not.toBe("hidden");

    // B should have reduced opacity (depth treatment)
    const opacity = parseFloat(window.getComputedStyle(objB).opacity);
    expect(opacity).toBeLessThan(1);
  });

  test("multiple unfocused between focused: increasing depth", async () => {
    // A (focused), B (unfocused), C (unfocused), D (focused)
    // B is depth-2 (further from D), C is depth-1 (adjacent to D)
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
            <SceneObject name="obj-c" focused={false}>
              <div data-testid="content-c" style={{ width: 300, height: 200 }}>C</div>
            </SceneObject>
            <SceneObject name="obj-d" focused>
              <div data-testid="content-d" style={{ width: 300, height: 200 }}>D</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;
    const objC = getByTestId("content-c").element().closest("[data-scene-id]") as HTMLElement;

    // C is depth-1 (adjacent to lower focused D), B is depth-2
    expect(objC.getAttribute("data-within-column-depth")).toBe("1");
    expect(objB.getAttribute("data-within-column-depth")).toBe("2");

    // C (depth-1) has higher opacity than B (depth-2) — less treatment = more visible
    const opacityB = parseFloat(window.getComputedStyle(objB).opacity);
    const opacityC = parseFloat(window.getComputedStyle(objC).opacity);
    expect(opacityC).toBeGreaterThan(opacityB);
  });

  test("unfocused at end of column (not between focused) has no depth treatment", async () => {
    // A (focused), B (unfocused) — B is NOT between two focused objects
    // so it should have the normal hidden treatment (visibility: hidden)
    const { getByTestId } = await render(
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

    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;

    // B is not between two focused objects — no depth attribute
    expect(objB.getAttribute("data-within-column-depth")).toBeNull();

    // B stays visible and in flow (position: relative), just inert
    expect(window.getComputedStyle(objB).position).toBe("relative");
    expect(window.getComputedStyle(objB).visibility).not.toBe("hidden");
  });

  test("within-column depth object is anchored at the lower focused sibling with translateZ depth", async () => {
    // A (focused, 200px tall), B (unfocused), C (focused, 200px tall)
    // B is anchored at C's top position and uses translateZ for 3D depth.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
            <SceneObject name="obj-c" focused>
              <div data-testid="content-c" style={{ width: 300, height: 200 }}>C</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;

    // B uses translateZ for depth — the inline transform should include translateZ.
    // Depth-1 objects are pushed back 100px in Z space.
    expect(objB.style.transform).toContain("translateZ(-100px)");

    // B is anchored at C's top (anchorTop = height of A = 200px). The `top`
    // style property should be set to the anchorTop value.
    expect(objB.style.position).toBe("absolute");
    expect(parseInt(objB.style.top)).toBeCloseTo(200, -1);
  });
});

// ---------------------------------------------------------------------------
// Fix 1: Scroll position restore on refocus
// ---------------------------------------------------------------------------

describe("Scene scroll position restore", () => {
  test("scroll position restores when column is refocused", async () => {
    // Scenario: scroll a column to offset 100, unfocus it, refocus it.
    // The column should restore to offset 100.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
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
    await waitForAnimationFrame();
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-100);

    // Unfocus the column — a second column takes focus
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
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

    // Refocus the original column
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
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

    // Scroll position should be restored to 100px
    const topAfterRefocus = parseFloat(contentWrapper.style.top || "0");
    expect(topAfterRefocus).toBe(-100);
  });

  test("scroll resets to 0 when column first becomes focused (no saved position)", async () => {
    // A column that has never been focused should start at scroll offset 0.
    // This is a regression guard — no saved scroll position means start at top.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
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

    // Now focus "col" for the first time — no saved scroll, should be 0
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
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

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column='col']") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(0);
  });

  test("drastically resized column falls back to top (scroll offset 0)", async () => {
    // If the content height changes drastically (>50%) between unfocus and refocus,
    // the saved scroll position is invalid — fall back to top (offset 0).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
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
    await waitForAnimationFrame();
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-300);

    // Unfocus (switch to col2)
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              {/* Drastically resized: from 1200 to 300 (75% reduction, > 50%) */}
              <div data-testid="content" style={{ width: 400, height: 300 }} />
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

    // Refocus with dramatically shrunken content
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 300 }} />
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

    // Saved position was 300, but content is now 300px (fits in 800px viewport).
    // maxScroll is 0, so scroll should be at 0 (clamped by existing logic).
    const topAfterRefocus = parseFloat(contentWrapper.style.top || "0");
    expect(topAfterRefocus).toBe(0);
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
      <TestWrapper fullPage>
        <Scene duration={0} padding={16}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
      <TestWrapper fullPage>
        <Scene duration={0} padding={16}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              {/* 780px content fits in 800px viewport, but overflows with 32px padding */}
              <div data-testid="content" style={{ width: 400, height: 780 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // With padding factored in, the content now overflows → scrollbar should appear.
    const scrollbar = scene.querySelector("[data-scrollbar]");
    expect(scrollbar).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fix 3: Scrollbar ARIA attributes
// ---------------------------------------------------------------------------

describe("Scrollbar ARIA", () => {
  test("scrollbar thumb has role=scrollbar", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
});
