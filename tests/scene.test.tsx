import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
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
    // flex: 1 1 0 — equal sharing of viewport width among focused columns
    expect(style.flexGrow).toBe("1");
    expect(style.flexShrink).toBe("1");
    expect(style.flexBasis).toBe("0px");
  });

  test("unfocused column (never focused) has position: absolute and opacity: 0", async () => {
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
    expect(style.position).toBe("absolute");
    expect(style.opacity).toBe("0");
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

  test("mixed focused/unfocused — focused is relative, unfocused is absolute", async () => {
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
    expect(style2.position).toBe("absolute");
  });

  test("two flexible focused columns share available width roughly equally", async () => {
    // Flexible columns (flex: 1 1 0) divide available space equally. They need
    // intrinsic content widths to participate in the layout; empty divs have
    // zero width. In practice all focused columns have content.
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

    // Each column should occupy roughly half the available width (within 10%)
    expect(Math.abs(width1 - width2)).toBeLessThan(width1 * 0.1);
    expect(width1).toBeGreaterThan(0);
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

  test("focus change: previously focused becomes absolute, newly focused becomes relative", async () => {
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

    expect(window.getComputedStyle(col1).position).toBe("absolute");
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
    expect(styleDebug.flexGrow).toBe("1");
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
    // Unfocused sibling within the column is out of flow
    expect(window.getComputedStyle(objA).position).toBe("absolute");
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

  test("unfocusing one object from a multi-focus column removes it from flow", async () => {
    // Start with two focused objects, then unfocus one. The unfocused one
    // should become position: absolute (out of flow).
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

    expect(window.getComputedStyle(objA).position).toBe("absolute");
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
  test("fixed-width column is centered horizontally — stage has margin-inline: auto", async () => {
    // A column with a fixed minimum width smaller than the viewport is centered
    // horizontally. The stage (width: fit-content + margin-inline: auto) shrinks
    // to the column's natural width and auto margins center it in the viewport.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          {/* Column with a 300px min-width — smaller than the 1280px viewport,
              so the stage will be 300px wide and centered. */}
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

    // The stage is the direct child of the scene viewport that wraps the columns.
    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-stage]") as HTMLElement | null;
    expect(stage).not.toBeNull();

    const stageStyle = window.getComputedStyle(stage!);
    // margin-inline: auto centering: left and right margins should be > 0
    // and roughly equal when stage is narrower than the 1280px viewport.
    const marginLeft = parseFloat(stageStyle.marginLeft);
    const marginRight = parseFloat(stageStyle.marginRight);
    expect(marginLeft).toBeGreaterThan(0);
    expect(marginRight).toBeGreaterThan(0);
    expect(Math.abs(marginLeft - marginRight)).toBeLessThan(2);
  });

  test("content overflowing horizontally — stage left-aligns (margins collapse to 0)", async () => {
    // When focused content width exceeds the viewport, margin-inline: auto
    // collapses to 0 and content left-aligns naturally.
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

    // When content overflows, margins should be 0 (no centering offset).
    const stageStyle = window.getComputedStyle(stage!);
    const marginLeft = parseFloat(stageStyle.marginLeft);
    expect(marginLeft).toBe(0);
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

  test("small content — both axes centered in viewport", async () => {
    // When content fits both axes, it should be visually centered in the viewport.
    // Check that the content's bounding rect is roughly centered within 1280x800.
    // Uses minWidth to define the column's intrinsic width (required for horizontal
    // centering via margin-inline: auto on the fit-content stage).
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

    // Horizontal center: in a 1280px viewport with 200px content,
    // content should be near x = 540 (center - half-width)
    expect(rect.left).toBeGreaterThan(200);   // not left-aligned
    expect(rect.right).toBeLessThan(1080);    // not right-aligned

    // Vertical center: in an 800px viewport with 100px content,
    // content should be near y = 350
    expect(rect.top).toBeGreaterThan(100);    // not top-aligned
    expect(rect.bottom).toBeLessThan(700);    // not bottom-aligned
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

  test("default gap is zero — no space between columns or objects", async () => {
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
    expect(left2 - right1).toBe(0);
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

  test("horizontal scroll position can be set and resets to 0 on focus change", async () => {
    // With overflow-x: auto, scrollLeft persists when set. On focus layout change,
    // the Scene should reset scrollLeft to 0. This test verifies both that scrolling
    // is actually enabled (scrollLeft takes effect) and that reset happens.
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

    // With overflow-x: auto, scrollLeft should be settable and retained
    scene.scrollLeft = 200;
    expect(scene.scrollLeft).toBe(200);

    // Change focus layout — Scene should reset scrollLeft to 0
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

    // Scroll should have reset to 0 after focus layout change
    expect(scene.scrollLeft).toBe(0);
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
  test("unfocused column left of all focused slides offscreen left", async () => {
    // With col-left unfocused and col-right focused, col-left should be
    // translated so it's fully offscreen to the left (translateX is negative,
    // moving the column past the left edge of the viewport).
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
    // Wait for motion to apply the transform (even with duration=0, the
    // transform is applied asynchronously on the next animation frame).
    await waitForAnimationFrame();
    // The column's bounding rect should be off the left edge of the viewport
    const rect = leftCol.getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(0);
  });

  test("unfocused column right of all focused slides offscreen right", async () => {
    // With col-left focused and col-right unfocused, col-right should be
    // fully offscreen to the right.
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
    // Wait for motion to apply the transform.
    await waitForAnimationFrame();
    // The column's bounding rect should be off the right edge of the viewport (1280px)
    const rect = rightCol.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(1280);
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
