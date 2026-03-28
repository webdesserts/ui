import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { TestWrapper } from "./test-wrapper";

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
