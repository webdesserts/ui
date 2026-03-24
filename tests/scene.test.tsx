import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { act } from "react";
import { Scene, SceneObject, useCamera } from "../src";
import { TestWrapper } from "./test-wrapper";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for a layout effect + ResizeObserver cycle to complete. */
function waitForLayout(): Promise<void> {
  return new Promise((r) => setTimeout(r, 100));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("Scene behavior", () => {
  describe("Registration", () => {
    test("SceneObject registers on mount — bounds become non-zero", async () => {
      function BoundsDisplay() {
        const camera = useCamera();
        return (
          <div data-testid="camera-bounds">
            {`${Math.round(camera.bounds.width)}x${Math.round(camera.bounds.height)}`}
          </div>
        );
      }

      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="a" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
            <BoundsDisplay />
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const display = document.querySelector('[data-testid="camera-bounds"]');
      // After registration, width and height should both be positive.
      const [w, h] = display!.textContent!.split("x").map(Number);
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
    });

    test("SceneObject unregisters on unmount — bounds shrink", async () => {
      function BoundsDisplay() {
        const camera = useCamera();
        return (
          <div data-testid="camera-bounds">
            {Math.round(camera.bounds.width)}
          </div>
        );
      }

      function TwoObjects({ showSecond }: { showSecond: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={0}>
              <SceneObject name="a" focused>
                <div style={{ width: 100, height: 100 }} />
              </SceneObject>
              {showSecond && (
                <SceneObject name="b" focused>
                  <div style={{ width: 200, height: 200 }} />
                </SceneObject>
              )}
              <BoundsDisplay />
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<TwoObjects showSecond />);
      await waitForLayout();

      const display = document.querySelector('[data-testid="camera-bounds"]');
      const widthWithTwo = Number(display!.textContent);

      await rerender(<TwoObjects showSecond={false} />);
      await waitForLayout();

      const widthWithOne = Number(display!.textContent);

      // Removing the wider second object should shrink the bounds width.
      expect(widthWithOne).toBeLessThan(widthWithTwo);
    });
  });

  // ---------------------------------------------------------------------------
  // Focus behavior — flex layout assertions
  // ---------------------------------------------------------------------------

  describe("Focus behavior", () => {
    test("focused objects are flex items — position: relative and flex: 0 1 auto", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="a" focused>
              <div style={{ width: 200, height: 150 }} />
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const obj = document.querySelector<HTMLElement>('[data-focused="true"]');
      expect(obj).not.toBeNull();
      expect(obj!.style.position).toBe("relative");
      expect(obj!.style.flex).toBe("0 1 auto");
    });

    test("unfocused objects are absolutely positioned", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="a" focused={false}>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const obj = document.querySelector<HTMLElement>('[data-focused="false"]');
      expect(obj).not.toBeNull();
      expect(obj!.style.position).toBe("absolute");
    });

    test("unfocused objects that were never focused have opacity: 0", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="a" focused={false}>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const obj = document.querySelector<HTMLElement>('[data-focused="false"]');
      expect(obj).not.toBeNull();
      // Never-focused objects should be invisible until first focus.
      expect(obj!.style.opacity).toBe("0");
    });

    test("unfocused objects freeze at last dimensions after leaving focus", async () => {
      function FocusSwitcher({ focused }: { focused: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={0}>
              <SceneObject name="a" focused={focused}>
                <div style={{ width: 200, height: 150 }} />
              </SceneObject>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<FocusSwitcher focused />);
      await waitForLayout();

      // Unfocus the object — it should freeze at the last known dimensions.
      await act(async () => {
        await rerender(<FocusSwitcher focused={false} />);
      });
      await waitForLayout();

      const obj = document.querySelector<HTMLElement>('[data-focused="false"]');
      expect(obj).not.toBeNull();
      expect(obj!.style.position).toBe("absolute");
      // Width and height should be explicitly set (frozen, not zero or missing).
      expect(parseFloat(obj!.style.width)).toBeGreaterThan(0);
      expect(parseFloat(obj!.style.height)).toBeGreaterThan(0);
      // Opacity should not be 0 — a previously-focused object stays visible.
      expect(obj!.style.opacity).not.toBe("0");
    });

    test("camera frames focused object — focused object is position: relative", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="a" focused={false}>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
            <SceneObject name="b" focused>
              <div style={{ width: 200, height: 150 }} />
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const objects = document.querySelectorAll<HTMLElement>("[data-focused]");
      const focusedObj = Array.from(objects).find(
        (el) => el.dataset.focused === "true",
      );
      const unfocusedObj = Array.from(objects).find(
        (el) => el.dataset.focused === "false",
      );

      expect(focusedObj!.style.position).toBe("relative");
      expect(unfocusedObj!.style.position).toBe("absolute");
    });

    test("focus change updates camera — newly focused object becomes relative, previously focused becomes absolute", async () => {
      function FocusSwitcher({ focusB }: { focusB: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={0}>
              <SceneObject name="a" focused={!focusB}>
                <div style={{ width: 100, height: 100 }} />
              </SceneObject>
              <SceneObject name="b" focused={focusB}>
                <div style={{ width: 100, height: 100 }} />
              </SceneObject>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<FocusSwitcher focusB={false} />);
      await waitForLayout();

      // Initially: a is focused (relative), b is unfocused (absolute).
      const objA = document.querySelector<HTMLElement>('[data-focused][name]');
      const allObjs = document.querySelectorAll<HTMLElement>("[data-focused]");
      const [elA, elB] = Array.from(allObjs);
      expect(elA!.style.position).toBe("relative");
      expect(elB!.style.position).toBe("absolute");

      // Switch focus to b.
      await act(async () => {
        await rerender(<FocusSwitcher focusB />);
      });
      await waitForLayout();

      // Now b should be relative, a should be absolute (frozen).
      const updatedObjs = document.querySelectorAll<HTMLElement>("[data-focused]");
      const [updatedA, updatedB] = Array.from(updatedObjs);
      expect(updatedA!.style.position).toBe("absolute");
      expect(updatedB!.style.position).toBe("relative");
      void objA;
    });

    test("two focused objects share viewport — both are position: relative", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="a" focused>
              <div style={{ width: 150, height: 100 }} />
            </SceneObject>
            <SceneObject name="b" focused>
              <div style={{ width: 150, height: 100 }} />
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const objects = document.querySelectorAll<HTMLElement>("[data-focused]");
      expect(objects).toHaveLength(2);
      for (const obj of Array.from(objects)) {
        expect(obj.style.position).toBe("relative");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // useCamera hook
  // ---------------------------------------------------------------------------

  describe("useCamera hook", () => {
    test("useCamera returns current bounds — width reflects focused object width", async () => {
      function CameraDisplay() {
        const camera = useCamera();
        return (
          <div data-testid="camera-bounds">
            {Math.round(camera.bounds.width)}
          </div>
        );
      }

      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="a" focused>
              <div style={{ width: 300, height: 200 }} />
            </SceneObject>
            <CameraDisplay />
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      // The focused SceneObject is a flex item — its width reflects the content
      // width. Height may differ because flex items stretch to fill the row.
      const display = document.querySelector('[data-testid="camera-bounds"]');
      expect(display?.textContent).toBe("300");
    });
  });

  // ---------------------------------------------------------------------------
  // Padding
  // ---------------------------------------------------------------------------

  describe("Padding", () => {
    test("padding expands camera bounds — 32px padding adds 64px to object width", async () => {
      function BoundsDisplay() {
        const camera = useCamera();
        return (
          <div data-testid="camera-bounds">
            {Math.round(camera.bounds.width)}
          </div>
        );
      }

      await render(
        <TestWrapper fullPage>
          <Scene duration={0} padding={32}>
            <SceneObject name="a" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
            <BoundsDisplay />
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const display = document.querySelector('[data-testid="camera-bounds"]');
      // 100px object + 32px padding on each side = 164px wide.
      // Height is not tested here because the flex item stretches to fill the row.
      expect(display?.textContent).toBe("164");
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
      function BoundsDisplay() {
        const camera = useCamera();
        return (
          <div data-testid="camera-bounds">{Math.round(camera.bounds.width)}</div>
        );
      }

      function ResizableScene({ wide }: { wide: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={0}>
              <SceneObject name="resizable" focused>
                <div style={{ width: wide ? 400 : 200, height: 100 }} />
              </SceneObject>
              <BoundsDisplay />
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<ResizableScene wide={false} />);
      // Wait for ResizeObserver to fire after initial render.
      await new Promise((r) => setTimeout(r, 100));

      const display = document.querySelector('[data-testid="camera-bounds"]');
      const initialWidth = Number(display!.textContent);

      await rerender(<ResizableScene wide />);
      // Wait for ResizeObserver to fire after resize.
      await new Promise((r) => setTimeout(r, 100));

      const updatedWidth = Number(display!.textContent);
      expect(updatedWidth).toBeGreaterThan(initialWidth);
    });
  });
});
