import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneObject, useCamera } from "../src";
import { TestWrapper } from "./test-wrapper";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for Motion spring animations to settle. The default spring (stiffness
 * 120, damping 30) reaches rest within 2 seconds.
 */
function waitForSpring(): Promise<void> {
  return new Promise((r) => setTimeout(r, 2000));
}

/** Parse a pixel value like "200px" or "200.5px" into a number. */
function parsePx(value: string): number {
  return parseFloat(value);
}

/**
 * Assert that a pixel value string is within `tolerance` pixels of the expected
 * value. Springs don't land exactly on their targets, so a small margin is needed.
 */
function expectPx(actual: string, expected: number, tolerance = 2): void {
  const value = parsePx(actual);
  expect(value).toBeGreaterThanOrEqual(expected - tolerance);
  expect(value).toBeLessThanOrEqual(expected + tolerance);
}

/**
 * Read the translate X/Y values that Motion sets on the camera stage after
 * animation completes. Motion writes something like:
 *   transform: translateX(-50px) translateY(-10px)
 */
function parseStageTranslate(el: HTMLElement): { x: number; y: number } {
  const transform = el.style.transform;
  const xMatch = transform.match(/translateX\((-?[\d.]+)px\)/);
  const yMatch = transform.match(/translateY\((-?[\d.]+)px\)/);
  return {
    x: xMatch ? parseFloat(xMatch[1]) : 0,
    y: yMatch ? parseFloat(yMatch[1]) : 0,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("Scene behavior", () => {
  describe("Registration", () => {
    test("SceneObject registers on mount — viewport gets non-zero size", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene>
            <SceneObject name="a" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      await waitForSpring();

      const viewport = document.querySelector<HTMLElement>(
        '[data-testid="camera-viewport"]',
      );
      expect(viewport).not.toBeNull();
      expect(parsePx(viewport!.style.width)).toBeGreaterThan(0);
      expect(parsePx(viewport!.style.height)).toBeGreaterThan(0);
    });

    test("SceneObject unregisters on unmount — viewport bounds shrink", async () => {
      function TwoObjects({ showSecond }: { showSecond: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene>
              <div style={{ display: "flex", gap: 0 }}>
                <SceneObject name="a" focused={false}>
                  <div style={{ width: 100, height: 100 }} />
                </SceneObject>
                {showSecond && (
                  <SceneObject name="b" focused={false}>
                    <div style={{ width: 200, height: 200 }} />
                  </SceneObject>
                )}
              </div>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<TwoObjects showSecond />);
      await waitForSpring();

      const viewport = document.querySelector<HTMLElement>(
        '[data-testid="camera-viewport"]',
      );
      const widthWithTwo = parsePx(viewport!.style.width);

      await rerender(<TwoObjects showSecond={false} />);
      await waitForSpring();

      const widthWithOne = parsePx(viewport!.style.width);

      // Removing the wider second object should shrink the viewport.
      expect(widthWithOne).toBeLessThan(widthWithTwo);
    });
  });

  // ---------------------------------------------------------------------------
  // Focus behavior
  // ---------------------------------------------------------------------------

  describe("Focus behavior", () => {
    test("camera frames focused object — viewport matches focused object size", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene>
            <div style={{ display: "flex", gap: 20 }}>
              <SceneObject name="a" focused={false}>
                <div style={{ width: 100, height: 100 }} />
              </SceneObject>
              <SceneObject name="b" focused>
                <div style={{ width: 200, height: 150 }} />
              </SceneObject>
            </div>
          </Scene>
        </TestWrapper>,
      );

      await waitForSpring();

      const viewport = document.querySelector<HTMLElement>(
        '[data-testid="camera-viewport"]',
      );
      // The focused object is 200×150. The viewport should match those dimensions.
      expectPx(viewport!.style.width, 200);
      expectPx(viewport!.style.height, 150);
    });

    test("no focus fallback — camera frames all objects", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene>
            <div style={{ display: "flex", gap: 0 }}>
              <SceneObject name="a" focused={false}>
                <div style={{ width: 100, height: 80 }} />
              </SceneObject>
              <SceneObject name="b" focused={false}>
                <div style={{ width: 150, height: 120 }} />
              </SceneObject>
            </div>
          </Scene>
        </TestWrapper>,
      );

      await waitForSpring();

      const viewport = document.querySelector<HTMLElement>(
        '[data-testid="camera-viewport"]',
      );
      // Both objects side-by-side: total width = 100 + 150 = 250, height = 120 (tallest).
      expectPx(viewport!.style.width, 250);
      expectPx(viewport!.style.height, 120);
    });

    test("focus change updates camera — stage transform shifts", async () => {
      function FocusSwitcher({ focusB }: { focusB: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene>
              <div style={{ display: "flex", gap: 20 }}>
                <SceneObject name="a" focused={!focusB}>
                  <div style={{ width: 100, height: 100 }} />
                </SceneObject>
                <SceneObject name="b" focused={focusB}>
                  <div style={{ width: 100, height: 100 }} />
                </SceneObject>
              </div>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<FocusSwitcher focusB={false} />);
      await waitForSpring();

      const stage = document.querySelector<HTMLElement>(
        '[data-testid="camera-stage"]',
      );
      const translateA = parseStageTranslate(stage!);

      await rerender(<FocusSwitcher focusB />);
      await waitForSpring();

      const translateB = parseStageTranslate(stage!);

      // Focusing the second object (offset 120px right due to 100px width + 20px gap)
      // should produce a more negative X translate than focusing the first.
      expect(translateB.x).toBeLessThan(translateA.x);
    });
  });

  // ---------------------------------------------------------------------------
  // useCamera hook
  // ---------------------------------------------------------------------------

  describe("useCamera hook", () => {
    test("useCamera returns current bounds — text content reflects viewport size", async () => {
      function CameraDisplay() {
        const camera = useCamera();
        return (
          <div data-testid="camera-bounds">
            {`${Math.round(camera.bounds.width)}x${Math.round(camera.bounds.height)}`}
          </div>
        );
      }

      await render(
        <TestWrapper fullPage>
          <Scene>
            <SceneObject name="a" focused>
              <div style={{ width: 300, height: 200 }} />
            </SceneObject>
            <CameraDisplay />
          </Scene>
        </TestWrapper>,
      );

      await waitForSpring();

      const display = document.querySelector('[data-testid="camera-bounds"]');
      expect(display?.textContent).toBe("300x200");
    });
  });

  // ---------------------------------------------------------------------------
  // Padding
  // ---------------------------------------------------------------------------

  describe("Padding", () => {
    test("padding expands viewport — 32px padding adds 64px to each dimension", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene padding={32}>
            <SceneObject name="a" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      await waitForSpring();

      const viewport = document.querySelector<HTMLElement>(
        '[data-testid="camera-viewport"]',
      );
      // 100px object + 32px padding on each side = 164px × 164px.
      expectPx(viewport!.style.width, 164);
      expectPx(viewport!.style.height, 164);
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 0: data-focused attribute
  // ---------------------------------------------------------------------------

  describe("data-focused attribute", () => {
    test("focused objects have data-focused=true", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="focused-obj" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
            <SceneObject name="unfocused-obj" focused={false}>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      const focused = document.querySelector('[data-focused="true"]');
      expect(focused).not.toBeNull();
    });

    test("unfocused objects have data-focused=false", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="focused-obj" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
            <SceneObject name="unfocused-obj" focused={false}>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      const unfocused = document.querySelector('[data-focused="false"]');
      expect(unfocused).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 0: inert inner wrapper
  // ---------------------------------------------------------------------------

  describe("inert inner wrapper", () => {
    test("unfocused object internals are inert", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="unfocused-obj" focused={false}>
              <button>Click me</button>
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      const button = document.querySelector("button");
      expect(button).not.toBeNull();
      // The inner wrapper has inert, not the root SceneObject div.
      const inertAncestor = button!.closest("[inert]");
      expect(inertAncestor).not.toBeNull();
      // The root SceneObject div (data-focused=false) should not itself be inert.
      const rootDiv = document.querySelector('[data-focused="false"]');
      expect(rootDiv?.hasAttribute("inert")).toBe(false);
    });

    test("focused object internals are not inert", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="focused-obj" focused>
              <button>Click me</button>
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      const button = document.querySelector("button");
      expect(button).not.toBeNull();
      const inertAncestor = button!.closest("[inert]");
      expect(inertAncestor).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 0: ResizeObserver reframe
  // ---------------------------------------------------------------------------

  describe("ResizeObserver reframe", () => {
    test("camera reframes when focused object resizes", async () => {
      function ResizableScene({ wide }: { wide: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={0}>
              <SceneObject name="resizable" focused>
                <div style={{ width: wide ? 400 : 200, height: 100 }} />
              </SceneObject>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<ResizableScene wide={false} />);
      // Wait for ResizeObserver to fire after initial render.
      await new Promise((r) => setTimeout(r, 100));

      const viewport = document.querySelector<HTMLElement>(
        '[data-testid="camera-viewport"]',
      );
      const initialWidth = parsePx(viewport!.style.width);

      await rerender(<ResizableScene wide />);
      // Wait for ResizeObserver to fire after resize.
      await new Promise((r) => setTimeout(r, 100));

      const updatedWidth = parsePx(viewport!.style.width);
      expect(updatedWidth).toBeGreaterThan(initialWidth);
    });
  });
});
