import { describe, test, expect, vi } from "vitest";
import { useState } from "react";
import { render, cleanup } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { TestWrapper } from "./test-wrapper";
import { wait } from "./utils/animation";
import { buildScene } from "./utils/sceneFixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the computed style of the column wrapper ([data-column]) containing
 *  the element located by data-testid. */
async function getColumnStyle(
  getByTestId: Awaited<ReturnType<typeof render>>["getByTestId"],
  testId: string,
): Promise<CSSStyleDeclaration> {
  const content = getByTestId(testId).element() as HTMLElement;
  const column = content.closest("[data-column]") as HTMLElement;
  return window.getComputedStyle(column);
}

/** Custom component that returns a SceneColumn — used to prove Scene's
 *  column classification doesn't depend on SceneColumn being a DIRECT child
 *  of Scene's `children` prop (S6 registration architecture). */
function RightColumnWrapper() {
  return (
    <SceneColumn name="right">
      <SceneObject name="right-obj" focused>
        <div data-testid="right-content" style={{ width: 200, height: 150 }} />
      </SceneObject>
    </SceneColumn>
  );
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
// S6: registration architecture — column classification is derived from a
// runtime registry (self-registration via useLayoutEffect + DOM refs), not
// from walking Scene's `children` prop tree. The prop walk breaks whenever a
// SceneColumn is Fragment-wrapped, returned from a custom component, or a
// SceneObject is nested inside a plain wrapper div — none of that changes
// the REACT TREE position (context/refs still resolve correctly), only the
// shallow JSX shape a prop walk sees.
// ---------------------------------------------------------------------------

describe("Scene registration architecture (S6)", () => {
  test("a column wrapped in a Fragment still participates in classification", async () => {
    // "right" (focused) is wrapped in a Fragment. A prop-walk-only
    // implementation skips it entirely (child.type is the Fragment symbol,
    // not SceneColumn) — "left" would then see nothing focused and stay
    // unclassified (position: null) instead of outer-left.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused={false}>
              <div data-testid="left-content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <>
            <SceneColumn name="right">
              <SceneObject name="right-obj" focused>
                <div data-testid="right-content" style={{ width: 200, height: 150 }} />
              </SceneObject>
            </SceneColumn>
          </>
        </Scene>
      </TestWrapper>,
    );

    const left = getByTestId("left-content").element().closest("[data-column]") as HTMLElement;
    expect(left.getAttribute("data-column-position")).toBe("outer-left");
  });

  test("a column returned from a custom component still participates in classification", async () => {
    // Same failure mode as the Fragment case: child.type is the wrapper
    // function component, not SceneColumn, so a prop walk skips "right"
    // entirely.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused={false}>
              <div data-testid="left-content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <RightColumnWrapper />
        </Scene>
      </TestWrapper>,
    );

    const left = getByTestId("left-content").element().closest("[data-column]") as HTMLElement;
    expect(left.getAttribute("data-column-position")).toBe("outer-left");
  });

  test("a column containing a div-wrapped focused object still classifies as focused (column-level only)", async () => {
    // "right-obj" is wrapped in a plain div inside its SceneColumn. Scope is
    // deliberately narrow (forecast-gate adjudication #4): only "right"'s
    // COLUMN-LEVEL classification (and therefore "left"'s position) is
    // claimed correct here — "right"'s own internal focused styling is out
    // of scope and is not asserted by this test.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused={false}>
              <div data-testid="left-content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <div>
              <SceneObject name="right-obj" focused>
                <div data-testid="right-content" style={{ width: 200, height: 150 }} />
              </SceneObject>
            </div>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const left = getByTestId("left-content").element().closest("[data-column]") as HTMLElement;
    expect(left.getAttribute("data-column-position")).toBe("outer-left");
  });

  test("a focus-only toggle on a div-wrapped object updates column registration in the same commit", async () => {
    // Medium-2 (forecast-gate adjudication #3): the registration effect must
    // be unconditional per-render so a focus-only prop change (no `name` or
    // context-reference change) is reflected the same commit — not gated
    // behind [column, name] deps, which would only refire on remount.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused={false}>
              <div data-testid="left-content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <div>
              <SceneObject name="right-obj" focused={false}>
                <div data-testid="right-content" style={{ width: 200, height: 150 }} />
              </SceneObject>
            </div>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const left = getByTestId("left-content").element().closest("[data-column]") as HTMLElement;
    expect(left.getAttribute("data-column-position")).toBeNull();

    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused={false}>
              <div data-testid="left-content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <div>
              <SceneObject name="right-obj" focused>
                <div data-testid="right-content" style={{ width: 200, height: 150 }} />
              </SceneObject>
            </div>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    expect(left.getAttribute("data-column-position")).toBe("outer-left");
  });

  test("column classification respects true DOM order, not registration order (J1)", async () => {
    const { getByTestId, rerender } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="a">
            <SceneObject name="a-obj" focused={false}>
              <div data-testid="a-content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="b">
            <SceneObject name="b-obj" focused>
              <div data-testid="b-content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const aCol = getByTestId("a-content").element().closest("[data-column]") as HTMLElement;
    const bCol = getByTestId("b-content").element().closest("[data-column]") as HTMLElement;

    // Manipulate the DOM directly (outside React) to physically move "b"
    // before "a" — real document order changes without React's own
    // reconciliation touching these nodes (which always fires registration
    // effects in tree order, matching normal DOM insertion — insufficient on
    // its own to prove the derivation sorts by DOM position rather than
    // trusting incidental registration/Map-insertion order).
    aCol.parentElement!.insertBefore(bCol, aCol);

    // Force a fresh registration pass via an unrelated Scene prop change —
    // registration effects are unconditional per-render (Medium-2) so they
    // refire and re-derive classification from the (now DOM-reordered)
    // registry.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0} columnGap={4}>
          <SceneColumn name="a">
            <SceneObject name="a-obj" focused={false}>
              <div data-testid="a-content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="b">
            <SceneObject name="b-obj" focused>
              <div data-testid="b-content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // "b" (focused) now comes first in true DOM order, "a" (unfocused)
    // second -> "a" should classify as outer-RIGHT (after the focused
    // column). Registration/insertion order (a registered before b,
    // unaffected by the DOM move) would wrongly keep "a" at outer-left.
    expect(aCol.getAttribute("data-column-position")).toBe("outer-right");
  });

  test("registerColumn warns when a different element claims an existing column name (J2)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="dup">
            <SceneObject name="dup-obj-1" focused>
              <div data-testid="content-1" style={{ width: 100, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="dup">
            <SceneObject name="dup-obj-2" focused={false}>
              <div data-testid="content-2" style={{ width: 100, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes("dup"))).toBe(true);
    warnSpy.mockRestore();
  });

  test("H10: warns when a Scene child is neither a SceneColumn nor a SceneObject", async () => {
    // Mirrors the demos' real CameraDebug bug: a plain component rendered
    // directly inside <Scene> (not position:absolute) silently joins the
    // stage's flex row and can widen the scroll extent. Component defined
    // locally with a unique name so its `type` identity doesn't collide
    // with the module-level warn-dedup state from any other test.
    function StrayDebugReadout() {
      return <p>debug</p>;
    }
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <StrayDebugReadout />
        </Scene>
      </TestWrapper>,
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain("StrayDebugReadout");
    expect(message).toContain("SceneColumn");
    expect(message).toContain("SceneObject");
    // The warning must suggest an actual fix, not just name the problem.
    expect(message).toMatch(/position:\s*absolute/);
    expect(message).toMatch(/outside <Scene>/);
    warnSpy.mockRestore();
  });

  test("H10: the stray-child warning fires only once per distinct child type, even across remounts", async () => {
    function AnotherStrayReadout() {
      return <p>debug 2</p>;
    }
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const build = () => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <AnotherStrayReadout />
        </Scene>
      </TestWrapper>
    );

    const { rerender } = await render(build());
    await rerender(build());
    await rerender(build());
    // cleanup() (not unmount()) between mounts within one test — matches
    // this file's established pattern (see "depth-1 in-between column peeks
    // left..." above) for remounting without colliding on shared
    // data-testids or destabilizing subsequent tests' render roots.
    await cleanup();
    await render(build());

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Phase 1: Focused flex layout
// ---------------------------------------------------------------------------

describe("SceneColumn flex layout", () => {
  test("focused column has flex: 0 1 auto and position: relative", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 200, height: 150, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
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
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: false, width: 200, height: 150, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const style = await getColumnStyle(getByTestId, "content");
    expect(style.position).toBe("relative");
    expect(style.opacity).toBe("1");
  });

  test("two focused columns both participate in flex row", async () => {
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "col1", objects: [{ name: "obj1", focused: true, width: 200, height: 150, testId: "content1" }] },
          { name: "col2", objects: [{ name: "obj2", focused: true, width: 200, height: 150, testId: "content2" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
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
      buildScene(
        [
          { name: "col1", objects: [{ name: "obj1", focused: true, width: 200, height: 150, testId: "content1" }] },
          { name: "col2", objects: [{ name: "obj2", focused: false, width: 200, height: 150, testId: "content2" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
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
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 300, height: 200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // Measure dimensions while focused
    const col = getByTestId("content").element().closest("[data-column]") as HTMLElement;
    const focusedWidth = col.getBoundingClientRect().width;
    const focusedHeight = col.getBoundingClientRect().height;
    expect(focusedWidth).toBeGreaterThan(0);
    expect(focusedHeight).toBeGreaterThan(0);

    // Lose focus — the column should freeze at its last size
    await rerender(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: false, width: 300, height: 200, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const frozenWidth = col.style.width;
    const frozenHeight = col.style.height;

    // Frozen size should be set as inline styles (non-zero)
    expect(parseFloat(frozenWidth)).toBeGreaterThan(0);
    expect(parseFloat(frozenHeight)).toBeGreaterThan(0);
  });

  test("unfocused column stays in DOM", async () => {
    const { rerender, getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 200, height: 150, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await rerender(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: false, width: 200, height: 150, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // Column should still be present in the DOM after losing focus
    const col = getByTestId("content").element().closest("[data-column]");
    expect(col).not.toBeNull();
    expect(col?.getAttribute("data-column-focused")).toBe("false");
  });

  test("re-focusing column returns it to flex layout (position: relative)", async () => {
    const { rerender, getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 200, height: 150, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // Lose focus
    await rerender(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: false, width: 200, height: 150, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // Regain focus
    await rerender(
      buildScene(
        [{ name: "col", objects: [{ name: "panel", focused: true, width: 200, height: 150, testId: "content" }] }],
        { duration: 0 },
        { fullPage: true },
      ),
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
      buildScene(
        [
          { name: "col1", objects: [{ name: "obj1", focused: true, width: 200, height: 150, testId: "content1" }] },
          { name: "col2", objects: [{ name: "obj2", focused: false, width: 200, height: 150, testId: "content2" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // Swap focus: col1 loses, col2 gains
    await rerender(
      buildScene(
        [
          { name: "col1", objects: [{ name: "obj1", focused: false, width: 200, height: 150, testId: "content1" }] },
          { name: "col2", objects: [{ name: "obj2", focused: true, width: 200, height: 150, testId: "content2" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const col1 = getByTestId("content1").element().closest("[data-column]") as HTMLElement;
    const col2 = getByTestId("content2").element().closest("[data-column]") as HTMLElement;

    // col1 is now outer-left — stays in flex row at position: relative
    expect(window.getComputedStyle(col1).position).toBe("relative");
    expect(window.getComputedStyle(col2).position).toBe("relative");
  });

  test("a quick refocus/unfocus double-click freezes the true (un-projected) size, not a depth-deck-perspective-contaminated one (F7 item 1)", async () => {
    // Michael's exact repro (F5 item 4, now root-caused): a column that's
    // already unfocused and settled into the depth deck, then a QUICK
    // focus/unfocus double-click — the second click interrupts the first's
    // still-in-flight zMV spring back toward 0. Real dev-app probe measured
    // a 100%-consistent ~12px displacement across every interrupt gap
    // tried (60-500ms).
    //
    // Root cause, CORRECTED after this pin was found vacuous (gate review):
    // of the three sites fixed (the per-render `lastObservedSize` snapshot
    // effect, the shared ResizeObserver callback, and `contentHeightAtSave`),
    // only the ResizeObserver callback is reachable through THIS specific
    // interrupt shape — probe-confirmed by instrumenting all three read
    // sites directly. On the exact commit `columnFocused` flips true, Motion's
    // `layout` FLIP (item 2's mechanism) recomposes the column's ENTIRE
    // transform for its own position:absolute->relative correction and — at
    // that instant — the composed string has no Z component at all, even
    // though `zMV.get()` genuinely still reads -100 unmoved; the snapshot
    // effect and `contentHeightAtSave` both fire on that SAME commit, so a
    // `getBoundingClientRect()` read there is (at least in this codebase's
    // current `layout`-FLIP-on-refocus shape) never actually contaminated —
    // an original zero-wait-double-rerender reproduction is genuinely
    // vacuous, not just under-covered. The REAL exposure needs the zMV
    // spring to have started moving (a `wait(100)` is enough) so the
    // ResizeObserver's callback — decoupled from React's commit timing,
    // firing on its own schedule once the layout size genuinely changed —
    // reads the column mid-flight (probe-confirmed: `zMV.get()` -99.64,
    // transform a real `matrix3d(...)` with a nonzero Z, `getBoundingClientRect()`
    // reporting a projected ~427x711 against the true 480x800). That
    // contaminated read gets frozen via `setFrozenSize` if the interrupting
    // unfocus lands after it; re-entering the depth deck then projects the
    // already-wrong frozen size a SECOND time — the compounding
    // foreshortening this item describes. Same class as H11 (SceneColumn.tsx's
    // own established `offsetHeight`-not-`getBoundingClientRect()` pattern
    // for exactly this transform-contamination problem).
    //
    // Matches the live dev-app demo's own asymmetric column widths (Nav
    // 160px / Article 480px / Sidebar 160px) rather than three equal-width
    // columns — verified empirically that this shape is not what
    // discriminates (the equal-width version reproduces the same
    // ResizeObserver-mid-flight contamination identically); kept for
    // fidelity to the exact repro Michael reported.
    //
    // Defeat-check receipt (gate-requested): severing all three sites back
    // to getBoundingClientRect() goes red (711.812 vs 800 expected — the
    // once-projected value). Severing each site ALONE: the ResizeObserver
    // callback (site C) alone is SUFFICIENT to go red on its own (711.653 vs
    // 800), matching the diagnosis above — it's the only one of the three
    // actually reachable through this interrupt shape. The snapshot effect
    // (site A) alone and `contentHeightAtSave` (site B) alone both stay
    // green in isolation — A because `layout` FLIP masks Z on that commit as
    // described above, B because `contentHeightAtSave` isn't consumed by
    // either assertion below (it feeds unfocused-column vertical centering,
    // a separate concern). All three sites are still fixed in source (the
    // H11 pattern is the right general defense even where this specific
    // pin can't currently observe sites A/B), but this test's actual
    // discriminating power rests on site C.
    function BasicFocusDemo() {
      const [articleFocused, setArticleFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle-article" onClick={() => setArticleFocused((v) => !v)}>
            toggle
          </button>
          <Scene>
            <SceneColumn name="nav">
              <SceneObject name="nav-panel" focused style={{ width: 160, height: "100%" }}>
                <div style={{ width: "100%", height: "100%" }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="article">
              <SceneObject
                name="article-panel"
                focused={articleFocused}
                style={{ width: 480, height: "100%" }}
                onActivate={() => setArticleFocused(true)}
              >
                <div data-testid="article-content" style={{ width: "100%", height: "100%" }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="sidebar">
              <SceneObject name="sidebar-panel" focused style={{ width: 160, height: "100%" }}>
                <div style={{ width: "100%", height: "100%" }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<BasicFocusDemo />);
    await wait(600);
    const toggleBtn = getByTestId("toggle-article").element() as HTMLElement;

    // Unfocus — settle fully into the depth deck (Z reaches -100, depth-1).
    toggleBtn.click();
    await wait(600);

    const articleCol = getByTestId("article-content").element().closest("[data-column]") as HTMLElement;

    // The interrupt: refocus (starts the zMV spring back toward 0), a real
    // 100ms gap (long enough for the ResizeObserver callback to fire while
    // zMV is still mid-flight — see comment above), then unfocus again,
    // re-freezing whatever `lastObservedSize` currently holds.
    toggleBtn.click();
    await wait(100);
    toggleBtn.click();

    // Let everything settle back into the depth deck.
    await wait(600);

    // Frozen size must be the TRUE 800px (TestWrapper's fullPage default
    // height), not the once-projected ~711px a stale getBoundingClientRect()
    // read would have captured.
    expect(parseFloat(articleCol.style.height)).toBeCloseTo(800, -1);

    // Rendered height is the true size projected ONCE by the depth deck's
    // own perspective (800 * 800/900 ≈ 711.1), not projected TWICE (a buggy
    // ~711px frozen size projected again would render ~632px). ui#17
    // anchor/panel split: the z/perspective projection paints on the panel
    // node now, not the zero-footprint anchor `articleCol` itself (which
    // carries the un-projected frozen height checked above) — see the
    // panel's own JSX comment for why.
    const articlePanel = articleCol.querySelector("[data-scene-column]") as HTMLElement;
    const projectedOnce = 800 * (800 / 900);
    expect(articlePanel.getBoundingClientRect().height).toBeCloseTo(projectedOnce, 0);
  });
});
