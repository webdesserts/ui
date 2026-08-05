import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { hasReducedMotionListener, prefersReducedMotion } from "motion/react";
import { TestWrapper } from "./test-wrapper";
import { wait, waitForAnimationFrame } from "./utils/animation";
import { buildScene } from "./utils/sceneFixtures";
import { CameraReader } from "./utils/cameraReader";

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
            <SceneObject name="object" focused={false}>
              <button data-testid="btn-in-object">action</button>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Object is not focused — button should not have keyboard focus.
    const btn = getByTestId("btn-in-object").element() as HTMLElement;
    expect(document.activeElement).not.toBe(btn);

    // Transition: make the object focused.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <button data-testid="btn-in-object">action</button>
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
            <SceneObject name="object" focused={false}>
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
            <SceneObject name="object" focused>
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
            <SceneObject name="object" focused={false}>
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
            <SceneObject name="object" focused>
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
              <SceneObject name="object" focused={false}>
                <button data-testid="btn-in-object">action</button>
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
              <SceneObject name="object" focused>
                <button data-testid="btn-in-object">action</button>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      const btn = getByTestId("btn-in-object").element() as HTMLElement;
      expect(document.activeElement).toBe(btn);
      // ui#20 remap: two-phase focus (F2) now calls .focus() TWICE on a
      // focus-gain — phase 1 lands on the anchor immediately (mid-
      // transition-safe, since the anchor sits outside the inert content
      // wrapper), phase 2 moves focus to the first focusable descendant
      // once the transition settles. At duration=0 both phases run in the
      // same effect pass (the settle counter never rises), so the FINAL
      // resting state (asserted above) is unchanged, but the call count
      // is not — every call still passes preventScroll: true.
      expect(focusSpy).toHaveBeenCalledTimes(2);
      for (const call of focusSpy.mock.calls) {
        expect(call[0]).toEqual(expect.objectContaining({ preventScroll: true }));
      }
      expect(focusSpy).toHaveBeenLastCalledWith(expect.objectContaining({ preventScroll: true }));
      expect(focusSpy.mock.instances[focusSpy.mock.instances.length - 1]).toBe(btn);
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
            <SceneObject name="object" focused>
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
            <SceneObject name="object" focused>
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
            <SceneObject name="object" focused>
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
            <SceneObject name="object" focused={false}>
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
            <SceneObject name="object" focused>
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
            <SceneObject name="object" focused={false}>
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
      buildScene(
        [
          {
            name: "col",
            objects: [
              { name: "obj-a", focused: true, width: 200, height: 150, testId: "content-a" },
              { name: "obj-b", focused: false, width: 200, height: 150, testId: "content-b" },
              { name: "obj-c", focused: false, width: 200, height: 150, testId: "content-c" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    // Quick sequential focus changes: a → b → c
    await rerender(
      buildScene(
        [
          {
            name: "col",
            objects: [
              { name: "obj-a", focused: false, width: 200, height: 150, testId: "content-a" },
              { name: "obj-b", focused: true, width: 200, height: 150, testId: "content-b" },
              { name: "obj-c", focused: false, width: 200, height: 150, testId: "content-c" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await rerender(
      buildScene(
        [
          {
            name: "col",
            objects: [
              { name: "obj-a", focused: false, width: 200, height: 150, testId: "content-a" },
              { name: "obj-b", focused: false, width: 200, height: 150, testId: "content-b" },
              { name: "obj-c", focused: true, width: 200, height: 150, testId: "content-c" },
            ],
          },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
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
            <SceneObject name="object" focused>
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
            <SceneObject name="object" focused>
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
            <SceneObject name="object" focused>
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

describe("useCamera", () => {
  test("useCamera reports viewport rect width and height", async () => {
    // viewport should reflect the scene viewport element dimensions.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
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
                <SceneObject name="object" focused>
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
            <SceneObject name="object" focused>
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
            <SceneObject name="object" focused>
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
            <SceneObject name="object" focused>
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
