import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { act } from "react";
import { Scene, SceneObject, SceneColumn, useCamera } from "../src";
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
    test("focused objects are flex items — position: relative, flex row via implicit column", async () => {
      // Bare SceneObjects are auto-wrapped in an implicit SceneColumn. The column
      // is the flex item (flex: 0 1 auto) and the SceneObject inside uses
      // position: relative without its own flex shorthand.
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
      // The implicit column wrapper owns the flex shorthand, not the SceneObject.
      const col = document.querySelector<HTMLElement>("[data-column]");
      expect(col).not.toBeNull();
      expect(col!.style.flex).toBe("0 1 auto");
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
      // Objects inside a column (including auto-wrapped bare SceneObjects) are
      // hidden after losing focus. The column itself is the positioned unit that
      // moves off-screen; the object's opacity:0 prevents overlap with the next
      // focused object, which occupies the same (0,0) position within the column.
      expect(obj!.style.opacity).toBe("0");
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
  // SceneColumn behavior
  // ---------------------------------------------------------------------------

  describe("SceneColumn behavior", () => {
    test("column with focused child participates in flex layout — position: relative", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col-a">
              <SceneObject name="obj-a" focused>
                <div style={{ width: 200, height: 150 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const col = document.querySelector<HTMLElement>('[data-column-focused="true"]');
      expect(col).not.toBeNull();
      expect(col!.style.position).toBe("relative");
    });

    test("column with no focused children is absolutely positioned", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col-a">
              <SceneObject name="obj-a" focused={false}>
                <div style={{ width: 100, height: 100 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const col = document.querySelector<HTMLElement>('[data-column-focused="false"]');
      expect(col).not.toBeNull();
      expect(col!.style.position).toBe("absolute");
    });

    test("column freezes at last dimensions when all children lose focus", async () => {
      function FocusSwitcher({ focused }: { focused: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={0}>
              <SceneColumn name="col-a">
                <SceneObject name="obj-a" focused={focused}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
              </SceneColumn>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<FocusSwitcher focused />);
      await waitForLayout();

      // Unfocus the child — column should freeze at last known dimensions.
      await act(async () => {
        await rerender(<FocusSwitcher focused={false} />);
      });
      await waitForLayout();

      const col = document.querySelector<HTMLElement>('[data-column-focused="false"]');
      expect(col).not.toBeNull();
      expect(col!.style.position).toBe("absolute");
      // Frozen columns have explicit dimensions, not just opacity:0.
      expect(parseFloat(col!.style.width)).toBeGreaterThan(0);
      expect(parseFloat(col!.style.height)).toBeGreaterThan(0);
    });

    test("focused SceneObject inside column does not have flex shorthand", async () => {
      // The column is the flex item in the horizontal layout, not the object.
      // Objects inside a column should use position:relative but not flex:0 1 auto.
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col-a">
              <SceneObject name="obj-a" focused>
                <div style={{ width: 200, height: 150 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const obj = document.querySelector<HTMLElement>('[data-focused="true"]');
      expect(obj).not.toBeNull();
      expect(obj!.style.position).toBe("relative");
      // Column owns the flex shorthand; object should NOT have it.
      expect(obj!.style.flex).not.toBe("0 1 auto");
    });

    test("two focused columns share viewport — both are position: relative", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col-a">
              <SceneObject name="obj-a" focused>
                <div style={{ width: 150, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-b">
              <SceneObject name="obj-b" focused>
                <div style={{ width: 150, height: 100 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const cols = document.querySelectorAll<HTMLElement>("[data-column-focused]");
      expect(cols).toHaveLength(2);
      for (const col of Array.from(cols)) {
        expect(col.style.position).toBe("relative");
      }
    });

    test("mixed focused/unfocused columns — focused is relative, unfocused is absolute", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col-focused">
              <SceneObject name="obj-a" focused>
                <div style={{ width: 150, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-unfocused">
              <SceneObject name="obj-b" focused={false}>
                <div style={{ width: 150, height: 100 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const focusedCol = document.querySelector<HTMLElement>('[data-column="col-focused"]');
      const unfocusedCol = document.querySelector<HTMLElement>('[data-column="col-unfocused"]');
      expect(focusedCol).not.toBeNull();
      expect(unfocusedCol).not.toBeNull();
      expect(focusedCol!.style.position).toBe("relative");
      expect(unfocusedCol!.style.position).toBe("absolute");
    });

  });

  // ---------------------------------------------------------------------------
  // Vertical swap animation
  // ---------------------------------------------------------------------------

  describe("Vertical swap animation", () => {
    test("vertical swap changes focused state correctly", async () => {
      // Swap should correctly update data-focused attributes for both objects.
      function FocusSwitcher({ focusB }: { focusB: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={0}>
              <SceneColumn name="col">
                <SceneObject name="obj-a" focused={!focusB}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
                <SceneObject name="obj-b" focused={focusB}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
              </SceneColumn>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<FocusSwitcher focusB={false} />);
      await waitForLayout();

      await act(async () => {
        await rerender(<FocusSwitcher focusB />);
      });
      await waitForLayout();

      const objA = document.querySelector<HTMLElement>('[data-scene-id="obj-a"]');
      const objB = document.querySelector<HTMLElement>('[data-scene-id="obj-b"]');
      expect(objA).not.toBeNull();
      expect(objB).not.toBeNull();
      expect(objB!.dataset.focused).toBe("true");
      expect(objA!.dataset.focused).toBe("false");
    });

    test("ascending swap — incoming object slides up from below", async () => {
      // When focus moves from obj-a to obj-b (b is after a in DOM), b rises from below.
      // In the init phase, b should have a positive translateY (placed below).
      function FocusSwitcher({ focusB }: { focusB: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={100}>
              <SceneColumn name="col">
                <SceneObject name="obj-a" focused={!focusB}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
                <SceneObject name="obj-b" focused={focusB}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
              </SceneColumn>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<FocusSwitcher focusB={false} />);
      await waitForLayout();

      // Trigger the swap — check init-phase transform immediately after render.
      await act(async () => {
        await rerender(<FocusSwitcher focusB />);
      });

      // Read transform right after act(), before RAF fires settle phase.
      const objB = document.querySelector<HTMLElement>('[data-scene-id="obj-b"]');
      expect(objB).not.toBeNull();
      // During init phase, incoming (b, ascending) starts at +columnHeight.
      const transform = objB!.style.transform;
      expect(transform).toBeTruthy();
      const match = transform.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
      expect(match).not.toBeNull();
      const y = parseFloat(match![1]);
      expect(y).toBeGreaterThanOrEqual(0);
    });

    test("descending swap — incoming object slides down from above", async () => {
      // When focus moves from obj-b to obj-a (a is before b in DOM), a descends from above.
      // In the init phase, a should have a negative translateY (placed above).
      function FocusSwitcher({ focusA }: { focusA: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={100}>
              <SceneColumn name="col">
                <SceneObject name="obj-a" focused={focusA}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
                <SceneObject name="obj-b" focused={!focusA}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
              </SceneColumn>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<FocusSwitcher focusA={false} />);
      await waitForLayout();

      // Trigger the swap — check init-phase transform immediately after render.
      await act(async () => {
        await rerender(<FocusSwitcher focusA />);
      });

      // Read transform right after act(), before RAF fires settle phase.
      const objA = document.querySelector<HTMLElement>('[data-scene-id="obj-a"]');
      expect(objA).not.toBeNull();
      // During init phase, incoming (a, descending) starts at -columnHeight.
      const transform = objA!.style.transform;
      expect(transform).toBeTruthy();
      const match = transform.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
      expect(match).not.toBeNull();
      const y = parseFloat(match![1]);
      expect(y).toBeLessThanOrEqual(0);
    });

    test("sibling columns unaffected by vertical swap", async () => {
      // A swap in column 1 should not move objects in column 2.
      function FocusSwitcher({ focusB }: { focusB: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={100}>
              <SceneColumn name="col-1">
                <SceneObject name="obj-a" focused={!focusB}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
                <SceneObject name="obj-b" focused={focusB}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
              </SceneColumn>
              <SceneColumn name="col-2">
                <SceneObject name="obj-c" focused>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
              </SceneColumn>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<FocusSwitcher focusB={false} />);
      await waitForLayout();

      await act(async () => {
        await rerender(<FocusSwitcher focusB />);
      });
      await waitForLayout();

      // Column 2's object should have no transform applied by the swap.
      const objC = document.querySelector<HTMLElement>('[data-scene-id="obj-c"]');
      expect(objC).not.toBeNull();
      const transform = objC!.style.transform;
      // No translateY should be applied to a sibling column's object.
      expect(transform).not.toMatch(/translateY\([^0]/);
    });

    test("swap completes — outgoing object freezes after animation", async () => {
      // After the animation duration, the outgoing object should be frozen at absolute position.
      function FocusSwitcher({ focusB }: { focusB: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={50}>
              <SceneColumn name="col">
                <SceneObject name="obj-a" focused={!focusB}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
                <SceneObject name="obj-b" focused={focusB}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
              </SceneColumn>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<FocusSwitcher focusB={false} />);
      await waitForLayout();

      await act(async () => {
        await rerender(<FocusSwitcher focusB />);
      });

      // Wait for animation to finish (50ms duration + buffer).
      await new Promise((r) => setTimeout(r, 150));

      const objA = document.querySelector<HTMLElement>('[data-scene-id="obj-a"]');
      expect(objA).not.toBeNull();
      // After swap completes, outgoing object should be frozen (position: absolute).
      expect(objA!.style.position).toBe("absolute");
      // Width and height should be non-zero (frozen at last dimensions).
      expect(parseFloat(objA!.style.width)).toBeGreaterThan(0);
      expect(parseFloat(objA!.style.height)).toBeGreaterThan(0);
    });

    test("instant swap with duration={0} — no lingering transforms", async () => {
      // With duration=0, the swap should complete immediately with no transforms.
      function FocusSwitcher({ focusB }: { focusB: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={0}>
              <SceneColumn name="col">
                <SceneObject name="obj-a" focused={!focusB}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
                <SceneObject name="obj-b" focused={focusB}>
                  <div style={{ width: 200, height: 150 }} />
                </SceneObject>
              </SceneColumn>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<FocusSwitcher focusB={false} />);
      await waitForLayout();

      await act(async () => {
        await rerender(<FocusSwitcher focusB />);
      });
      await waitForLayout();

      // After an instant swap, no lingering transforms should remain.
      const objA = document.querySelector<HTMLElement>('[data-scene-id="obj-a"]');
      const objB = document.querySelector<HTMLElement>('[data-scene-id="obj-b"]');
      expect(objA).not.toBeNull();
      expect(objB).not.toBeNull();
      // Both should be in their final states without active transforms.
      expect(objA!.style.transform).not.toMatch(/translateY\([^0]/);
      expect(objB!.style.transform).not.toMatch(/translateY\([^0]/);
      // obj-b is the new focused object — it should be relative.
      expect(objB!.style.position).toBe("relative");
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-focus vertical stacking
  // ---------------------------------------------------------------------------

  describe("Multi-focus vertical stacking", () => {
    test("two focused objects in a column are both visible and stacked", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col">
              <SceneObject name="obj-a" focused>
                <div style={{ width: 200, height: 100 }} />
              </SceneObject>
              <SceneObject name="obj-b" focused>
                <div style={{ width: 200, height: 100 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const objA = document.querySelector<HTMLElement>('[data-scene-id="obj-a"]');
      const objB = document.querySelector<HTMLElement>('[data-scene-id="obj-b"]');
      expect(objA).not.toBeNull();
      expect(objB).not.toBeNull();

      // Both are focused and in flow.
      expect(objA!.dataset.focused).toBe("true");
      expect(objB!.dataset.focused).toBe("true");
      expect(objA!.style.position).toBe("relative");
      expect(objB!.style.position).toBe("relative");

      // Column is a flex-column container, so objects stack vertically.
      // obj-b's top edge should be at or below obj-a's bottom edge.
      const rectA = objA!.getBoundingClientRect();
      const rectB = objB!.getBoundingClientRect();
      expect(rectB.top).toBeGreaterThanOrEqual(rectA.bottom - 1);
    });

    test("unfocusing one of two focused objects leaves the other visible", async () => {
      function FocusSwitcher({ bothFocused }: { bothFocused: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={0}>
              <SceneColumn name="col">
                <SceneObject name="obj-a" focused>
                  <div style={{ width: 200, height: 100 }} />
                </SceneObject>
                <SceneObject name="obj-b" focused={bothFocused}>
                  <div style={{ width: 200, height: 100 }} />
                </SceneObject>
              </SceneColumn>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<FocusSwitcher bothFocused />);
      await waitForLayout();

      // Unfocus obj-b, leaving obj-a still focused.
      await act(async () => {
        await rerender(<FocusSwitcher bothFocused={false} />);
      });
      await waitForLayout();

      const objA = document.querySelector<HTMLElement>('[data-scene-id="obj-a"]');
      const objB = document.querySelector<HTMLElement>('[data-scene-id="obj-b"]');
      expect(objA).not.toBeNull();
      expect(objB).not.toBeNull();

      // obj-a remains focused and in flow.
      expect(objA!.dataset.focused).toBe("true");
      expect(objA!.style.position).toBe("relative");

      // obj-b is unfocused and exits flow (frozen at absolute position).
      expect(objB!.dataset.focused).toBe("false");
      expect(objB!.style.position).toBe("absolute");
    });

    test("column adjusts height when focused child count changes", async () => {
      function FocusSwitcher({ bothFocused }: { bothFocused: boolean }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={0}>
              <SceneColumn name="col">
                <SceneObject name="obj-a" focused>
                  <div style={{ width: 200, height: 100 }} />
                </SceneObject>
                <SceneObject name="obj-b" focused={bothFocused}>
                  <div style={{ width: 200, height: 100 }} />
                </SceneObject>
              </SceneColumn>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<FocusSwitcher bothFocused />);
      await waitForLayout();

      // Count in-flow (position: relative) children — both focused objects should be in flow.
      const countInFlow = () => {
        const children = document.querySelectorAll<HTMLElement>('[data-column="col"] > [data-focused]');
        return Array.from(children).filter((el) => el.style.position === "relative").length;
      };

      expect(countInFlow()).toBe(2);

      await act(async () => {
        await rerender(<FocusSwitcher bothFocused={false} />);
      });
      await waitForLayout();

      // After unfocusing obj-b, only obj-a should remain in flow.
      expect(countInFlow()).toBe(1);
    });

    test("three focused objects all stack in order", async () => {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col">
              <SceneObject name="obj-a" focused>
                <div style={{ width: 200, height: 80 }} />
              </SceneObject>
              <SceneObject name="obj-b" focused>
                <div style={{ width: 200, height: 80 }} />
              </SceneObject>
              <SceneObject name="obj-c" focused>
                <div style={{ width: 200, height: 80 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const objA = document.querySelector<HTMLElement>('[data-scene-id="obj-a"]');
      const objB = document.querySelector<HTMLElement>('[data-scene-id="obj-b"]');
      const objC = document.querySelector<HTMLElement>('[data-scene-id="obj-c"]');
      expect(objA).not.toBeNull();
      expect(objB).not.toBeNull();
      expect(objC).not.toBeNull();

      // All three are focused and in flow.
      expect(objA!.dataset.focused).toBe("true");
      expect(objB!.dataset.focused).toBe("true");
      expect(objC!.dataset.focused).toBe("true");
      expect(objA!.style.position).toBe("relative");
      expect(objB!.style.position).toBe("relative");
      expect(objC!.style.position).toBe("relative");

      // Objects should stack top-to-bottom in DOM order.
      const rectA = objA!.getBoundingClientRect();
      const rectB = objB!.getBoundingClientRect();
      const rectC = objC!.getBoundingClientRect();
      expect(rectB.top).toBeGreaterThanOrEqual(rectA.bottom - 1);
      expect(rectC.top).toBeGreaterThanOrEqual(rectB.bottom - 1);
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

  // ---------------------------------------------------------------------------
  // Auto-wrapping bare SceneObjects
  // ---------------------------------------------------------------------------

  describe("Auto-wrapping bare SceneObjects", () => {
    test("bare SceneObjects get implicit columns", async () => {
      // SceneObjects placed directly in Scene (without an explicit SceneColumn)
      // should each be wrapped in an implicit column automatically.
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="obj-a" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      // Both objects should have a [data-column] ancestor — the implicit column.
      const objA = document.querySelector('[data-scene-id="obj-a"]');
      const objB = document.querySelector('[data-scene-id="obj-b"]');
      expect(objA).not.toBeNull();
      expect(objB).not.toBeNull();
      expect(objA!.closest("[data-column]")).not.toBeNull();
      expect(objB!.closest("[data-column]")).not.toBeNull();
    });

    test("mixed bare and explicit columns work together", async () => {
      // A Scene with one explicit SceneColumn and one bare SceneObject should
      // render both as column-backed flex items side by side.
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="explicit-col">
              <SceneObject name="obj-a" focused>
                <div style={{ width: 150, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneObject name="obj-b" focused>
              <div style={{ width: 150, height: 100 }} />
            </SceneObject>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      // Both objects should have a [data-column] ancestor.
      const objA = document.querySelector('[data-scene-id="obj-a"]');
      const objB = document.querySelector('[data-scene-id="obj-b"]');
      expect(objA!.closest("[data-column]")).not.toBeNull();
      expect(objB!.closest("[data-column]")).not.toBeNull();

      // Both columns should be in the focused flex layout (position: relative).
      const cols = document.querySelectorAll<HTMLElement>("[data-column-focused='true']");
      expect(cols).toHaveLength(2);
      for (const col of Array.from(cols)) {
        expect(col.style.position).toBe("relative");
      }
    });

    test("implicit columns have stable identity across rerenders", async () => {
      // The implicit column wrapping a bare SceneObject should not be recreated
      // on re-render — the same DOM node should be reused.
      function StableScene({ label }: { label: string }) {
        return (
          <TestWrapper fullPage>
            <Scene duration={0}>
              <SceneObject key="obj-a" name="obj-a" focused>
                <div>{label}</div>
              </SceneObject>
            </Scene>
          </TestWrapper>
        );
      }

      const { rerender } = await render(<StableScene label="first" />);
      await waitForLayout();

      const colBefore = document.querySelector("[data-column]");
      expect(colBefore).not.toBeNull();

      await act(async () => {
        await rerender(<StableScene label="second" />);
      });
      await waitForLayout();

      // The column element should be the same DOM node (not remounted).
      const colAfter = document.querySelector("[data-column]");
      expect(colAfter).toBe(colBefore);
    });

    test("non-SceneObject children are not wrapped in columns", async () => {
      // Utility components placed directly inside Scene (e.g. a debug overlay)
      // should NOT be wrapped in implicit SceneColumns. Only SceneObjects get
      // auto-wrapped. Non-SceneObject elements are passed through unchanged.
      function UtilityComponent() {
        return <div data-testid="utility">debug</div>;
      }

      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneObject name="obj-a" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
            <UtilityComponent />
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      // The SceneObject should be wrapped in an implicit column.
      const obj = document.querySelector('[data-scene-id="obj-a"]');
      expect(obj!.closest("[data-column]")).not.toBeNull();

      // The utility component should NOT be wrapped — it has no [data-column] ancestor.
      const utility = document.querySelector('[data-testid="utility"]');
      expect(utility).not.toBeNull();
      expect(utility!.closest("[data-column]")).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Alignment and centering
  // ---------------------------------------------------------------------------

  describe("Alignment and centering", () => {
    /** Parse translate(Xpx, Ypx) from a CSS transform string. */
    function parseTranslate(transform: string): { x: number; y: number } | null {
      const match = transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
      if (!match) return null;
      return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
    }

    test("content smaller than viewport is centered on both axes", async () => {
      // 200x150 content in a 1280x800 viewport — both axes have room to center.
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col">
              <SceneObject name="obj" focused>
                <div style={{ width: 200, height: 150 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const col = document.querySelector<HTMLElement>('[data-column-focused="true"]');
      expect(col).not.toBeNull();
      const offset = parseTranslate(col!.style.transform);
      expect(offset).not.toBeNull();
      // Viewport is 1280x800, content is 200x150 — both offsets should be positive.
      expect(offset!.x).toBeGreaterThan(0);
      expect(offset!.y).toBeGreaterThan(0);
    });

    test("content taller than viewport is centered horizontally and top-aligned", async () => {
      // 200x900 content — fits horizontally, overflows vertically.
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col">
              <SceneObject name="obj" focused>
                <div style={{ width: 200, height: 900 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const col = document.querySelector<HTMLElement>('[data-column-focused="true"]');
      expect(col).not.toBeNull();
      const offset = parseTranslate(col!.style.transform);
      expect(offset).not.toBeNull();
      // Content is narrower than 1280px viewport — X should be positive (centered).
      expect(offset!.x).toBeGreaterThan(0);
      // Content height 900 > viewport height 800 — Y should be 0 (top-aligned).
      expect(offset!.y).toBe(0);
    });

    test("content wider than viewport is left-aligned and centered vertically", async () => {
      // 1400x150 content — overflows horizontally, fits vertically.
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col">
              <SceneObject name="obj" focused>
                <div style={{ width: 1400, height: 150 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const col = document.querySelector<HTMLElement>('[data-column-focused="true"]');
      expect(col).not.toBeNull();
      const offset = parseTranslate(col!.style.transform);
      expect(offset).not.toBeNull();
      // Content width 1400 > viewport width 1280 — X should be 0 (left-aligned).
      expect(offset!.x).toBe(0);
      // Content height 150 < viewport height 800 — Y should be positive (centered).
      expect(offset!.y).toBeGreaterThan(0);
    });

    test("content overflowing both axes has no centering offset", async () => {
      // 1400x900 content — overflows both axes.
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col">
              <SceneObject name="obj" focused>
                <div style={{ width: 1400, height: 900 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const col = document.querySelector<HTMLElement>('[data-column-focused="true"]');
      expect(col).not.toBeNull();
      const offset = parseTranslate(col!.style.transform);
      // Both axes overflow — offset should be (0, 0) or no meaningful transform.
      if (offset) {
        expect(offset.x).toBe(0);
        expect(offset.y).toBe(0);
      }
    });

    test("unfocused columns do not receive centering transform", async () => {
      // Two columns: one focused, one unfocused. Only the focused one should be centered.
      await render(
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="focused-col">
              <SceneObject name="obj-focused" focused>
                <div style={{ width: 200, height: 150 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="unfocused-col">
              <SceneObject name="obj-unfocused" focused={false}>
                <div style={{ width: 200, height: 150 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      await waitForLayout();

      const unfocusedCol = document.querySelector<HTMLElement>('[data-column="unfocused-col"]');
      expect(unfocusedCol).not.toBeNull();
      // Unfocused columns should not have a centering transform.
      // Their transform should be empty or not include a meaningful translate.
      const transform = unfocusedCol!.style.transform;
      if (transform) {
        const offset = parseTranslate(transform);
        if (offset) {
          // If a translate is present, both values should be 0 (no centering applied).
          expect(offset.x).toBe(0);
          expect(offset.y).toBe(0);
        }
      }
    });
  });
});
