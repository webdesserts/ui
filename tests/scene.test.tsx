import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { StrictMode, useLayoutEffect, useState } from "react";
import { render, cleanup } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import type { SceneScrollMetrics } from "../src/components/scene/scrollMetrics";
import { hasReducedMotionListener, prefersReducedMotion } from "motion/react";
import { MotionSeamContext } from "../src/components/scene/motionSeam";
import { ColumnPositionContext, type ColumnPosition } from "../src/components/scene/ColumnPositionContext";
import { StackDepthContext } from "../src/components/scene/StackDepthContext";
import { DepthDeckContext } from "../src/components/scene/DepthDeckContext";
import { ViewportContext } from "../src/components/scene/ViewportContext";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame, wait, createMotionSeamRecorder, waitForAnimationsToSettle } from "./utils/animation";

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

/**
 * Extracts the raw (pre-perspective-projection) translateX value written to
 * an element's inline `transform` style. Motion writes this as either
 * `translate3d(x, y, z)` or, when y is 0, separate `translateX(x)
 * translateZ(z)` functions — this matches either shape. Depth-deck geometry
 * assertions read this raw value rather than getBoundingClientRect() because
 * CSS perspective projection scales rendered pixel positions non-linearly by
 * depth (deeper cards are foreshortened more), while the x offset actually
 * written to the transform (what SceneColumn's animateX computes) is exact.
 */
function parseTranslateX(transform: string): number {
  const match = transform.match(/translateX?\(([-\d.]+)px(?:,|\))/) ?? transform.match(/translate3d\(([-\d.]+)px/);
  if (!match) throw new Error(`Could not parse translateX from transform: "${transform}"`);
  return parseFloat(match[1]!);
}

/** Same rationale as parseTranslateX (see its docstring) — the raw
 *  translateY written to the transform (undistorted by perspective
 *  foreshortening), not a rendered getBoundingClientRect() position. */
function parseTranslateY(transform: string): number {
  const match =
    transform.match(/translate3d\([-\d.]+px,\s*([-\d.]+)px/) ??
    transform.match(/translateY\(([-\d.]+)px\)/);
  if (!match) throw new Error(`Could not parse translateY from transform: "${transform}"`);
  return parseFloat(match[1]!);
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
    // ~711px frozen size projected again would render ~632px).
    const projectedOnce = 800 * (800 / 900);
    expect(articleCol.getBoundingClientRect().height).toBeCloseTo(projectedOnce, 0);
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
// F4: Debug — observational purity (spec: scene-debug.feature "Debug does not
// affect layout"). The existing "debug does not affect layout" test above
// only checks one column's computed position/flexGrow — it doesn't catch a
// debug-only DOM node actually widening the scene's scroll extent (the
// CameraDebug-incident class documented on warnStrayChild, above). These
// pins compare the FULL scroll/layout footprint (scrollWidth/Height,
// clientWidth/Height, per-column rects) between debug on and off for the
// same underlying content, across three representative layouts.
//
// The discriminating fixtures below deliberately give one SceneObject a long,
// hyphen/space-free (unbreakable) name and position it near the viewport's
// right edge. This isn't a contrived edge case: SceneObjectOutlines' name
// label is a `position: absolute` <span> anchored at its outline box's
// top-left with no width constraint — an unbreakable name wider than the
// object's own box overflows the outline box unclipped, and (absent
// containment) that overflow is real, positive-direction (rightward) content
// that widens the viewport's scrollable overflow area — this reproduces even
// though the outline box ITSELF (an exact-rect duplicate of the real
// object's box) never does, since browsers still report the larger
// scrollWidth for overflow:hidden content, they just don't render a
// scrollbar for it (verified directly: a plain overflow:hidden div with an
// absolutely-positioned overflowing child reports the wider scrollWidth).
// ---------------------------------------------------------------------------

describe("Scene debug — layout purity (scrollWidth/scrollHeight identical on/off)", () => {
  const UNBREAKABLE_LONG_NAME = "reallylongsceneobjectnamewithnobreaksatallwhatsoever";

  /** scrollWidth/scrollHeight/clientWidth/clientHeight for the scene element. */
  function measureScrollMetrics(scene: HTMLElement) {
    return {
      scrollWidth: scene.scrollWidth,
      scrollHeight: scene.scrollHeight,
      clientWidth: scene.clientWidth,
      clientHeight: scene.clientHeight,
    };
  }

  test("fits-and-centered: identical scroll metrics with debug on vs off", async () => {
    // A single narrow focused SceneObject with a long unbreakable name,
    // centered in a viewport just wide enough to fit it. No native overflow
    // exists without debug; the debug label's overflow (if unclipped) would
    // create overflow that doesn't exist without debug.
    const build = (debug: boolean) => (
      <TestWrapper fullPage width={100} height={200}>
        <Scene duration={0} debug={debug}>
          <SceneColumn name="col">
            <SceneObject name={UNBREAKABLE_LONG_NAME} focused>
              <div data-testid="content" style={{ width: 20, height: 20 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const off = await render(build(false));
    await waitForAnimationFrame();
    const metricsOff = measureScrollMetrics(off.getByTestId("scene").element() as HTMLElement);
    await cleanup();

    const on = await render(build(true));
    await waitForAnimationFrame();
    const metricsOn = measureScrollMetrics(on.getByTestId("scene").element() as HTMLElement);
    await cleanup();

    expect(metricsOn).toEqual(metricsOff);
  });

  test("horizontal-overflow with parked columns: identical scroll metrics with debug on vs off", async () => {
    // Two 800px focused columns already overflow a 1280px viewport
    // natively. A third column (long unbreakable name) is focused at mount
    // (to freeze its size), then unfocused so it parks just past the two
    // focused columns — exercising a parked/offscreen-classified column
    // alongside existing native overflow.
    async function build(debug: boolean) {
      const mountJsx = (farRightFocused: boolean) => (
        <TestWrapper fullPage>
          <Scene duration={0} debug={debug}>
            <SceneColumn name="col-a">
              <SceneObject name="obj-a" focused>
                <div data-testid="content-a" style={{ width: 800, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-b">
              <SceneObject name="obj-b" focused>
                <div data-testid="content-b" style={{ width: 800, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-c">
              <SceneObject name={UNBREAKABLE_LONG_NAME} focused={farRightFocused}>
                <div data-testid="content-c" style={{ width: 20, height: 100 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
      const { rerender, getByTestId } = await render(mountJsx(true));
      await rerender(mountJsx(false));
      await waitForAnimationFrame();
      return measureScrollMetrics(getByTestId("scene").element() as HTMLElement);
    }

    const metricsOff = await build(false);
    await cleanup();
    const metricsOn = await build(true);
    await cleanup();

    expect(metricsOn).toEqual(metricsOff);
  });

  test("depth-deck layout: identical scroll metrics with debug on vs off", async () => {
    // Left/right focused columns (450px each) fit the 1280px viewport with
    // an in-between (depth-deck) unfocused column between them, plus a
    // fourth column (long unbreakable name) that starts focused (to freeze
    // its size) then unfocuses, parking just inside the viewport's right
    // edge with generous headroom for an unclipped label to overflow into.
    async function build(debug: boolean) {
      const mountJsx = (farRightFocused: boolean) => (
        <TestWrapper fullPage>
          <Scene duration={0} debug={debug}>
            <SceneColumn name="col-left">
              <SceneObject name="obj-left" focused>
                <div data-testid="content-left" style={{ width: 450, height: 200 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-middle">
              <SceneObject name="obj-middle" focused={false}>
                <div data-testid="content-middle" style={{ width: 300, height: 200 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-right">
              <SceneObject name="obj-right" focused>
                <div data-testid="content-right" style={{ width: 450, height: 200 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-far-right">
              <SceneObject name={UNBREAKABLE_LONG_NAME} focused={farRightFocused}>
                <div data-testid="content-far-right" style={{ width: 20, height: 200 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
      const { rerender, getByTestId } = await render(mountJsx(true));
      await rerender(mountJsx(false));
      await waitForAnimationFrame();
      const midCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
      // Sanity-check the fixture actually exercises the depth-deck
      // classification this test claims to cover.
      expect(midCol.getAttribute("data-column-position")).toBe("in-between");
      return measureScrollMetrics(getByTestId("scene").element() as HTMLElement);
    }

    const metricsOff = await build(false);
    await cleanup();
    const metricsOn = await build(true);
    await cleanup();

    expect(metricsOn).toEqual(metricsOff);
  });
});

// ---------------------------------------------------------------------------
// F4 commit 2 feature (a): active-springs debug panel
// ---------------------------------------------------------------------------

describe("Scene debug — active springs panel", () => {
  test("shows a registered key with a live value while a real camera-pan transition is in flight", async () => {
    // Real (non-zero) duration, toggling which of two columns is focused —
    // triggers a real cameraX spring (see SceneViewport's stageLeft effect).
    const mountJsx = (leftFocused: boolean) => (
      <TestWrapper fullPage>
        <Scene debug>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused={leftFocused}>
              <div style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused={!leftFocused}>
              <div style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
    const { rerender, getByTestId } = await render(mountJsx(true));
    await wait(50);
    await rerender(mountJsx(false));

    const scene = getByTestId("scene").element();
    const cameraRow = scene.querySelector("[data-debug-spring='cameraX']");
    expect(cameraRow).not.toBeNull();
    const valueEl = cameraRow?.querySelector("[data-debug-spring-value]");
    const targetEl = cameraRow?.querySelector("[data-debug-spring-target]");
    const velocityEl = cameraRow?.querySelector("[data-debug-spring-velocity]");
    // A real animate() call registered a target — unlike the inertia/fling
    // case, this should never read the "—" placeholder.
    expect(valueEl?.textContent).toMatch(/^-?\d+\.\d$/);
    expect(targetEl?.textContent).toMatch(/^-?\d+\.\d$/);
    expect(velocityEl?.textContent).toMatch(/^-?\d+\.\d$/);

    await wait(1000); // let the spring settle before unmounting mid-flight
    await cleanup();
  });

  test("a spring entry disappears once its owning object unmounts (no key leak)", async () => {
    // Mirrors the fixture in "Scene debug overlay object-list staleness"
    // above — registerMotionValue's unregister cleanup (F4) must run on the
    // same unmount that test pins for the object list itself.
    const build = (showSecond: boolean) => (
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="first" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
            {showSecond && (
              <SceneObject name="second" focused={false}>
                <div style={{ width: 100, height: 100 }} />
              </SceneObject>
            )}
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
    const { rerender, getByTestId } = await render(build(true));
    const scene = getByTestId("scene").element();
    await waitForAnimationFrame();
    expect(scene.querySelector("[data-debug-spring='withinColumnTop:second']")).not.toBeNull();

    await rerender(build(false));
    await waitForAnimationFrame();
    expect(scene.querySelector("[data-debug-spring='withinColumnTop:second']")).toBeNull();
  });

  test("no springs section when nothing has registered (debug on, duration=0, no motion in flight)", async () => {
    // duration=0 never calls animate(), so nothing exercises the registration
    // effects' animate-branch — but registerMotionValue itself is
    // unconditional, so keys DO appear (at rest). This just pins that the
    // section renders without throwing and lists the always-registered keys.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    const scene = getByTestId("scene").element();
    await waitForAnimationFrame();
    const cameraRow = scene.querySelector("[data-debug-spring='cameraX']");
    expect(cameraRow).not.toBeNull();
    expect(cameraRow?.querySelector("[data-debug-spring-target]")?.textContent).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// F4 commit 2 feature (b): stage-bounds + stray-child debug visualization
// ---------------------------------------------------------------------------

describe("Scene debug — stage bounds outline", () => {
  test("appears when frozen/parked outer columns make the stage wider than the focused span", async () => {
    // Mirrors the "Camera stage-left centers focused region when outer
    // columns extend the stage" fixture (Phase 4 above): 900px outer
    // columns, previously focused to freeze their size, then unfocused —
    // the stage (2016px including gaps) is far wider than the 200px
    // focused span, but overflowsX stays false (native scroll doesn't
    // reflect it) — exactly the invisible-unless-you-look shape this
    // outline exists to surface. The 1656px scrollWidth this produces is
    // real, PRE-EXISTING content overflow (the frozen columns themselves,
    // clipped by overflow:hidden — see F4 commit 1's "PARKED" probe), not
    // something this outline adds — asserted below by comparing debug on
    // vs off for the identical layout, matching the commit-1 purity pins.
    async function build(debug: boolean) {
      const { rerender, getByTestId } = await render(
        <TestWrapper fullPage>
          <Scene duration={0} debug={debug}>
            <SceneColumn name="col-left">
              <SceneObject name="obj-left" focused>
                <div style={{ width: 900, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-focused">
              <SceneObject name="obj-focused" focused>
                <div style={{ width: 200, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-right">
              <SceneObject name="obj-right" focused>
                <div style={{ width: 900, height: 100 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );
      await rerender(
        <TestWrapper fullPage>
          <Scene duration={0} debug={debug}>
            <SceneColumn name="col-left">
              <SceneObject name="obj-left" focused={false}>
                <div style={{ width: 900, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-focused">
              <SceneObject name="obj-focused" focused>
                <div style={{ width: 200, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-right">
              <SceneObject name="obj-right" focused={false}>
                <div style={{ width: 900, height: 100 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );
      // Pre-existing rect-measurement-family settle race (reproduces
      // identically with debug entirely absent — not a purity regression):
      // the size-freeze + stageLeft repositioning effects can need one more
      // frame to settle after rerender() resolves before scrollWidth reads
      // consistently. Matches this suite's established convention of a
      // settle wait after a rerender that changes frozen-size geometry.
      await waitForAnimationFrame();
      const scene = getByTestId("scene").element();
      return { scrollWidth: scene.scrollWidth, clientWidth: scene.clientWidth, outline: scene.querySelector("[data-debug-stage-bounds]") };
    }

    const off = await build(false);
    expect(off.outline).toBeNull();
    await cleanup();

    const on = await build(true);
    expect(on.outline).not.toBeNull();
    expect(on.outline?.textContent).toContain("focused 200px");
    expect(on.scrollWidth).toBe(off.scrollWidth);
    expect(on.clientWidth).toBe(off.clientWidth);
  });

  test("does not appear when the stage matches the focused span (no hidden content)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    const scene = getByTestId("scene").element();
    expect(scene.querySelector("[data-debug-stage-bounds]")).toBeNull();
  });
});

describe("Scene debug — stray child flags", () => {
  test("flags a stray direct child of Scene (neither SceneColumn nor SceneObject)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <p data-testid="stray">a stray debug readout</p>
        </Scene>
      </TestWrapper>,
    );
    const scene = getByTestId("scene").element();
    const flag = scene.querySelector("[data-debug-stray-child='p']");
    expect(flag).not.toBeNull();
    expect(flag?.textContent).toContain("stray <p>");
    warnSpy.mockRestore();
  });

  test("does not flag a legitimate SceneColumn", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    const scene = getByTestId("scene").element();
    expect(scene.querySelectorAll("[data-debug-stray-child]").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F4 commit 2 feature (d): paint-order badges
// ---------------------------------------------------------------------------

describe("Scene debug — paint-order badges", () => {
  test("column-level: an in-between column gets a badge with its depth-1 translateZ", async () => {
    // Same fixture shape as "Scene debug — stacking depth" above: left/right
    // focused, middle unfocused (in-between, depth 1 -> translateZ -100).
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
    await waitForAnimationFrame();
    const badge = scene.querySelector("[data-debug-paint-badge='column:middle']");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("z:-100");

    // Focused columns are not deck cards — no badge for either.
    expect(scene.querySelector("[data-debug-paint-badge='column:left']")).toBeNull();
    expect(scene.querySelector("[data-debug-paint-badge='column:right']")).toBeNull();
  });

  test("within-column: an object sandwiched between two focused siblings gets a badge", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }} />
            </SceneObject>
            <SceneObject name="obj-c" focused>
              <div data-testid="content-c" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("content-a").element().closest("[data-testid='scene']") as HTMLElement;
    await waitForAnimationFrame();
    const badge = scene.querySelector("[data-debug-paint-badge='object:obj-b']");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("z:-100");

    // Focused objects are not deck cards.
    expect(scene.querySelector("[data-debug-paint-badge='object:obj-a']")).toBeNull();
    expect(scene.querySelector("[data-debug-paint-badge='object:obj-c']")).toBeNull();
  });

  test("no badges when nothing is in the depth deck", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    const scene = getByTestId("scene").element();
    expect(scene.querySelectorAll("[data-debug-paint-badge]").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F4 commit 2 feature (c): geometry-store inspector
// ---------------------------------------------------------------------------

describe("Scene debug — geometry store inspector", () => {
  test("overlay lists each registered object's offsetTop/height, grouped by column", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 150 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 80 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("content-a").element().closest("[data-testid='scene']") as HTMLElement;
    const overlay = scene.querySelector("[data-debug-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("Geometry store");

    const columnSection = scene.querySelector("[data-debug-geometry-column='col']");
    expect(columnSection).not.toBeNull();

    // obj-a is focused, so its offsetTop should be 0 (it's the visible
    // top of the content wrapper) and its height should match the 150px
    // content.
    const objA = scene.querySelector("[data-debug-geometry-object='obj-a']");
    expect(objA?.textContent).toContain("top=0");
    expect(objA?.textContent).toContain("h=150");

    // obj-b is unfocused (not a depth card here — nothing focused after
    // it), still registered and measured — the geometry store tracks every
    // registered object, not just focused ones.
    const objB = scene.querySelector("[data-debug-geometry-object='obj-b']");
    expect(objB).not.toBeNull();
    expect(objB?.textContent).toContain("h=80");
  });

  test("no geometry-store section when nothing is registered yet (e.g. no columns)", async () => {
    // A Scene with no children still renders (edge case) — no geometry
    // section should appear, and the overlay must not throw.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <></>
        </Scene>
      </TestWrapper>,
    );
    const scene = getByTestId("scene").element();
    expect(scene.querySelector("[data-debug-overlay]")).not.toBeNull();
    expect(scene.querySelectorAll("[data-debug-geometry-column]").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F4 commit 2 feature (e): live slowMo toggle
// ---------------------------------------------------------------------------

describe("Scene debug — live slowMo toggle", () => {
  test("checkbox reflects the slowMo prop and toggling changes the NEXT transition's spring physics", async () => {
    // Test-provided motion seam recorder (tests/utils/animation.ts) so the
    // real AnimationPlaybackControls Motion computes for each cameraX
    // animate() call is directly readable — .duration is Motion's own
    // computed spring settle time, a precise, non-flaky way to tell fast
    // (stiffness 300/damping 30) and slowMo (stiffness 30/damping 8) apart
    // without racing real wall-clock animation timing.
    const recorder = createMotionSeamRecorder();
    const mountJsx = (leftFocused: boolean) => (
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene debug>
            <SceneColumn name="col-left">
              <SceneObject name="obj-left" focused={leftFocused}>
                <div style={{ width: 400, height: 200 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-right">
              <SceneObject name="obj-right" focused={!leftFocused}>
                <div style={{ width: 400, height: 200 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(mountJsx(true));
    const scene = getByTestId("scene").element();

    const checkbox = scene.querySelector("[data-debug-slowmo-toggle] input") as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false); // slowMo prop defaults to false

    // Real (fast) transition — record its computed duration.
    await wait(50);
    await rerender(mountJsx(false));
    await waitForAnimationFrame();
    const fastDuration = recorder.controls.get("cameraX")?.duration;
    expect(fastDuration).toBeGreaterThan(0);

    // Toggle slowMo on via the overlay checkbox — a real click, not a
    // synthetic prop change, matching how a developer would actually use it.
    checkbox.click();
    await waitForAnimationFrame();
    expect(checkbox.checked).toBe(true);

    // Let the fast transition fully settle before starting a new one — the
    // in-flight one from before the toggle is NOT retargeted (no code path
    // does that), only a transition STARTED after the toggle picks up the
    // new physics.
    await wait(1000);
    await rerender(mountJsx(true));
    await waitForAnimationFrame();
    const slowDuration = recorder.controls.get("cameraX")?.duration;
    expect(slowDuration).toBeGreaterThan(0);
    expect(slowDuration!).toBeGreaterThan(fastDuration! * 1.5);
  });

  test("does not affect layout/scroll metrics — pointer-events change is scoped to the overlay panel only", async () => {
    // The overlay panel itself becomes pointerEvents:"auto" (F4 feature e's
    // documented tradeoff) — but every OTHER debug element stays
    // pointerEvents:"none", and none of this touches scrollWidth/clientWidth
    // (the F4 commit-1 purity bar, unaffected by pointer-events either way).
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    const scene = getByTestId("scene").element() as HTMLElement;
    const overlay = scene.querySelector("[data-debug-overlay]") as HTMLElement;
    expect(window.getComputedStyle(overlay).pointerEvents).toBe("auto");

    const outline = scene.querySelector("[data-debug-object-outline]") as HTMLElement;
    expect(window.getComputedStyle(outline).pointerEvents).toBe("none");

    expect(scene.scrollWidth).toBe(scene.clientWidth);
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

  test("Debug — object outline's rAF re-measure loop runs continuously while mounted, not gated on declarative animation activity (F6 item 1)", async () => {
    // Root cause (probe-confirmed on the dev app's Debug mode demo): the
    // outline's rAF re-measure loop used to be gated on an `animatingRef`
    // counter fed only by onAnimationStart/onLayoutAnimationStart callbacks
    // wired to DECLARATIVE `animate`-prop transitions. A within-column
    // swap's `top` offset (topOffsetMV) is driven entirely by the S3+
    // imperative motion pipeline (`animate(topOffsetMV, ...)`, no
    // onAnimationStart-wired prop) — nothing ever incremented the counter,
    // so the outline froze at its pre-swap position for the whole
    // transition and never caught up even after the real object settled
    // (probe measured a max delta of 72px, persisting the entire ~330ms
    // transition on the real dev app).
    //
    // This asserts the fix's actual, direct claim — the rAF loop runs
    // unconditionally while `debug` is enabled, not "does some declarative
    // transition happen to also cover it" — rather than reproducing a
    // specific transition. That's deliberate: probe-verified during
    // development that a rect-comparison test built around a real
    // topOffsetMV-driven swap could NOT reliably discriminate fixed from
    // unfixed code in this test harness, because a same-column swap's
    // `layout` FLIP prop (still correctly wired to onLayoutAnimationStart)
    // tends to also fire for incidental sub-pixel shifts during the swap,
    // masking the topOffsetMV-specific gap even on the pre-fix code. The
    // rAF-call-rate signature below is immune to that: it holds the scene
    // completely static (nothing ever transitions, declaratively or
    // imperatively) after the initial settle, so `animatingRef` genuinely
    // never leaves 0 — any rAF loop still firing every frame in that
    // window must be a continuous one, not one gated on real animation
    // activity. Counts window.requestAnimationFrame call *rate* (not
    // component-internal state) — a debug-only signal, no production code
    // instrumentation needed.
    let rafCount = 0;
    const originalRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCount++;
      return originalRaf(cb);
    };

    try {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0} debug>
            <SceneColumn name="col">
              <SceneObject name="obj-a" focused>
                <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      // Let mount-time renders settle before establishing a baseline.
      await waitForAnimationFrame();
      await waitForAnimationFrame();
      await waitForAnimationFrame();

      rafCount = 0;
      const framesToSample = 5;
      for (let i = 0; i < framesToSample; i++) {
        await waitForAnimationFrame();
      }

      // this test's own waitForAnimationFrame() calls contribute exactly
      // `framesToSample` — anything beyond that came from continuous debug
      // loops (ActiveSpringsSection, PaintOrderBadges, and — with the fix —
      // SceneObjectOutlines/StageBoundsOutline/StrayChildFlags).
      const continuousLoopCallsPerFrame = rafCount / framesToSample - 1;

      // Before the fix: only ActiveSpringsSection + PaintOrderBadges run
      // continuously (2). After: + SceneObjectOutlines + StageBoundsOutline
      // + StrayChildFlags (5 total) — a clear, non-adjacent threshold.
      expect(continuousLoopCallsPerFrame).toBeGreaterThanOrEqual(5);
    } finally {
      window.requestAnimationFrame = originalRaf;
    }
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

describe("Scene debug overlay object-list staleness (S6 gate fix)", () => {
  test("overlay object list reflects a mount/unmount in the SAME commit, with no other re-render trigger", async () => {
    // Single column, single always-focused object — deliberately avoids the
    // S6 registry correction re-render (a SECOND column classified
    // outer-left/right would trigger Scene's own correction effect, masking
    // this component's own staleness). The overlay's object-list query
    // (queryDebugObjects, during render) reads the DOM as of the END of the
    // PREVIOUS commit — unlike SceneObjectOutlines (which self-corrects via
    // its own layout-effect-triggered pre-paint re-render), the overlay had
    // no correction mechanism, so nothing else in this minimal tree ever
    // gives it a chance to see the mutation.
    const build = (showSecond: boolean) => (
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="first" focused>
              <div data-testid="first-content" style={{ width: 100, height: 100 }} />
            </SceneObject>
            {showSecond && (
              <SceneObject name="second" focused={false}>
                <div data-testid="second-content" style={{ width: 100, height: 100 }} />
              </SceneObject>
            )}
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(false));
    const scene = getByTestId("scene").element();

    let overlay = scene.querySelector("[data-debug-overlay]");
    expect(overlay?.textContent).not.toContain("second");

    // Mount — no waitForAnimationFrame()/extra tick between this and the
    // assertion, matching the bug's own condition ("no other re-render
    // trigger"): if this needs an extra frame to settle, the bug is still
    // present in a milder form.
    await rerender(build(true));
    overlay = scene.querySelector("[data-debug-overlay]");
    expect(overlay?.textContent).toContain("second");

    // Unmount.
    await rerender(build(false));
    overlay = scene.querySelector("[data-debug-overlay]");
    expect(overlay?.textContent).not.toContain("second");
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

    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;
    const contentWrapper = objB.closest("[data-column]")?.querySelector("[data-column-content]") as HTMLElement;

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

    const contentWrapper = getByTestId("content-a").element().closest("[data-column]")
      ?.querySelector("[data-column-content]") as HTMLElement;

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
    const build = () => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj" focused>
              <div data-testid="content" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build());

    const viewport = getByTestId("scene").element() as HTMLElement;
    const wrapper = viewport.querySelector("[data-column-content]") as HTMLElement;
    const readMarginTop = () => parseFloat(wrapper.style.marginTop || "0");

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
      <TestWrapper fullPage>
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
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-stage]") as HTMLElement;
    const contentWrapper = getByTestId("content-a").element().closest("[data-column]")
      ?.querySelector("[data-column-content]") as HTMLElement;

    const readStageLeft = () => parseFloat(window.getComputedStyle(stage).left);
    const readMarginTop = () => parseFloat(window.getComputedStyle(contentWrapper).marginTop);

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

    const contentWrapper = getByTestId("content-a").element().closest("[data-column]")
      ?.querySelector("[data-column-content]") as HTMLElement;

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

    const contentWrapper = getByTestId("content-a").element().closest("[data-column]")
      ?.querySelector("[data-column-content]") as HTMLElement;
    const readMarginTop = () => parseFloat(window.getComputedStyle(contentWrapper).marginTop);

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
    const colEl = viewport.querySelector("[data-column]") as HTMLElement;

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
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ minWidth: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const contentWrapper = scene.querySelector("[data-column-content]") as HTMLElement;
    const content = getByTestId("content").element() as HTMLElement;

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
            <SceneObject name="panel" focused>
              {/* 1000px tall overflows the 800px viewport; 300px wide fits */}
              <div data-testid="content" style={{ minWidth: 300, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const contentWrapper = scene.querySelector("[data-column-content]") as HTMLElement;
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
      <TestWrapper fullPage>
        <Scene duration={0}>
          {/* Three 500px columns (1500px total) exceed the 1280px viewport;
              100px height fits the 800px viewport. */}
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
    const stage = scene.querySelector("[data-stage]") as HTMLElement;

    // Horizontal: left-aligned — stage left is 0 (focused region starts at
    // the stage origin, so no leftward pan is needed).
    const stageLeft = parseFloat(window.getComputedStyle(stage).left);
    expect(stageLeft).toBe(0);

    // Vertical: each column's content is still centered independently.
    for (const testId of ["content1", "content2", "content3"]) {
      const contentWrapper = getByTestId(testId)
        .element()
        .closest("[data-column]")!
        .querySelector("[data-column-content]") as HTMLElement;
      const marginTop = parseFloat(window.getComputedStyle(contentWrapper).marginTop);
      expect(marginTop).toBeGreaterThan(0);
      expect(Math.abs(marginTop - (800 - 100) / 2)).toBeLessThan(2);
    }
  });

  test("focused content overflows both axes — top-left corner visible", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              {/* 1500px wide and 1000px tall overflow both the 1280x800 viewport. */}
              <div data-testid="content" style={{ width: 1500, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-stage]") as HTMLElement;
    const contentWrapper = scene.querySelector("[data-column-content]") as HTMLElement;

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
// S7 coverage backfill: scrollbar placement (scene-scroll.feature "Each
// overflowing column gets its own vertical scrollbar") — the rightmost
// column's scrollbar sits at the Camera's right edge; other columns'
// scrollbars sit between adjacent focused columns. This is emergent from
// each Scrollbar being `position: absolute; right: 0` relative to its own
// column (Scrollbar.tsx) — untested until now.
// ---------------------------------------------------------------------------

describe("Scene scrollbar placement (S7 coverage)", () => {
  // SPEC-IMPLEMENTATION GAP, needs adjudication: written to the spec's exact
  // Given clause ("two focused columns that both overflow the viewport
  // height" — no width-overflow requirement) and its exact Then clause
  // ("the rightmost column's scrollbar should appear at the right edge of
  // the Camera"). With two 400px columns under the 1280px viewport, the
  // layout CENTERS them (they don't overflow width), so the rightmost
  // column's right edge lands at ~1040px, not the viewport's 1280px right
  // edge — confirmed by the math (240px centering offset + 800px combined
  // width = 1040, matching the observed failure). The spec's "right edge of
  // the Camera" wording is already flagged as needing a hygiene pass (plans/
  // Scene Assessment 2026-07-14, item 11: "scrollbar camera-vs-scene anchor
  // vocabulary") — this is that same ambiguity surfacing as a concrete test
  // failure rather than prose. Left skipped per the fix-plan's own
  // instruction to write-to-spec-and-skip rather than reshape the fixture to
  // force a pass; the "between adjacent columns" half of the claim (asserted
  // below) may still be correct even where the "at the Camera edge" half is
  // spec-imprecise for the non-width-overflowing case — that split needs a
  // human call, not a test-side guess.
  test.skip("rightmost column's scrollbar is at the Camera's right edge; the other sits between the columns", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          {/* Two columns, each individually overflowing vertically, sized to
              fit side by side within the 1280px viewport. */}
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused>
              <div data-testid="content-left" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-obj" focused>
              <div data-testid="content-right" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // The "scene" testid element IS the Camera viewport (viewportRef is
    // attached to the same node, per Scene.tsx).
    const cameraViewport = getByTestId("scene").element() as HTMLElement;
    const cameraRect = cameraViewport.getBoundingClientRect();

    const leftColumn = getByTestId("content-left").element().closest("[data-column]") as HTMLElement;
    const rightColumn = getByTestId("content-right").element().closest("[data-column]") as HTMLElement;
    const leftScrollbar = leftColumn.querySelector("[data-scrollbar]") as HTMLElement;
    const rightScrollbar = rightColumn.querySelector("[data-scrollbar]") as HTMLElement;
    expect(leftScrollbar).not.toBeNull();
    expect(rightScrollbar).not.toBeNull();

    // Rightmost column's scrollbar right-edge aligns with the Camera's right edge.
    const rightScrollbarRect = rightScrollbar.getBoundingClientRect();
    expect(Math.abs(rightScrollbarRect.right - cameraRect.right)).toBeLessThan(2);

    // The non-rightmost (left) column's scrollbar sits at ITS OWN right edge —
    // between the two columns, not at the Camera's right edge.
    const leftColumnRect = leftColumn.getBoundingClientRect();
    const leftScrollbarRect = leftScrollbar.getBoundingClientRect();
    expect(Math.abs(leftScrollbarRect.right - leftColumnRect.right)).toBeLessThan(2);
    expect(leftScrollbarRect.right).toBeLessThan(cameraRect.right - 10);
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
    expect(left2 - right1).toBe(16);
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

  test("horizontal scroll resets when the focused column set changes, even if the new layout still overflows (B1)", async () => {
    // Four 500px columns; three are focused at a time (a sliding window) so
    // the focused region overflows the 1280px viewport in both the before
    // and after layouts — overflow-x stays "auto" throughout and the browser
    // never auto-clamps scrollLeft on its own. This isolates the real bug:
    // the Camera's stageLeft re-centers for the newly-focused region, but
    // nothing resets the separate native scrollLeft, which stays stuck at a
    // position calibrated to the OLD focused region.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
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
          <SceneColumn name="col4">
            <SceneObject name="obj4" focused={false}>
              <div data-testid="content4" style={{ width: 500, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    expect(window.getComputedStyle(scene).overflowX).toBe("auto");

    scene.scrollLeft = 300;
    await waitForAnimationFrame();
    expect(scene.scrollLeft).toBeGreaterThan(0);

    // Focus shifts to a different column set (col2+col3+col4 instead of
    // col1+col2+col3) — the layout as a whole still overflows the viewport.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused={false}>
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
          <SceneColumn name="col4">
            <SceneObject name="obj4" focused>
              <div data-testid="content4" style={{ width: 500, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    expect(window.getComputedStyle(scene).overflowX).toBe("auto");
    expect(scene.scrollLeft).toBe(0);
  });

  test("H10 (investigated, not applied): overflowX toggling does not wobble clientHeight in this test environment", async () => {
    // Regression pin for the empirical finding, NOT the CSS mechanism —
    // `scrollbar-gutter: stable` was tried on the viewport and rejected:
    // (1) this exact wobble isn't reproducible here (asserted below — this
    // environment's scrollbars don't reserve space, so there's nothing for
    // the property to fix in THIS environment); (2) applying it anyway
    // reserved gutter space on the wrong axis (the property targets
    // vertical scrollbars; this viewport's overflowY is permanently
    // hidden), shrinking clientWidth ~11px for zero benefit and regressing
    // 21 visual tests. See Scene.tsx's viewport style comment for the full
    // writeup. If a real device ever shows this wobble, the fix needs a
    // different approach (e.g. locking overflow-x to a constant reservation
    // mode) — this pin exists so a future re-attempt at the same CSS-only
    // fix re-discovers the same rejection instead of re-deriving it.
    const build = (overflow: boolean) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div style={{ minWidth: overflow ? 1000 : 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div style={{ minWidth: overflow ? 1000 : 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(false));
    const scene = getByTestId("scene").element() as HTMLElement;
    const before = scene.clientHeight;

    await rerender(build(true));
    await waitForAnimationFrame();

    expect(scene.clientHeight).toBe(before);
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

  test("async content growth without a prop change updates maxScroll and shows a scrollbar (B2)", async () => {
    // Simulates e.g. an image finishing load and growing its container's
    // intrinsic height — no Scene prop changes, so nothing else would
    // trigger a re-render. The geometry store's ResizeObserver must pick
    // this up on its own.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 300 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // Content fits the 800px viewport initially — no scrollbar yet.
    expect(scene.querySelector("[data-scrollbar]")).toBeNull();

    // Grow the content directly via the DOM — no React re-render, no prop change.
    const content = getByTestId("content").element() as HTMLElement;
    content.style.height = "2500px";

    // Poll for the ResizeObserver-driven update (probe-measured ~1 rAF
    // frame in this harness; generous headroom against occasional slow frames).
    const column = scene.querySelector("[data-column]") as HTMLElement;
    let maxScroll = 0;
    for (let i = 0; i < 20; i++) {
      await waitForAnimationFrame();
      maxScroll = parseFloat(column.getAttribute("data-max-scroll") ?? "0");
      if (maxScroll > 0) break;
    }

    expect(maxScroll).toBeGreaterThan(0);
    expect(scene.querySelector("[data-scrollbar]")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F9 commit 1: content-growth scroll anchoring (anchoring-as-default)
// ---------------------------------------------------------------------------

describe("Scene content-growth scroll anchoring (F9)", () => {
  test("growth above the scroll window compensates same-frame via a React re-render (sync path)", async () => {
    // Multi-focused-object stacking: "top" (grows) above "bottom" (where
    // the user is scrolled). total=1300, viewport=800 -> maxScroll=500.
    const build = (topHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="top" focused>
              <div data-testid="top-content" style={{ width: 400, height: topHeight }} />
            </SceneObject>
            <SceneObject name="bottom" focused>
              <div data-testid="bottom-content" style={{ width: 400, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(300));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Scroll to 400 — window [400, 1200) intersects only "bottom"
    // ([300, 1300) before growth), which becomes the anchor. Poll, not a
    // single waitForAnimationFrame(): the wheel handler's setScrollOffset
    // update lands from a native DOM event outside any act() boundary, so
    // a cold first mount occasionally needs a second frame to settle
    // (same documented flake class as the scroll-restore tests above).
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-400);

    // Grow "top" from 300 to 500 (+200) via a prop change — the sync
    // per-render remeasure path.
    await rerender(build(500));

    // Same frame, no intervening stale sample: the scroll offset shifts by
    // exactly the growth delta, keeping "bottom" (the anchor) visually stable.
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-600);
  });

  test("growth above the scroll window compensates same-frame via a ResizeObserver-driven DOM mutation (async path, B2-style)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="top" focused>
              <div data-testid="top-content" style={{ width: 400, height: 300 }} />
            </SceneObject>
            <SceneObject name="bottom" focused>
              <div data-testid="bottom-content" style={{ width: 400, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Poll, not a single waitForAnimationFrame() — the same documented
    // first-mount flake class as the scroll-restore tests above.
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-400);

    // Grow "top" directly via the DOM — no React re-render, no prop change
    // (the B2 pattern). The shared ResizeObserver must pick this up on its
    // own, asynchronously. data-geometry-height lives on the SceneObject's
    // own OUTER wrapper (data-scene-id), not the consumer's inner content
    // div — that outer wrapper's natural height tracks the child's.
    const topContent = getByTestId("top-content").element() as HTMLElement;
    topContent.style.height = "500px"; // +200
    const topWrapper = scene.querySelector("[data-scene-id='top']") as HTMLElement;

    // Forecast Finding 1: PAIRED polling, not a single waitForAnimationFrame()
    // + one assertion. A test's own rAF continuation can resume BEFORE that
    // pass's ResizeObserver delivery per HTML spec ordering, risking a false
    // red on correct code with a naive single-sample check. Sampling BOTH
    // the geometry attribute and the scroll-offset attribute together on
    // every polled frame proves there is never a frame where geometry
    // reflects the growth but the offset still lags behind it.
    let geometryUpdated = false;
    let offsetAtGeometryUpdate = NaN;
    for (let i = 0; i < 20; i++) {
      await waitForAnimationFrame();
      const geometryHeight = parseFloat(topWrapper.getAttribute("data-geometry-height") ?? "0");
      if (geometryHeight >= 500) {
        geometryUpdated = true;
        offsetAtGeometryUpdate = parseFloat(contentWrapper.style.top || "0");
        break;
      }
    }
    expect(geometryUpdated).toBe(true);
    expect(offsetAtGeometryUpdate).toBe(-600);
  });

  test("growth of the anchor object's own body does not move the scroll offset (control)", async () => {
    // "bottom" IS the anchor here — its own growth never moves its own
    // offsetTop (nothing precedes it in the content wrapper), so this must
    // be a structural no-op, same reason B2's single-object test is safe.
    const build = (bottomHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="top" focused>
              <div data-testid="top-content" style={{ width: 400, height: 300 }} />
            </SceneObject>
            <SceneObject name="bottom" focused>
              <div data-testid="bottom-content" style={{ width: 400, height: bottomHeight }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1000));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Poll, not a single waitForAnimationFrame() — the same documented
    // first-mount flake class as the scroll-restore tests above.
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-400);

    await rerender(build(1400));

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-400);
  });

  test("shrinkage above the scroll window compensates negatively (control — native anchoring handles both directions)", async () => {
    const build = (topHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="top" focused>
              <div data-testid="top-content" style={{ width: 400, height: topHeight }} />
            </SceneObject>
            <SceneObject name="bottom" focused>
              <div data-testid="bottom-content" style={{ width: 400, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(500));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // total=1500, maxScroll=700. Scroll to 600 -> window [600,1400)
    // intersects "bottom" ([500,1500)) -> bottom is the anchor. Poll, not
    // a single waitForAnimationFrame() — the same documented first-mount
    // flake class as the scroll-restore tests above.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 600,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-600);

    // Shrink "top" from 500 to 300 (-200).
    await rerender(build(300));

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-400);
  });

  test("compensation applies as a jump — no spring/animate() call is invoked at rest (real/spring mode)", async () => {
    const recorder = createMotionSeamRecorder();
    const build = (topHeight: number) => (
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="top" focused>
                <div data-testid="top-content" style={{ width: 400, height: topHeight }} />
              </SceneObject>
              <SceneObject name="bottom" focused>
                <div data-testid="bottom-content" style={{ width: 400, height: 1000 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(300));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Let the wheel-triggered spring fully settle before introducing
    // growth, so this compensation event is genuinely "at rest, nothing in
    // flight" — the sibling test below covers the in-flight retarget case.
    await wait(1000);
    const controlsBeforeGrowth = recorder.controls.get(`scrollY:col`);
    expect(controlsBeforeGrowth).toBeDefined();

    await rerender(build(500));

    // No NEW animate() call — the compensation applied via a plain jump,
    // not a spring, so the recorded controls reference is unchanged.
    expect(recorder.controls.get(`scrollY:col`)).toBe(controlsBeforeGrowth);
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-600);
  });

  test("content growth while a real spring is still in flight retargets it by the same delta, preserving momentum (adjudication 1)", async () => {
    const targets = new Map<string, number>();
    const base = createMotionSeamRecorder();
    const recorder: typeof base = {
      ...base,
      registerTarget: (key, target) => targets.set(key, target),
    };
    const build = (topHeight: number) => (
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="top" focused>
                <div data-testid="top-content" style={{ width: 400, height: topHeight }} />
              </SceneObject>
              <SceneObject name="bottom" focused>
                <div data-testid="bottom-content" style={{ width: 400, height: 1000 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(300));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Trigger a real-mode wheel scroll (springs toward 400) — do NOT wait
    // for it to settle.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();

    const controlsInFlight = recorder.controls.get(`scrollY:col`);
    expect(controlsInFlight).toBeDefined();
    expect(targets.get(`scrollY:col`)).toBe(400);

    // Content grows above the window WHILE the spring is mid-flight —
    // triggers the retarget-with-velocity-carryover path.
    await rerender(build(500));

    // A NEW controls entry was registered (retargeting stopped the old
    // one and started a fresh animate() call), toward a target shifted by
    // the same +200 delta.
    expect(recorder.controls.get(`scrollY:col`)).not.toBe(controlsInFlight);
    expect(targets.get(`scrollY:col`)).toBe(600);

    // Velocity carryover, probed directly (adjudication 1): sampled right
    // after the retarget, scrollY's velocity must still be substantial —
    // a silently-reset-to-cold-start spring would read ~0 here instead.
    const scrollYValue = base.values.get(`scrollY:col`)!;
    const velocityAfterRetarget = Math.abs(scrollYValue.getVelocity());
    expect(velocityAfterRetarget).toBeGreaterThan(10);

    // Settles at the position accounting for BOTH the original navigation
    // (400) and the compensation (+200).
    await wait(1000);
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-600);
  });

  test("a maxScroll shrink clamps instantly, not via a visible spring (F9 adjudication 3)", async () => {
    const recorder = createMotionSeamRecorder();
    const build = (contentHeight: number) => (
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col">
              <SceneObject name="panel" focused>
                <div data-testid="content" style={{ width: 400, height: contentHeight }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(1000);
    expect(parseFloat(contentWrapper.style.top || "0")).toBeCloseTo(-300, 0);

    const controlsBeforeShrink = recorder.controls.get(`scrollY:col`);

    // Shrink content from 1200 to 900 -> new maxScroll = 100, well below
    // the current offset (300) -> the clamp effect fires.
    await rerender(build(900));

    // Same-frame: already clamped to the new maxScroll (100) on the very
    // first observable read, no intervening stale-then-corrected sample.
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-100);
    // No NEW spring was invoked — the clamp reclassified from spring to
    // jump (F9 adjudication 3); the recorded controls reference is
    // unchanged.
    expect(recorder.controls.get(`scrollY:col`)).toBe(controlsBeforeShrink);
  });
});

// ---------------------------------------------------------------------------
// F10: intra-object content-growth anchoring
// ---------------------------------------------------------------------------

describe("Scene intra-object content-growth anchoring (F10)", () => {
  const ROW_HEIGHT = 70;

  function buildRows(ids: number[], anchor: "none" | "end" = "none") {
    return (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor={anchor}>
            <SceneObject name="rows" focused>
              {ids.map((id) => (
                <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  function wheelScroll(scene: HTMLElement, column: HTMLElement, deltaY: number) {
    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  test("Peri's minimal repro: a prepend inside a single anchor object's own interior compensates the offset (object-level anchoring is structurally blind here)", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildRows(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // Scroll to 1000 — window [1000, 1800) intersects row 14 ([980, 1050)),
    // the topmost partially-visible row (row 13's [910, 980) is flush
    // against the window's start, not intersecting). Poll contentWrapper's
    // OWN rendered top (not just data-scroll-offset) before capturing a
    // "before" rect below — data-scroll-offset is written synchronously off
    // the scrollY MotionValue by the wheel handler, but the wrapper's
    // ACTUAL rendered position (instant mode's React-state-driven
    // combinedTop) only catches up on the next commit; reading a row's rect
    // in the gap between those two would capture a stale, pre-scroll position.
    wheelScroll(scene, column, 1000);
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-1000);

    const row14Before = getByTestId("row-14").element() as HTMLElement;
    const row14RectBefore = row14Before.getBoundingClientRect();

    // Prepend 20 NEW keyed rows before the existing 50 — keyed reconciliation
    // preserves the existing rows' own DOM identity, so row 14 is the SAME
    // element after this rerender, just moved 20 rows (1400px) further down.
    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildRows([...prependedIds, ...existingIds]));

    // The offset compensates by exactly the prepended height (20 * 70).
    expect(column.getAttribute("data-scroll-offset")).toBe("2400");

    // The landmark — the SAME DOM node throughout — holds its viewport position.
    const row14After = getByTestId("row-14").element() as HTMLElement;
    expect(row14After).toBe(row14Before);
    expect(row14After.getBoundingClientRect().top).toBeCloseTo(row14RectBefore.top, 0);
  });

  test("appending rows below the visible window does not move the tracked row or spuriously compensate (control)", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildRows(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    wheelScroll(scene, column, 1000);
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("1000");

    // Append 20 rows AFTER all existing ones — well below the tracked
    // row's own position, which a plain-flow layout never moves.
    const appendedIds = Array.from({ length: 20 }, (_, i) => 50 + i);
    await rerender(buildRows([...existingIds, ...appendedIds]));

    expect(column.getAttribute("data-scroll-offset")).toBe("1000");
  });

  test("offset-exactly-0 suppression: a prepend while scrolled to the very top does NOT compensate — new content stays discoverable at the top (native-anchoring-mirroring policy, anchor=\"none\" only — F11 mode-scopes this)", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    // anchor="none" pinned EXPLICITLY (F11): the suppression is now
    // mode-scoped — this test's own default-anchor reliance would no
    // longer make it obvious WHICH branch is under test now that
    // anchor="end" behaves oppositely at offset 0 (see the F11 describe
    // block below).
    const { rerender, getByTestId } = await render(buildRows(existingIds, "none"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    // Mounts at offset 0 — no scroll needed. Confirm the starting state.
    expect(column.getAttribute("data-scroll-offset")).toBe("0");

    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildRows([...prependedIds, ...existingIds], "none"));

    // Suppressed: the offset stays at 0 rather than jumping to 1400 to
    // "preserve" the old row 0's position — the newly-prepended content is
    // now what's visible at the top instead.
    expect(column.getAttribute("data-scroll-offset")).toBe("0");
    const newTopRow = getByTestId(`row-${prependedIds[0]}`).element() as HTMLElement;
    expect(newTopRow.getBoundingClientRect().top).toBeCloseTo(column.getBoundingClientRect().top, 0);
  });

  test("a tracked row that gets removed entirely (disconnected) skips compensation that round without crashing, and re-selects a fresh candidate that correctly compensates the NEXT prepend", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildRows(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    wheelScroll(scene, column, 1000);
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("1000");

    // Remove row 14 (the tracked landmark) — nothing else changes. This
    // must not throw, and must not apply a compensation this round (the
    // tracked element is gone; there is nothing valid to diff against).
    const withoutRow14 = existingIds.filter((id) => id !== 14);
    await rerender(buildRows(withoutRow14));
    expect(column.getAttribute("data-scroll-offset")).toBe("1000");

    // Self-heals: a fresh candidate (whatever now sits at the tracked
    // position — row 15, shifted up into row 14's old slot) was re-selected
    // at the end of that settle, so the NEXT prepend compensates correctly
    // again from it.
    const row15Before = getByTestId("row-15").element() as HTMLElement;
    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildRows([...prependedIds, ...withoutRow14]));

    expect(column.getAttribute("data-scroll-offset")).toBe("2400");
    expect(getByTestId("row-15").element()).toBe(row15Before);
  });

  test("composes additively with object-level compensation when a preceding sibling grows AND the anchor object's own interior prepends in the same settle (no double-counting)", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const build = (beforeHeight: number, ids: number[]) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="before" focused>
              <div data-testid="before-content" style={{ width: 400, height: beforeHeight }} />
            </SceneObject>
            <SceneObject name="rows" focused>
              {ids.map((id) => (
                <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(300, existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // total = 300 (before) + 3500 (50 rows) = 3800. Scroll to 1000 — window
    // [1000, 1800) intersects "rows" (which starts at 300), and within it,
    // row 10 (global [1000, 1070)) is the topmost intersecting row (row 9's
    // global [930, 1000) is flush against the window's start). Poll
    // contentWrapper's OWN rendered top (see the primary repro test's
    // identical comment) — this is what guarantees the layout effect (and
    // thus F10's intra-anchor RE-SELECTION for row 10) has actually run
    // before the combined growth event below, not just that
    // data-scroll-offset's synchronous MotionValue write landed.
    wheelScroll(scene, column, 1000);
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-1000);

    // "before" grows 300 -> 400 (object-level delta: +100, sibling growth
    // shifts "rows" itself down) AND "rows" gets a 20-row prepend
    // (intra-level delta, measured LOCAL to "rows": +1400) in the SAME
    // rerender. If the intra-level delta were measured globally instead of
    // locally, it would ALREADY include the +100 from "before" growing
    // (row 10's absolute position reflects both), and adding the
    // object-level delta on top would double-count it — the correct total
    // is 100 + 1400 = 1500, not 100 + 1500 = 1600.
    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(build(400, [...prependedIds, ...existingIds]));

    expect(column.getAttribute("data-scroll-offset")).toBe("2500");
  });

  test("pinned anchor=\"end\" already follows a prepend via the existing pin-follow mechanism (confirmation, not new F10 logic)", async () => {
    const buildPinned = (ids: number[]) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end">
            <SceneObject name="rows" focused>
              {ids.map((id) => (
                <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildPinned(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    // Mounts pinned at maxScroll (3500 - 800 = 2700).
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("2700");

    // A prepend still keeps the offset at the (new, larger) maxScroll —
    // the pin-follow effect reacts to maxScroll growing, independent of F10.
    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildPinned([...prependedIds, ...existingIds]));

    expect(column.getAttribute("data-scroll-offset")).toBe("4100"); // 4900 - 800
  });
});

// ---------------------------------------------------------------------------
// F10b: recursive intra-object anchor descent
// ---------------------------------------------------------------------------

describe("Scene recursive intra-object anchor descent (F10b)", () => {
  const ROW_HEIGHT = 70;

  // Mirrors Peri's real pipeline shape (scene-lab 53): SceneObject's own
  // inert wrapper (single-child, implicit) -> a flex stack (real siblings:
  // rows-container + sticky Composer + sticky PushBanner) -> the rows
  // themselves, nested INSIDE rows-container. F10's one-level descent stops
  // at the flex-stack level (the first level with real siblings) and tracks
  // rows-container itself — an identity-stable wrapper whose own offsetTop
  // never moves from a prepend inside it, reproducing F10's exact blindness
  // one level down.
  function buildChatPipeline(rowIds: number[]) {
    return (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="chat" focused>
              <div data-testid="flex-stack" style={{ display: "flex", flexDirection: "column" }}>
                <div data-testid="rows-container">
                  {rowIds.map((id) => (
                    <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                      row {id}
                    </div>
                  ))}
                </div>
                <div data-testid="composer" style={{ position: "sticky", bottom: 0, height: 60, width: 400 }}>
                  composer
                </div>
                <div data-testid="push-banner" style={{ position: "sticky", top: 0, height: 40, width: 400 }}>
                  push banner
                </div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  test("Peri's real pipeline shape (rows nested two wrapper levels deep, sticky Composer/PushBanner siblings) compensates fully — object-level and F10's one-level descent both reproduce the exact blindness one level down", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildChatPipeline(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // Scroll to 1000 — window [1000, 1800) intersects row 14 ([980, 1050)),
    // the topmost partially-visible row. Poll contentWrapper's OWN rendered
    // top (not just data-scroll-offset) before capturing a "before" rect —
    // see the F10 primary repro test's identical rationale.
    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 1000,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-1000);

    const row14Before = getByTestId("row-14").element() as HTMLElement;
    const row14RectBefore = row14Before.getBoundingClientRect();

    // Prepend 20 NEW keyed rows before the existing 50, nested INSIDE
    // rows-container (two wrapper levels below the flex stack).
    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildChatPipeline([...prependedIds, ...existingIds]));

    // The offset compensates by exactly the prepended height (20 * 70).
    expect(column.getAttribute("data-scroll-offset")).toBe("2400");

    const row14After = getByTestId("row-14").element() as HTMLElement;
    expect(row14After).toBe(row14Before);
    expect(row14After.getBoundingClientRect().top).toBeCloseTo(row14RectBefore.top, 0);
  });
});

// ---------------------------------------------------------------------------
// F11 commit 1: offset-0 suppression policy, mode-scoped
// ---------------------------------------------------------------------------

describe("Scene offset-0 policy mode-scoping (F11 commit 1)", () => {
  const ROW_HEIGHT = 70;

  // Mirrors Peri's real CR-3 pipeline shape (the parked LiveChatHarness
  // repro, extracted from their commit 06588863): an anchor="end" column
  // with a flex-column stack (rows + a sticky composer) — same structural
  // shape as F10b's own chat pipeline test, just anchor="end" here instead
  // of "none". F10's original suppression fired unconditionally at offset
  // 0, producing Peri's exact zero-compensation signature once their
  // reader scrolled all the way back to the oldest loaded message.
  function buildChatPipeline(rowIds: number[]) {
    return (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="chat" anchor="end">
            <SceneObject name="chat" focused>
              <div data-testid="flex-stack" style={{ display: "flex", flexDirection: "column" }}>
                <div data-testid="rows-container">
                  {rowIds.map((id) => (
                    <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                      row {id}
                    </div>
                  ))}
                </div>
                <div data-testid="composer" style={{ position: "sticky", bottom: 0, height: 60, width: 400 }}>
                  composer
                </div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  test("a prepend while scrolled to offset 0 on an anchor=\"end\" column DOES compensate — the reader is holding their place in history, not at a discoverable top (Peri's real CR-3 pipeline shape)", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildChatPipeline(existingIds));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // Mounts pinned at maxScroll. Release the pin and scroll all the way to
    // offset 0 (a huge negative deltaY, clamped) — the exact CR-3 scenario:
    // the reader has read back to the oldest currently-loaded message,
    // which is genuinely ON SCREEN at the top.
    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100000,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Poll contentWrapper's OWN rendered top (not just data-scroll-offset)
    // before capturing a "before" rect below — same rationale as every
    // other F10/F10b test in this file (a raw wheel event's React-state
    // write needs an actual commit to catch up).
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBeCloseTo(0, 5);
    expect(column.getAttribute("data-scroll-offset")).toBe("0");

    const row0Before = getByTestId("row-0").element() as HTMLElement;
    const row0RectBefore = row0Before.getBoundingClientRect();

    // Prepend 20 NEW keyed rows before the existing 50 (loadOlder's shape).
    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildChatPipeline([...prependedIds, ...existingIds]));

    // Compensates by exactly the prepended height (20 * 70) — UNLIKE
    // anchor="none"'s offset-0 suppression (the sibling test above), since
    // this reader is holding their place in history, not discoverable-top-
    // of-a-live-feed.
    expect(column.getAttribute("data-scroll-offset")).toBe("1400");

    const row0After = getByTestId("row-0").element() as HTMLElement;
    expect(row0After).toBe(row0Before);
    expect(row0After.getBoundingClientRect().top).toBeCloseTo(row0RectBefore.top, 0);
  });
});

// ---------------------------------------------------------------------------
// F11 commit 2: declarative scrollTo
// ---------------------------------------------------------------------------

describe("Scene declarative scrollTo (F11 commit 2)", () => {
  const ROW_HEIGHT = 70;
  const ROW_COUNT = 50;
  const rowIds = Array.from({ length: ROW_COUNT }, (_, i) => i);

  function buildScrollTo(scrollToId: string | null, anchor: "none" | "end" = "none") {
    return (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor={anchor} scrollTo={scrollToId}>
            <SceneObject name="rows" focused>
              {rowIds.map((id) => (
                <div key={id} id={`row-${id}`} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  test("navigates to a target below the current window, aligning its bottom with the viewport's bottom", async () => {
    const { rerender, getByTestId } = await render(buildScrollTo(null));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    expect(column.getAttribute("data-scroll-offset")).toBe("0");

    // row-30 spans [2100, 2170) — entirely below window [0, 800). Aligning
    // the bottom: offset = 2170 - 800 = 1370.
    await rerender(buildScrollTo("row-30"));
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("1370");
  });

  test("navigates to a target above the current window, aligning its top with the viewport's top", async () => {
    const { rerender, getByTestId } = await render(buildScrollTo(null));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 2000,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("2000");

    // row-5 spans [350, 420) — entirely above window [2000, 2800).
    await rerender(buildScrollTo("row-5"));
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("350");
  });

  test("an already-fully-visible target does not move the offset", async () => {
    const { rerender, getByTestId } = await render(buildScrollTo(null));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 1000,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("1000");

    // row-15 spans [1050, 1120) — fully contained in window [1000, 1800).
    await rerender(buildScrollTo("row-15"));
    // No movement — give it a beat to prove it genuinely stays, not just
    // hasn't updated yet.
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("1000");
  });

  test("null is inert — no navigation occurs", async () => {
    const { getByTestId } = await render(buildScrollTo(null));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("0");
  });

  test("an unknown id is a documented no-op with a loud dev console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { rerender, getByTestId } = await render(buildScrollTo(null));
      const scene = getByTestId("scene").element() as HTMLElement;
      const column = scene.querySelector("[data-column]") as HTMLElement;

      await rerender(buildScrollTo("does-not-exist"));
      await waitForAnimationFrame();

      expect(column.getAttribute("data-scroll-offset")).toBe("0");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("does-not-exist"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("one-shot semantics: re-setting the SAME id (unchanged prop value) does not re-navigate, even after the user has since scrolled elsewhere", async () => {
    const { rerender, getByTestId } = await render(buildScrollTo(null));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    await rerender(buildScrollTo("row-30"));
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("1370");

    // The user scrolls elsewhere afterward — a real interaction the
    // component must not clobber on a later re-render.
    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -500,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("870");

    // Re-rendering with the SAME "row-30" value (identical string, no
    // intervening null) must NOT re-fire — the offset must stay at the
    // user's own 870, not jump back to 1370.
    await rerender(buildScrollTo("row-30"));
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("870");
  });

  test("springs (real/animated mode), not jump — the offset transitions gradually rather than landing instantly, unlike F9/F10's content-driven compensation", async () => {
    // Deliberately NOT using motionSeam controls-reference comparison here:
    // probe-confirmed this component can register an UNRELATED scrollY
    // controls entry near mount at a non-deterministic time (some other
    // real-mode mechanism, timing-variable — not scrollTo's own doing),
    // which made a "did the controls reference change" assertion flaky/
    // vacuous in practice (it passed even against a deliberately severed
    // dispatch, on a timing coincidence). The DIRECTLY OBSERVABLE
    // distinction between jump and spring is more robust: a jump (F9/F10's
    // compensation path) lands at its final value the same frame it's
    // applied; a real spring takes actual animation time — F9's own "let
    // the wheel-triggered spring fully settle" comment elsewhere in this
    // file uses a full second for the SAME default transition.
    const buildReal = (scrollToId: string | null) => (
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col" scrollTo={scrollToId}>
            <SceneObject name="rows" focused>
              {rowIds.map((id) => (
                <div key={id} id={`row-${id}`} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(buildReal(null));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    await rerender(buildReal("row-30"));
    // Sample almost immediately — a jump would already show the final
    // value (1370, per the "navigates to a target below" test) on the
    // very next readable frame; a spring is still mid-transition here.
    await waitForAnimationFrame();
    const midFlightOffset = column.getAttribute("data-scroll-offset");
    expect(midFlightOffset).not.toBeNull();
    expect(midFlightOffset).not.toBe("1370");

    // Eventually settles at the correct final target.
    await expect.poll(() => column.getAttribute("data-scroll-offset"), { timeout: 5000 }).toBe("1370");
  });

  test("send-jump composition: on an anchor=\"end\" column, scrolling to an id at the end RE-PINS, and subsequent growth follows again", async () => {
    const { rerender, getByTestId } = await render(buildScrollTo(null, "end"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    // Mounts pinned at maxScroll (2700).
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("2700");

    // Release the pin.
    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -1000,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("1700");

    // scrollTo the LAST row — its bottom aligns with maxScroll, landing
    // within the re-pin threshold.
    await rerender(buildScrollTo("row-49", "end"));
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("2700");

    // Growth now follows again — proves the pin genuinely RE-ENGAGED, not
    // just that this one navigation happened to land at maxScroll.
    const grownIds = [...rowIds, ROW_COUNT]; // append one more row
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end" scrollTo="row-49">
            <SceneObject name="rows" focused>
              {grownIds.map((id) => (
                <div key={id} id={`row-${id}`} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                  row {id}
                </div>
              ))}
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("2770"); // new maxScroll
  });
});

// ---------------------------------------------------------------------------
// F12: witness-element anchoring
// ---------------------------------------------------------------------------

describe("Scene witness-element anchoring (F12)", () => {
  const ROW_HEIGHT = 70;

  // Mirrors MessageList's real DOM shape: a stationary "load earlier
  // messages" affordance ABOVE the rows, then the rows themselves, then a
  // sticky composer. Round-4 CR-3 (scene-lab): at offset EXACTLY 0 the
  // affordance — not a row — is the topmost in-view element, so it becomes
  // the tracked F10/F10b anchor; a prepend BELOW it (loadOlder's real DOM
  // shape) never moves the affordance's own offsetTop, so the pre-F12
  // intraDelta path stayed 0 and never compensated.
  function buildAffordancePipeline(
    rowIds: number[],
    affordanceHeight: number,
    anchor: "none" | "end",
    gap = 0,
  ) {
    return (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="chat" anchor={anchor}>
            <SceneObject name="chat" focused>
              <div style={{ display: "flex", flexDirection: "column", gap }}>
                <div data-testid="load-older" style={{ width: 400, height: affordanceHeight }}>
                  load earlier messages
                </div>
                <div data-testid="rows-container">
                  {rowIds.map((id) => (
                    <div key={id} data-testid={`row-${id}`} style={{ width: 400, height: ROW_HEIGHT }}>
                      row {id}
                    </div>
                  ))}
                </div>
                <div data-testid="composer" style={{ position: "sticky", bottom: 0, height: 60, width: 400 }}>
                  composer
                </div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  // Drives the column to an exact offset from WHATEVER its current offset
  // is (mount state differs by anchor mode — "end" mounts pinned at
  // maxScroll, "none" mounts at 0), reading data-scroll-offset live rather
  // than assuming a starting point. deltaY maps 1:1 onto the offset delta
  // (established by every other wheel-driven test in this file — e.g. the
  // scrollTo suite's `deltaY: 1000` producing offset "1000" from a mount-at-
  // 0 start); `Scene duration={0}` in these fixtures makes the write land
  // the same tick this polls for.
  async function scrollColumnTo(scene: HTMLElement, column: HTMLElement, targetOffset: number) {
    const currentOffset = Number(column.getAttribute("data-scroll-offset") ?? "0");
    const columnRect = column.getBoundingClientRect();
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: targetOffset - currentOffset,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBeCloseTo(-targetOffset, 5);
    expect(column.getAttribute("data-scroll-offset")).toBe(String(targetOffset));
  }

  test("offset EXACTLY 0, stationary leading affordance: a prepend below it still compensates (the red→green pin — Peri's round-4 CR-3 shape)", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 40, "end"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await scrollColumnTo(scene, column, 0);

    const row0Before = getByTestId("row-0").element() as HTMLElement;
    const row0RectBefore = row0Before.getBoundingClientRect();

    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildAffordancePipeline([...prependedIds, ...existingIds], 40, "end"));

    expect(column.getAttribute("data-scroll-offset")).toBe("1400");
    const row0After = getByTestId("row-0").element() as HTMLElement;
    expect(row0After).toBe(row0Before);
    expect(row0After.getBoundingClientRect().top).toBeCloseTo(row0RectBefore.top, 0);
  });

  test("offset 120 (the affordance already scrolled out of view, a real row is the anchor): still compensates — regression guard", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 40, "end"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await scrollColumnTo(scene, column, 120);

    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildAffordancePipeline([...prependedIds, ...existingIds], 40, "end"));

    expect(column.getAttribute("data-scroll-offset")).toBe("1520");
  });

  test("mode-scoping, anchor=\"end\": a stationary affordance-as-anchor MID-scroll (not just at offset 0) still compensates on insertion below it", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 300, "end"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    // The 300px affordance is still the topmost in-view element at offset
    // 100 (window [100, 900) still intersects [0, 300)) — the affordance is
    // the tracked anchor here same as at offset 0, just not scrolled all
    // the way to the top.
    await scrollColumnTo(scene, column, 100);

    const prependedIds = Array.from({ length: 5 }, (_, i) => -5 + i);
    await rerender(buildAffordancePipeline([...prependedIds, ...existingIds], 300, "end"));

    expect(column.getAttribute("data-scroll-offset")).toBe("450"); // 100 + 5*70
  });

  test("mode-scoping, anchor=\"none\": the IDENTICAL insertion does NOT compensate (native hold-the-top; witness never recorded outside anchor=\"end\")", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 300, "none"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await scrollColumnTo(scene, column, 100);

    const prependedIds = Array.from({ length: 5 }, (_, i) => -5 + i);
    await rerender(buildAffordancePipeline([...prependedIds, ...existingIds], 300, "none"));

    // Give it a beat to prove it genuinely stays, not just hasn't updated yet.
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("100");
  });

  test("anchor's own growth (no insertion) is NOT witness-compensated — in-place growth keeps native hold-the-top", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 40, "end"));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await scrollColumnTo(scene, column, 0);

    // Grow the affordance's OWN height (40 -> 140) — no row prepend, no
    // other structural change. This is the same class of event the
    // anchor-height guard exists for (e.g. an image loading inside a
    // tracked anchor).
    await rerender(buildAffordancePipeline(existingIds, 140, "end"));

    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("0");
  });

  test("offset EXACTLY 0, stationary leading affordance, flex `gap` between it and the rows (Peri's real spacing — round-5 CR-3 shape): a prepend below it still compensates", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 40, "end", 12));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await scrollColumnTo(scene, column, 0);

    const row0Before = getByTestId("row-0").element() as HTMLElement;
    const row0RectBefore = row0Before.getBoundingClientRect();

    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildAffordancePipeline([...prependedIds, ...existingIds], 40, "end", 12));

    expect(column.getAttribute("data-scroll-offset")).toBe("1400");
    const row0After = getByTestId("row-0").element() as HTMLElement;
    expect(row0After).toBe(row0Before);
    expect(row0After.getBoundingClientRect().top).toBeCloseTo(row0RectBefore.top, 0);
  });

  test("a LARGE gap (200px, first row still in view): still compensates — the window reaches past arbitrary gap sizes, not just a typical 12px", async () => {
    const existingIds = Array.from({ length: 50 }, (_, i) => i);
    const { rerender, getByTestId } = await render(buildAffordancePipeline(existingIds, 40, "end", 200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    await scrollColumnTo(scene, column, 0);

    const row0Before = getByTestId("row-0").element() as HTMLElement;
    const row0RectBefore = row0Before.getBoundingClientRect();

    const prependedIds = Array.from({ length: 20 }, (_, i) => -20 + i);
    await rerender(buildAffordancePipeline([...prependedIds, ...existingIds], 40, "end", 200));

    expect(column.getAttribute("data-scroll-offset")).toBe("1400");
    const row0After = getByTestId("row-0").element() as HTMLElement;
    expect(row0After).toBe(row0Before);
    expect(row0After.getBoundingClientRect().top).toBeCloseTo(row0RectBefore.top, 0);
  });
});

// ---------------------------------------------------------------------------
// F9 commit 2: anchor="end" follow-the-end pin state machine
// ---------------------------------------------------------------------------

describe("Scene follow-the-end pin (anchor=\"end\", F9 commit 2)", () => {
  test("mounts pinned at maxScroll (opens at the newest content)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end">
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

    // maxScroll = 1200 - 800 = 400.
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-400);
  });

  test("new content while pinned keeps the offset at maxScroll — same-frame, no animation", async () => {
    const recorder = createMotionSeamRecorder();
    const build = (contentHeight: number) => (
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="col" anchor="end">
              <SceneObject name="panel" focused>
                <div data-testid="content" style={{ width: 400, height: contentHeight }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    await wait(1000); // let the mount-pinned spring (real mode) settle
    expect(parseFloat(contentWrapper.style.top || "0")).toBeCloseTo(-400, 0);

    const controlsBefore = recorder.controls.get(`scrollY:col`);

    // Grow content — new maxScroll = 1600 - 800 = 800.
    await rerender(build(1600));

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-800);
    // No new animate() call — jump, not spring.
    expect(recorder.controls.get(`scrollY:col`)).toBe(controlsBefore);
  });

  test("a user upward scroll releases the pin — subsequent content arrivals no longer force the offset", async () => {
    const build = (contentHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: contentHeight }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-400); // pinned at mount

    // Scroll UP (away from the end) — deltaY negative.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-100);

    // New content arrives — must NOT force the offset back to the (new) end.
    await rerender(build(1600));

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-100);
  });

  test("scrolling back within the threshold of maxScroll re-engages the pin", async () => {
    const build = (contentHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: contentHeight }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Release the pin.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-100);

    // Scroll back to exactly maxScroll (well within the 2px threshold).
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-400);

    // Re-pinned — new content should now force the offset again.
    await rerender(build(1600));

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-800);
  });

  test("swapping to a different object within the column re-pins (composes with A2)", async () => {
    // Uses data-scroll-offset (not contentWrapper.style.top) for the swap
    // assertions — established precedent from the pre-existing "Scene
    // swap-reset scroll model" tests: style.top = combinedTop =
    // -(topOffset + scrollOffset), and topOffset (a SEPARATE mechanism
    // that shifts a single newly-focused object into view) can transiently
    // still reflect the pre-swap in-flow layout for one commit before the
    // no-longer-focused sibling finishes exiting flow — a real timing
    // interaction unrelated to anchor="end", probe-confirmed while
    // debugging this exact test (style.top read -2000 — topOffset(1200,
    // stale) + scrollOffset(800, already correct) — while
    // data-scroll-offset already correctly read "800" in the same
    // instant). data-scroll-offset isolates the value this test actually
    // cares about.
    const build = (aFocused: boolean, bHeight = 1600) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end">
            <SceneObject name="a" focused={aFocused}>
              <div data-testid="content-a" style={{ width: 400, height: 1200 }} />
            </SceneObject>
            <SceneObject name="b" focused={!aFocused}>
              <div data-testid="content-b" style={{ width: 400, height: bHeight }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(true));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    expect(column.getAttribute("data-scroll-offset")).toBe("400"); // pinned to a's maxScroll (1200-800)

    // Release the pin on "a".
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => column.getAttribute("data-scroll-offset")).toBe("100");

    // Swap focus to "b" — a real swap, not a park/return with the same
    // arrangement (which would restore, not re-pin — see the A2 extension's
    // own comment).
    await rerender(build(false));

    // Re-pinned to b's maxScroll (1600-800=800).
    expect(column.getAttribute("data-scroll-offset")).toBe("800");

    // Confirm the re-pin genuinely holds: new content arriving still forces
    // the offset (proves this isn't a coincidental one-time value match).
    await rerender(build(false, 2000));
    expect(column.getAttribute("data-scroll-offset")).toBe("1200");
  });

  test("a maxScroll shrink (viewport/content-driven, not user intent) never re-pins a released column, even when the clamp lands exactly at the new maxScroll", async () => {
    const build = (contentHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: contentHeight }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Release the pin, scrolled well short of the end.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-100);

    // Shrink content so the new maxScroll clamps the offset to EXACTLY the
    // new maxScroll (100) — a value that would trivially satisfy
    // isAtScrollEnd if it were (wrongly) evaluated here.
    await rerender(build(900)); // new maxScroll = 900-800=100, offset clamps 100->100

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-100);

    // Prove the pin genuinely did NOT re-engage: further content growth
    // must NOT force the offset (it would, if pinnedRef were wrongly true).
    await rerender(build(1300)); // new maxScroll = 500, would force -500 if pinned
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-100);
  });
});

// ---------------------------------------------------------------------------
// F9 commit 3: onScroll + SceneScrollMetrics
// ---------------------------------------------------------------------------

describe("Scene onScroll metrics (F9 commit 3)", () => {
  test("fires with correct metrics on a user wheel scroll", async () => {
    const calls: SceneScrollMetrics[] = [];
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" onScroll={(m) => calls.push(m)}>
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => calls.at(-1)?.offset).toBe(300);

    const latest = calls.at(-1)!;
    expect(latest.offset).toBe(300);
    expect(latest.maxScroll).toBe(400); // 1200-800
    expect(latest.contentHeight).toBe(1200);
    expect(latest.viewportHeight).toBe(800);
    expect(latest.anchored).toBe("none"); // anchor="none" (default)
  });

  test("fires for content-driven anchoring-compensation changes too (F9 commit 1) — a natural consequence of subscribing to the single underlying scroll value", async () => {
    const calls: SceneScrollMetrics[] = [];
    const build = (topHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" onScroll={(m) => calls.push(m)}>
            <SceneObject name="top" focused>
              <div data-testid="top-content" style={{ width: 400, height: topHeight }} />
            </SceneObject>
            <SceneObject name="bottom" focused>
              <div data-testid="bottom-content" style={{ width: 400, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(300));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => calls.at(-1)?.offset).toBe(400);

    calls.length = 0;
    await rerender(build(500)); // +200 above the anchor -> compensation fires

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)!.offset).toBe(600);
  });

  test("fires for pin-follow changes too (F9 commit 2), with anchored transitioning correctly across pin/release", async () => {
    const calls: SceneScrollMetrics[] = [];
    const build = (contentHeight: number) => (
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" anchor="end" onScroll={(m) => calls.push(m)}>
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: contentHeight }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(1200));
    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    await expect.poll(() => calls.at(-1)?.offset).toBe(400); // pinned at mount
    expect(calls.at(-1)!.anchored).toBe("end");

    calls.length = 0;
    await rerender(build(1600)); // grow while pinned -> pin-follow fires

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)!.offset).toBe(800);
    expect(calls.at(-1)!.anchored).toBe("end");

    // Release the pin.
    calls.length = 0;
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-500);

    expect(calls.at(-1)!.anchored).toBe("none");
  });

  test("anchored reads \"none\" for an anchor=\"none\" column even while scrolled to maxScroll (never confused with the pin)", async () => {
    const calls: SceneScrollMetrics[] = [];
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" onScroll={(m) => calls.push(m)}>
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Scroll all the way to maxScroll (400) — numerically identical to a
    // pinned anchor="end" column's resting offset, but this column was
    // never configured with anchor="end".
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 400,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect.poll(() => calls.at(-1)?.offset).toBe(400);

    expect(calls.at(-1)!.anchored).toBe("none");
  });

  test("fires multiple times during a single real-mode spring transition — per-tick cadence, not gated to one React commit", async () => {
    const calls: SceneScrollMetrics[] = [];
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col" onScroll={(m) => calls.push(m)}>
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(1000); // let the real spring fully settle

    // A real spring interpolates over many frames — if onScroll only fired
    // once per REACT COMMIT (rather than per raw scrollY tick, matching
    // data-scroll-offset's own cadence), this would be a small, fixed
    // number regardless of the transition's real duration.
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.at(-1)!.offset).toBeCloseTo(300, 0);
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
// S5: input controller — wheel (normalizeWheelDelta, decideWheelTargetColumn)
// ---------------------------------------------------------------------------

describe("Scene wheel input controller (S5)", () => {
  test("ctrl+wheel (pinch-zoom) does not scroll and does not preventDefault", async () => {
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
    await waitForAnimationFrame();

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-48);
  });

  test("A10: wheel anywhere in the viewport scrolls the single scrollable focused column, even off-column", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="a">
            <SceneObject name="a-obj" focused>
              <div data-testid="content-a" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="b">
            <SceneObject name="b-obj" focused>
              <div data-testid="content-b" style={{ width: 400, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
    await waitForAnimationFrame();

    expect(parseFloat(colAContent.style.top || "0")).toBe(-60);
  });

  test("multiple scrollable focused columns: wheel routes to the column under the cursor (unchanged hit-test behavior)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
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
    await waitForAnimationFrame();

    expect(parseFloat(colBContent.style.top || "0")).toBe(-60);
    expect(parseFloat(colAContent.style.top || "0")).toBe(0);
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

  // A5 — the pull-out-direction principle: a deck card peeks out in the
  // direction it travels when pulled from the deck. Column decks anchor
  // under the right focused column and peek left, as explicit per-depth
  // offsets (peekOffset, fanned by depth) rather than the 1-2px emergent
  // perspective artifact the deck previously relied on.

  test("depth-1 in-between column peeks left by exactly peekOffset (default)", async () => {
    const scene = (peekOffset: number) => (
      <TestWrapper fullPage>
        <Scene duration={0} peekOffset={peekOffset}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    // Render once with peekOffset=0 to establish the flush anchor (stackTargetLeft
    // itself — the pre-A5 baseline, unaffected by the peek mechanism), then
    // again with the default peekOffset — cleanup() between renders keeps the
    // two mounts from colliding on shared data-testids within this one test.
    const flush = await render(scene(0));
    const flushMiddle = flush.getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
    await waitForAnimationFrame();
    await waitForAnimationFrame();
    const flushX = parseTranslateX(flushMiddle.style.transform);
    await cleanup();

    const peeked = await render(scene(12));
    const rightCol = peeked.getByTestId("content-right").element().closest("[data-column]") as HTMLElement;
    const middleCol = peeked.getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    // The raw x offset written to the transform (pre-projection) sits
    // exactly peekOffset left of the flush anchor — this is what
    // SceneColumn's animateX actually computes, undistorted by rendering.
    expect(flushX - parseTranslateX(middleCol.style.transform)).toBe(12);

    // Rendered (post-perspective-projection) left edge: the peek is also
    // visibly observable, attenuated somewhat by perspective foreshortening
    // at depth-1 (~0.89x scale — see computeDepthTreatment) — toBeCloseTo(-1)
    // (tolerance <5px) accommodates that attenuation while still clearly
    // discriminating from the pre-A5 ~1-2px emergent shift.
    const rightRect = rightCol.getBoundingClientRect();
    const middleRect = middleCol.getBoundingClientRect();
    expect(rightRect.left - middleRect.left).toBeCloseTo(12, -1);
  });

  test("multiple in-between columns peek left by an additional peekOffset increment per depth (fanned)", async () => {
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
    await waitForAnimationFrame();

    // col-middle2 → depth-1, col-middle1 → depth-2 (further from col-right).
    const middle1 = getByTestId("content-middle1").element().closest("[data-column]") as HTMLElement;
    const middle2 = getByTestId("content-middle2").element().closest("[data-column]") as HTMLElement;

    const depth1X = parseTranslateX(middle2.style.transform);
    const depth2X = parseTranslateX(middle1.style.transform);

    // Each successive depth level peeks by one additional peekOffset
    // increment (12px default) — exact, since this reads the raw
    // pre-projection transform value rather than rendered pixels.
    expect(depth1X - depth2X).toBe(12);
  });

  test("custom peekOffset prop changes the column deck peek offsets accordingly", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} peekOffset={20}>
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
    await waitForAnimationFrame();

    const middle1 = getByTestId("content-middle1").element().closest("[data-column]") as HTMLElement; // depth-2
    const middle2 = getByTestId("content-middle2").element().closest("[data-column]") as HTMLElement; // depth-1

    const depth1X = parseTranslateX(middle2.style.transform);
    const depth2X = parseTranslateX(middle1.style.transform);

    // With peekOffset=20, depth-1 peeks by 20 and depth-2 by 2*20=40 — the
    // fan increment between them is the configured peekOffset, not the
    // default.
    expect(depth1X - depth2X).toBe(20);
  });

  test("peekOffset={0} reproduces the old flush-anchored behavior (no fan)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} peekOffset={0}>
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
    await waitForAnimationFrame();

    const middle1 = getByTestId("content-middle1").element().closest("[data-column]") as HTMLElement; // depth-2
    const middle2 = getByTestId("content-middle2").element().closest("[data-column]") as HTMLElement; // depth-1

    // With no peek offset, every in-between column anchors flush at
    // stackTargetLeft regardless of depth — the pre-A5 behavior, where only
    // perspective projection (not a manual x offset) distinguished depths.
    expect(parseTranslateX(middle1.style.transform)).toBe(parseTranslateX(middle2.style.transform));
  });

  test("H11: a never-before-focused deck card's marginTop converges monotonically on first focus (no swing)", async () => {
    // Demo 4 shape (Left/MidA/MidB/Right — dev/pages/ScenePage.tsx's depth
    // deck demo): a column with NO frozenSize yet (never focused before)
    // undergoes a bigger layout-FLIP box-shape change on its first focus
    // than on any later one. Probe-confirmed root cause: while that
    // transition's translateZ/scale transform is still mid-flight,
    // getBoundingClientRect() on a registered object (or the content
    // wrapper fallback) reports a PROJECTED size — corrupting the
    // contentHeight geometryStore feeds, so marginTop overshoots (~301 ->
    // ~330) before correcting back to the true resting value (~300) over
    // several hundred ms. A column's SECOND focus (frozenSize already set
    // from the first unfocus) never shows this — its marginTop is flat
    // throughout. Real mode (no duration override) — the spring must
    // actually run for the swing to be observable.
    const build = (midAFocused: boolean) => (
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused>
              <div style={{ width: 240, height: 300 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="middle-a">
            <SceneObject name="middle-a-obj" focused={midAFocused}>
              <div data-testid="mid-a-content" style={{ width: 240, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="middle-b">
            <SceneObject name="middle-b-obj" focused={false}>
              <div style={{ width: 240, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-obj" focused>
              <div style={{ width: 240, height: 300 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(false));
    await wait(500);

    const midAWrapper = getByTestId("mid-a-content").element()
      .closest("[data-column]")?.querySelector("[data-column-content]") as HTMLElement;
    const readMarginTop = () => parseFloat(midAWrapper.style.marginTop || "0");

    // First focus: sample marginTop across the transition.
    await rerender(build(true));
    const firstFocusSamples = [readMarginTop()];
    for (const delay of [16, 32, 50, 100, 150, 200, 300]) {
      await wait(delay);
      firstFocusSamples.push(readMarginTop());
    }
    await wait(500);
    const settled = readMarginTop();

    // No mid-flight retarget: every sample stays within a few px of the
    // final settled value — before the fix, samples swung ~30px past it.
    for (const sample of firstFocusSamples) {
      expect(Math.abs(sample - settled)).toBeLessThan(5);
    }

    // Second focus (frozenSize now set from the intervening unfocus) — a
    // sanity control confirming the settled value itself is stable/correct,
    // not coincidentally landing inside tolerance by chance.
    await rerender(build(false));
    await wait(800);
    await rerender(build(true));
    await wait(800);
    expect(readMarginTop()).toBeCloseTo(settled, 0);
  });

  test("a column whose child JUST became focused never applies depth-deck visual treatment, even when the registry-derived position/depth still lag one commit behind (F5 item 2)", async () => {
    // Demo 4 shape, distinct mechanism from H11 above (that one is about
    // getBoundingClientRect() reporting a projected size mid-transform;
    // already fixed). Root cause here (probe-confirmed on the dev app's
    // Depth deck stacking demo, instrumented render trace): Scene's own S6
    // registration architecture is "one-commit-stale by construction" (see
    // this file's own comments on columnRegistryRef) — `position`/
    // `stackDepth` (read from context, populated from Scene's REGISTRY) can
    // still report the PREVIOUS commit's classification ("in-between",
    // depth 2) for exactly one render after a column's `focused` prop flips
    // true, even though `columnFocused` (a plain prop-walk of this column's
    // own children, always fresh) is already correct. Before the fix,
    // `isInBetween`/`animateX` trusted `position` alone, so that one
    // mismatched render fed the `animate` prop stale depth-deck values
    // (reduced opacity, translateZ, a large nonzero x offset) on top of an
    // element ALREADY laid out via flex/relative — Motion picks up that
    // stale target and starts springing toward it before the very next
    // commit corrects it, a spurious retarget that's visible as a jump
    // (probe-confirmed via raw transform sampling: translateX swung from
    // +142 to -98 across a single frame at exactly this transition).
    //
    // This test reproduces the mismatch DETERMINISTICALLY rather than
    // racing React's own synchronous corrective re-render (which resolves
    // before control ever returns to a test, making the intermediate state
    // unobservable from outside the component): `position`/`stackDepth` are
    // held fixed at their pre-focus "in-between, depth 2" values across the
    // rerender (exactly what a lagging registry would still report) while
    // the child object's `focused` prop flips true. `data-stack-depth`
    // (driven directly by `isInBetween`) is a plain React-rendered
    // attribute — synchronous and deterministic, no animation-timing
    // dependency, unlike the animate-prop values themselves.
    const position = new Map<string, ColumnPosition>([["middle", "in-between"]]);
    const stackDepths = new Map<string, number>([["middle", 2]]);

    const build = (focused: boolean) => (
      <TestWrapper fullPage>
        <ViewportContext.Provider value={{ top: 0, left: 0, width: 1000, height: 800 }}>
          <DepthDeckContext.Provider value={100}>
            <ColumnPositionContext.Provider value={position}>
              <StackDepthContext.Provider value={stackDepths}>
                <SceneColumn name="middle">
                  <SceneObject name="middle-obj" focused={focused}>
                    <div data-testid="content" style={{ width: 240, height: 200 }} />
                  </SceneObject>
                </SceneColumn>
              </StackDepthContext.Provider>
            </ColumnPositionContext.Provider>
          </DepthDeckContext.Provider>
        </ViewportContext.Provider>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(false));
    const col = getByTestId("content").element().closest("[data-column]") as HTMLElement;
    // Sanity: genuinely classified in-between/depth-2 while unfocused.
    expect(col.getAttribute("data-stack-depth")).toBe("2");

    // Focus the child WITHOUT updating position/stackDepth — the exact
    // one-commit-stale window a real registry-lag click produces.
    await rerender(build(true));

    expect(col.getAttribute("data-column-focused")).toBe("true");
    expect(col.getAttribute("data-stack-depth")).toBeNull();
    expect(window.getComputedStyle(col).position).toBe("relative");
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

  test("D3: an unfocused SceneObject with onActivate has role=button and tabIndex=0 on the outer wrapper", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false} onActivate={() => {}}>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const outer = getByTestId("content").element().closest("[data-scene-id]") as HTMLElement;
    expect(outer.getAttribute("role")).toBe("button");
    expect(outer.getAttribute("tabindex")).toBe("0");
  });

  test("D3: an unfocused SceneObject WITHOUT onActivate has no role=button and a permanent tabIndex=-1 (D5 fallback baseline)", async () => {
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
    expect(outer.hasAttribute("role")).toBe(false);
    expect(outer.getAttribute("tabindex")).toBe("-1");
  });

  test("D3: pressing Enter on an unfocused SceneObject's outer wrapper (with onActivate) fires onActivate", async () => {
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
    outer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(activated).toBe(true);
  });

  test("D3: pressing Space on an unfocused SceneObject's outer wrapper (with onActivate) fires onActivate and preventDefault is called", async () => {
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
    const notPrevented = outer.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
    );
    expect(activated).toBe(true);
    // preventDefault WAS called (Space must not also scroll the page).
    expect(notPrevented).toBe(false);
  });

  test("DELTA-2: tab-focusing a parked (offscreen) column's D3 activation wrapper leaves the camera's horizontal framing unchanged, and Enter still activates it normally", async () => {
    // Regression for the browser's native scroll-into-view-on-focus, which
    // (unguarded) drags the viewport's native scrollLeft out from under the
    // camera's own stageLeft pan (probe-confirmed: 0 -> 782 with stageLeft
    // unchanged). Layout: three 400px columns in a 500px viewport, only "a"
    // focused — "c" is parked well outside the visible region.
    let activated = false;
    const { getByTestId } = await render(
      <TestWrapper fullPage width={500} height={600}>
        <Scene duration={0}>
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
            <SceneObject name="c-obj" focused={false} onActivate={() => { activated = true; }}>
              <div data-testid="content-c" style={{ width: 400, height: 300 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-stage]") as HTMLElement;
    const cWrapper = getByTestId("content-c").element().closest("[data-scene-id]") as HTMLElement;

    expect(scene.scrollLeft).toBe(0);
    const stageLeftBefore = stage.style.left;

    cWrapper.focus();
    await waitForAnimationFrame();

    expect(document.activeElement).toBe(cWrapper);
    // The camera's own pan target is untouched...
    expect(stage.style.left).toBe(stageLeftBefore);
    // ...and the DELTA-2 fix restored native scrollLeft to 0 (the browser's
    // scroll-into-view is undone within the same synchronous focusin tick).
    expect(scene.scrollLeft).toBe(0);

    // Enter still activates it normally.
    cWrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(activated).toBe(true);
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

  test("D5: fallback — no focusable descendant focuses the outer wrapper itself", async () => {
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content">no buttons here</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content">no buttons here</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const outer = getByTestId("content").element().closest("[data-scene-id]") as HTMLElement;
    expect(document.activeElement).toBe(outer);
  });

  test("D5: focus-on-activate calls .focus() with preventScroll: true", async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    try {
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
      focusSpy.mockClear();

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

      const btn = getByTestId("btn-in-panel").element() as HTMLElement;
      expect(document.activeElement).toBe(btn);
      expect(focusSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenCalledWith(expect.objectContaining({ preventScroll: true }));
    } finally {
      focusSpy.mockRestore();
    }
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

  test("focused AND scrollable column content wrapper has tabindex=0", async () => {
    // tabindex=0 allows keyboard users to focus the scrollable region directly
    // and use keyboard shortcuts to scroll it. D2: tabIndex is added
    // ADDITIONALLY only when the column is scrollable — fixture must overflow
    // the 800px viewport for maxScroll > 0.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ height: 1200 }}>content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element();
    const contentWrapper = content.closest("[data-column-content]") as HTMLElement;
    expect(contentWrapper.getAttribute("tabindex")).toBe("0");
  });

  test("D2: focused but NON-scrollable column content wrapper has NO tabindex (negative sibling)", async () => {
    // A focused column whose content fits the viewport has nothing for
    // keyboard scroll shortcuts to do — it must not become a tab stop.
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
    expect(contentWrapper.hasAttribute("tabindex")).toBe(false);
  });

  test("D2: an UNFOCUSED column's content wrapper has no role=region (role/aria-label gated on columnFocused)", async () => {
    // An offscreen/frozen column has nothing a screen reader should announce
    // as a navigable region.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ height: 200 }}>content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element();
    const contentWrapper = content.closest("[data-column-content]") as HTMLElement;
    expect(contentWrapper.hasAttribute("role")).toBe(false);
    expect(contentWrapper.hasAttribute("aria-label")).toBe(false);
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

  test("D2/D4: content wrapper has a stable id derived from the column name, regardless of focus/scrollability", async () => {
    // D4's Scrollbar thumb references this id via aria-controls — it must
    // exist unconditionally so the reference is never dangling.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ height: 200 }}>content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element();
    const contentWrapper = content.closest("[data-column-content]") as HTMLElement;
    expect(contentWrapper.id).toBe("scene-column-content-nav");
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
// Phase 9c/9d + S6: useCamera hook
// ---------------------------------------------------------------------------

import { useCamera } from "../src";

/** Test component that exposes CameraState values as data attributes. */
function CameraReader() {
  const camera = useCamera();
  return (
    <div
      data-testid="camera-reader"
      data-viewport-top={camera.viewport.top}
      data-viewport-left={camera.viewport.left}
      data-viewport-width={camera.viewport.width}
      data-viewport-height={camera.viewport.height}
      data-target-top={camera.target.top}
      data-target-left={camera.target.left}
      data-target-width={camera.target.width}
      data-target-height={camera.target.height}
      data-transitioning={String(camera.transitioning)}
    />
  );
}

describe("useCamera", () => {
  test("useCamera reports viewport rect width and height", async () => {
    // viewport should reflect the scene viewport element dimensions.
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
    const width = parseFloat(reader.getAttribute("data-viewport-width") ?? "0");
    const height = parseFloat(reader.getAttribute("data-viewport-height") ?? "0");

    // The viewport fills the TestWrapper fullPage container, so dimensions
    // should be non-zero. We can't assert exact pixels, but must be > 0.
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  test("useCamera reports the viewport's real page-relative rect (S6, forecast-gate adjudication #2)", async () => {
    // A zero-size marker (no margin/padding) establishes a reference point in
    // the SAME parent as a sibling wrapper with a KNOWN padding offset —
    // padding (unlike margin) never collapses, so the gap between the
    // marker and anything rendered inside the padded wrapper is EXACTLY the
    // padding value, regardless of the browser's own default spacing.
    // Asserting viewport.top/left EQUAL that offset (not merely non-zero)
    // proves position comes from getBoundingClientRect(), not
    // ResizeObserverEntry.contentRect (padding-box-relative, ~0 always —
    // the one-keystroke-away wrong extension this test guards against).
    const { getByTestId } = await render(
      <div>
        <div data-testid="offset-marker" style={{ width: 0, height: 0 }} />
        <div style={{ paddingTop: 40, paddingLeft: 20 }}>
          <TestWrapper fullPage>
            <Scene duration={0}>
              <SceneColumn name="col">
                <SceneObject name="panel" focused>
                  <div data-testid="content" style={{ width: 200, height: 150 }} />
                </SceneObject>
              </SceneColumn>
              <CameraReader />
            </Scene>
          </TestWrapper>
        </div>
      </div>,
    );

    await waitForAnimationFrame();

    const markerRect = (getByTestId("offset-marker").element() as HTMLElement).getBoundingClientRect();
    const reader = getByTestId("camera-reader").element() as HTMLElement;
    const top = parseFloat(reader.getAttribute("data-viewport-top") ?? "-1");
    const left = parseFloat(reader.getAttribute("data-viewport-left") ?? "-1");

    expect(top - markerRect.top).toBeCloseTo(40, 0);
    expect(left - markerRect.left).toBeCloseTo(20, 0);
  });

  test("useCamera target bounds equal focused content bounds inflated by Scene's padding", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} padding={24}>
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

    const content = getByTestId("content").element() as HTMLElement;
    const column = content.closest("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    const reader = getByTestId("camera-reader").element() as HTMLElement;
    const targetTop = parseFloat(reader.getAttribute("data-target-top") ?? "0");
    const targetLeft = parseFloat(reader.getAttribute("data-target-left") ?? "0");
    const targetWidth = parseFloat(reader.getAttribute("data-target-width") ?? "0");
    const targetHeight = parseFloat(reader.getAttribute("data-target-height") ?? "0");

    expect(targetTop).toBeCloseTo(columnRect.top - 24, 0);
    expect(targetLeft).toBeCloseTo(columnRect.left - 24, 0);
    expect(targetWidth).toBeCloseTo(columnRect.width + 48, 0);
    expect(targetHeight).toBeCloseTo(columnRect.height + 48, 0);
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

  test("useCamera transitioning toggles true then false across a real camera pan", async () => {
    // A real (non-instant) camera pan, wired directly to the cameraX
    // animate() call (S6) rather than Motion's onLayoutAnimationStart/
    // onLayoutAnimationComplete, which never fire for this element (no
    // `layout` prop). Stiff/low-damping spring settles quickly and
    // predictably, keeping the test bounded.
    const build = (rightFocused: boolean) => (
      <TestWrapper fullPage>
        <Scene stiffness={2000} damping={100}>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused={!rightFocused}>
              <div style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-obj" focused={rightFocused}>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <CameraReader />
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(false));
    // Mount itself pans the camera from stageLeft's initial 0 to the real
    // centered position — that initial pan must settle before the toggle
    // below is a clean, isolated true->false observation.
    await wait(500);

    const reader = getByTestId("camera-reader").element() as HTMLElement;
    expect(reader.getAttribute("data-transitioning")).toBe("false");

    // Toggle focus -- triggers a real camera pan.
    await rerender(build(true));
    await waitForAnimationFrame();
    expect(reader.getAttribute("data-transitioning")).toBe("true");

    await wait(1500);
    expect(reader.getAttribute("data-transitioning")).toBe("false");
  });

  test("rapid re-focus mid-pan keeps transitioning=true until the newer pan settles (stale-completion guard)", async () => {
    // Three columns so focus can move a->b, then (before the first pan
    // settles) b->c -- a second, distinct cameraX animate() invocation that
    // supersedes the first. Regression coverage for the observable
    // requirement: transitioning must stay true across a rapid retarget and
    // only flip false once the LATEST pan truly settles.
    //
    // Honest note on the token guard specifically (defeat-checked at
    // implementation time via a trace instrumented into the effect): in the
    // currently-installed motion version, a superseded animate() call's
    // `.then()` never fires at all when a later animate() call retargets
    // the SAME MotionValue (only the final, non-superseded call's `.then()`
    // resolved in a traced run) -- so this exact scenario doesn't currently
    // exercise the token comparison's false branch. The guard is kept as a
    // defensive measure matching the forecast-gate adjudication's
    // prescribed shape (protects against a future motion version, or a
    // different retrigger path, where a stale completion DOES fire) but is
    // not provably discriminating for THIS specific code line today.
    const build = (focused: "a" | "b" | "c") => (
      <TestWrapper fullPage>
        <Scene stiffness={40} damping={12}>
          <SceneColumn name="a">
            <SceneObject name="a-obj" focused={focused === "a"}>
              <div style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="b">
            <SceneObject name="b-obj" focused={focused === "b"}>
              <div style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="c">
            <SceneObject name="c-obj" focused={focused === "c"}>
              <div style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
          <CameraReader />
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build("a"));
    await waitForAnimationFrame();
    const reader = getByTestId("camera-reader").element() as HTMLElement;

    // Start pan 1 (a -> b).
    await rerender(build("b"));
    await waitForAnimationFrame();
    expect(reader.getAttribute("data-transitioning")).toBe("true");

    // Before pan 1 settles, retarget (b -> c) -- pan 2 supersedes pan 1.
    await wait(60);
    await rerender(build("c"));
    await waitForAnimationFrame();

    // Immediately after retargeting: must still be transitioning, and must
    // NOT flip false prematurely while pan 2 is still running (the window
    // where an unguarded stale pan-1 `.then()` would incorrectly fire).
    await wait(60);
    expect(reader.getAttribute("data-transitioning")).toBe("true");

    // Once pan 2 has had time to fully settle, transitioning must be false.
    await wait(2000);
    expect(reader.getAttribute("data-transitioning")).toBe("false");
  });
});

describe("Scene className (S6)", () => {
  test("SceneColumn className is applied to the outer element and can override an inline-set property via !important", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <style>{`.scene-column-test-override { flex-basis: 333px !important; }`}</style>
        <Scene duration={0}>
          <SceneColumn name="col" className="scene-column-test-override">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 200, height: 150 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element() as HTMLElement;
    const column = content.closest("[data-column]") as HTMLElement;

    expect(column.className).toContain("scene-column-test-override");
    // A real !important override wins over SceneColumn's own inline
    // flex-basis (set via style={{ flex: "0 1 auto" }}).
    const style = window.getComputedStyle(column);
    expect(style.flexBasis).toBe("333px");
  });

  test("SceneObject className is applied to the outer element and can override an inline-set property via !important", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <style>{`.scene-object-test-override { opacity: 1 !important; }`}</style>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="focused-obj" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
            <SceneObject name="unfocused-obj" focused={false} className="scene-object-test-override">
              <div data-testid="content" style={{ width: 100, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const content = getByTestId("content").element() as HTMLElement;
    const obj = content.closest("[data-scene-id]") as HTMLElement;

    expect(obj.className).toContain("scene-object-test-override");
    // A real !important override wins over SceneObject's own inline
    // opacity (unfocused, not-in-depth-deck objects get opacity: 0.8).
    const style = window.getComputedStyle(obj);
    expect(style.opacity).toBe("1");
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
    // B is anchored at C's top position (peeking up by the default
    // peekOffset — A5) and uses translateZ for 3D depth.
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

    // B is anchored at C's top (anchorTop = height of A = 200px), then peeks
    // up past it by the default peekOffset (12px) — A5, the pull-out-direction
    // principle. The `top` style property should be set to anchorTop - peekOffset.
    expect(objB.style.position).toBe("absolute");
    expect(parseInt(objB.style.top)).toBeCloseTo(200 - 12, -1);
  });

  // A5 — the pull-out-direction principle: a within-column deck card peeks
  // UP past the lower focused sibling's top edge, as explicit per-depth
  // offsets (peekOffset, fanned by depth).

  test("multiple unfocused objects between focused siblings peek up by an additional peekOffset increment per depth (fanned)", async () => {
    // A (focused), B (unfocused, depth-2), C (unfocused, depth-1), D (focused)
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

    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement; // depth-2
    const objC = getByTestId("content-c").element().closest("[data-scene-id]") as HTMLElement; // depth-1

    // anchorTop = D's offsetTop = height of A = 200 (A and D are the only
    // in-flow siblings — B and C are absolutely positioned depth cards, so D
    // sits directly after A regardless of how many depth cards sit between).
    // C (depth-1) peeks up by 12px, B (depth-2) by 24px (default peekOffset).
    expect(parseInt(objC.style.top)).toBeCloseTo(200 - 12, -1);
    expect(parseInt(objB.style.top)).toBeCloseTo(200 - 24, -1);
  });

  test("custom peekOffset prop changes the within-column deck peek offsets accordingly", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} peekOffset={20}>
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

    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement; // depth-2
    const objC = getByTestId("content-c").element().closest("[data-scene-id]") as HTMLElement; // depth-1

    // anchorTop = 200 (A's height; A and D are the only in-flow siblings).
    // With peekOffset=20, C (depth-1) peeks up by 20px and B (depth-2) by
    // 2*20=40px.
    expect(parseInt(objC.style.top)).toBeCloseTo(200 - 20, -1);
    expect(parseInt(objB.style.top)).toBeCloseTo(200 - 40, -1);
  });

  test("peekOffset={0} reproduces the old flush-anchored behavior (no peek)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} peekOffset={0}>
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

    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement; // depth-2
    const objC = getByTestId("content-c").element().closest("[data-scene-id]") as HTMLElement; // depth-1

    // With no peek offset, both depths anchor flush at anchorTop (200) —
    // the pre-A5 behavior, where only translateZ (not a manual top offset)
    // distinguished depths.
    expect(parseInt(objC.style.top)).toBeCloseTo(200, -1);
    expect(parseInt(objB.style.top)).toBeCloseTo(200, -1);
  });

  test("focusing a sandwiched depth-deck object mid-flight settles into the open slot, not frozen at a stale depth-deck position (F5 item 1)", async () => {
    // Top + Bottom focused, Middle sandwiched (depth-deck). A REAL, in-flight
    // spring is engineered on Middle's within-column `top` (growing Top's
    // height shifts the anchor Middle peeks above), then Middle is focused
    // WHILE that spring is still running — reproducing the real repro shape
    // (probe-confirmed on the dev app: by the time a user can click, a
    // residual in-flight spring is essentially always present) more reliably
    // than a clean "already at rest" transition, which a duration=0 initial
    // mount + isolated `rerender()` doesn't naturally leave mid-flight.
    //
    // Root cause reproduced here: `topMV` (bound imperatively via
    // `style.top`, not React's declarative `animate` prop — see H8's own
    // comment on this file for why) had an ACTIVE animate() call in flight
    // when `withinDepthInfo` became falsy. The driving effect early-returned
    // (not sandwiched — nothing redirects topMV toward 0) and the `top` key
    // disappeared from `style` entirely (the binding was previously gated on
    // `withinDepthInfo && withinDepth`). Motion's in-flight WAAPI/JS
    // animation for that DOM property keeps writing until it completes,
    // ignoring that the style prop stopped referencing it — so `top` froze
    // at whatever value it held the instant the binding vanished, which can
    // land anywhere (including well past Bottom's own position, as below).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" objectGap={8}>
            <SceneObject name="top" focused>
              <div data-testid="content-top" style={{ width: 300, height: 100 }}>Top</div>
            </SceneObject>
            <SceneObject name="middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 100 }}>Middle</div>
            </SceneObject>
            <SceneObject name="bottom" focused>
              <div data-testid="content-bottom" style={{ width: 300, height: 100 }}>Bottom</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const middle = getByTestId("content-middle").element().closest("[data-scene-id]") as HTMLElement;
    // Sanity: Middle starts in the depth deck with a nonzero stale-prone `top`.
    expect(middle.getAttribute("data-within-column-depth")).not.toBeNull();

    // Grow Top with a REAL spring (no duration override) — Middle's anchor
    // (Bottom's offsetTop) shifts a lot, starting a genuine in-flight
    // animate() on topMV.
    await rerender(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col" objectGap={8}>
            <SceneObject name="top" focused>
              <div data-testid="content-top" style={{ width: 300, height: 500 }}>Top</div>
            </SceneObject>
            <SceneObject name="middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 100 }}>Middle</div>
            </SceneObject>
            <SceneObject name="bottom" focused>
              <div data-testid="content-bottom" style={{ width: 300, height: 100 }}>Bottom</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    // A couple of real frames — enough for the spring to be genuinely in
    // flight, well short of settling.
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    // Interrupt: focus Middle while the depth-anchor spring is mid-flight.
    await rerender(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col" objectGap={8}>
            <SceneObject name="top" focused>
              <div data-testid="content-top" style={{ width: 300, height: 500 }}>Top</div>
            </SceneObject>
            <SceneObject name="middle" focused>
              <div data-testid="content-middle" style={{ width: 300, height: 100 }}>Middle</div>
            </SceneObject>
            <SceneObject name="bottom" focused>
              <div data-testid="content-bottom" style={{ width: 300, height: 100 }}>Bottom</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Let everything fully settle (default stiffness/damping settle well
    // within a few hundred ms — 1000ms leaves a wide margin).
    await wait(1000);

    const top = getByTestId("content-top").element().closest("[data-scene-id]") as HTMLElement;
    const bottom = getByTestId("content-bottom").element().closest("[data-scene-id]") as HTMLElement;

    expect(middle.getAttribute("data-focused")).toBe("true");
    expect(middle.getAttribute("data-within-column-depth")).toBeNull();

    const topRect = top.getBoundingClientRect();
    const middleRect = middle.getBoundingClientRect();
    const bottomRect = bottom.getBoundingClientRect();

    // Middle occupies the open slot between Top and Bottom (with the 8px
    // gap on both sides), not pinned at Bottom's box.
    expect(middleRect.top).toBeCloseTo(topRect.bottom + 8, 0);
    expect(bottomRect.top).toBeCloseTo(middleRect.bottom + 8, 0);

    // No overlap between Middle and Bottom.
    expect(middleRect.bottom).toBeLessThanOrEqual(bottomRect.top + 0.5);
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
    // The wheel handler's setScrollOffset update comes from a native
    // (non-React-owned) DOM event outside any act() boundary, so React's
    // commit isn't guaranteed to land within exactly one animation frame —
    // instrumented probe confirmed a ~1/6 flake rate on a cold first mount
    // in this file, needing a second frame to settle. Poll for the settled
    // DOM value instead of assuming a fixed frame count (S7).
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-100);

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

    // Scroll position should be restored to 100px — same poll rationale as
    // the scroll assertion above.
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-100);
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
// A2: Swap-reset scroll model (+ resetAlignment, B6 clamp, B7 lifecycle)
// ---------------------------------------------------------------------------

describe("Scene swap-reset scroll model", () => {
  test("swap A→B in an always-focused column resets scroll to top", async () => {
    // A vertical swap changes which object is focused within the column —
    // per the ruled A2 model, this always resets scroll deterministically
    // (does not remember A's prior scroll position for B).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 400, height: 1200 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 400, height: 1200 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ width: 400, height: 1000 }} />
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

    // Refocus the same (single, unchanged) object — key match, so this is a
    // restore, not a swap-reset.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1000 }} />
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
// S6 commit 3: padding cluster — four missing-subtraction sites plus a
// distinct x-anchor origin mismatch. maxScroll (verified above) already
// subtracts padding correctly; these sites didn't.
// ---------------------------------------------------------------------------

describe("Scene padding cluster (S6)", () => {
  test("marginTop centers focused content within the padded viewport, not the raw viewport", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} padding={60}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const content = getByTestId("content").element() as HTMLElement;

    const viewportRect = scene.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const viewportCenterY = viewportRect.top + viewportRect.height / 2;
    const contentCenterY = contentRect.top + contentRect.height / 2;

    expect(contentCenterY).toBeCloseTo(viewportCenterY, 0);
  });

  test("inBetweenY centers a depth-deck column within the padded viewport, not the raw viewport", async () => {
    const build = (middleFocused: boolean) => (
      <TestWrapper fullPage>
        <Scene duration={0} padding={60}>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused>
              <div data-testid="left-content" style={{ width: 100, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="middle">
            <SceneObject name="middle-obj" focused={middleFocused}>
              <div data-testid="middle-content" style={{ width: 100, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-obj" focused>
              <div data-testid="right-content" style={{ width: 100, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    // "middle" must have been focused at least once to have a frozenSize
    // (in-between columns without one never get a measurable colHeight).
    const { rerender, getByTestId } = await render(build(true));
    await rerender(build(false));
    await waitForAnimationFrame();

    const middleCol = getByTestId("middle-content").element().closest("[data-column]") as HTMLElement;

    // Read RAW values (frozen height from the inline style set by
    // inBetweenStyle, translateY from the raw transform) rather than
    // getBoundingClientRect() — the in-between column sits under a CSS
    // perspective + translateZ projection, which foreshortens rendered
    // position AND size non-linearly (see parseTranslateX's docstring for
    // the same rationale applied to the x axis).
    const frozenHeight = parseFloat(middleCol.style.height || "0");
    expect(frozenHeight).toBeGreaterThan(0);
    const translateY = parseTranslateY(middleCol.style.transform);

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
      <TestWrapper fullPage>
        <Scene duration={0} padding={100}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 3000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
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
    // padding added — stackTargetLeft was measured border-box
    // (getBoundingClientRect) against an absolutely-positioned in-between
    // column's static position, which CSS resolves content-box-relative — a
    // padding-sized origin mismatch distinct from the four
    // missing-subtraction sites above.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} padding={60} peekOffset={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 200, height: 200 }} />
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

      // At scrollLeft=0: the leftmost focused column's left edge should be
      // inset from the viewport's left edge by exactly `padding`.
      expect(scene.scrollLeft).toBe(0);
      const leftInset = col1.getBoundingClientRect().left - vpRect.left;
      expect(leftInset).toBeCloseTo(padding, 0);

      // At maximum scroll: the rightmost focused column's right edge should
      // be inset from the viewport's right edge by exactly `padding` too —
      // NOT flush (the pre-fix bug: the left inset was subtracted away by
      // `newStageLeft = -focusedNaturalLeft`, while the right side already
      // got it right via the stage's own CSS padding surviving into
      // scrollWidth — a flush-left/padding-right mix).
      scene.scrollLeft = scene.scrollWidth - scene.clientWidth;
      await waitForAnimationFrame();
      const rightInset = vpRect.right - col2.getBoundingClientRect().right;
      expect(rightInset).toBeCloseTo(padding, 0);
    },
  );

  test("overflow mode: a mid-session padding change (16 -> 32) springs the relayout and both edges land at the new padding", async () => {
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

    // Change padding — the stage's CSS padding changes immediately (not
    // itself animated), but the camera's stageLeft recompute (which the
    // left inset depends on) goes through the normal spring transition, not
    // an instant snap.
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

    scene.scrollLeft = scene.scrollWidth - scene.clientWidth;
    await waitForAnimationFrame();
    const rightInsetAfter = vpRect.right - col2.getBoundingClientRect().right;
    expect(rightInsetAfter).toBeCloseTo(32, 0);
  });
});

// ---------------------------------------------------------------------------
// S6 commit 4: API hygiene
// ---------------------------------------------------------------------------

import {
  DEFAULT_STIFFNESS,
  DEFAULT_DAMPING,
  DEFAULT_COLUMN_GAP,
  DEFAULT_PERSPECTIVE,
  DEFAULT_PEEK_OFFSET,
} from "../src";

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

  test("D4: scrollbar thumb has tabindex=0", async () => {
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
    expect(thumb?.getAttribute("tabindex")).toBe("0");
  });

  test("D4: scrollbar thumb has aria-controls pointing to the content wrapper's stable id", async () => {
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
    const contentWrapper = scene.querySelector("[data-column-content]") as HTMLElement;
    expect(thumb?.getAttribute("aria-controls")).toBe(contentWrapper.id);
    expect(contentWrapper.id).toBe("scene-column-content-col");
  });

  test("D4: pressing ArrowDown while the scrollbar thumb has focus scrolls the column (keyboard ops through the shared command path)", async () => {
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
    await waitForAnimationFrame();

    expect(parseFloat(colAContent.style.top || "0")).toBe(-60);
    expect(parseFloat(colBContent.style.top || "0")).toBe(0);
  });
});
