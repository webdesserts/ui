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

  test("two flexible focused columns share viewport width roughly equally", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div data-testid="content2" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const col1 = getByTestId("content1").element().closest("[data-column]") as HTMLElement;
    const col2 = getByTestId("content2").element().closest("[data-column]") as HTMLElement;

    const width1 = col1.getBoundingClientRect().width;
    const width2 = col2.getBoundingClientRect().width;

    // Each column should occupy roughly half the viewport (within 10%)
    expect(Math.abs(width1 - width2)).toBeLessThan(width1 * 0.1);
    expect(width1).toBeGreaterThan(0);
  });
});
