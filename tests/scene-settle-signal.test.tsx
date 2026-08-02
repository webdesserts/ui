import { describe, test, expect } from "vitest";
import { useState } from "react";
import { render } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame, waitForAnimationsToSettle, wait } from "./utils/animation";

// ---------------------------------------------------------------------------
// data-scene-settled (criterion 1)
// ---------------------------------------------------------------------------

describe("data-scene-settled", () => {
  test("is true at rest, nothing ever having animated", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj" focused>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    expect(scene.getAttribute("data-scene-settled")).toBe("true");
  });

  test("flips false while a focus-triggered owned channel is mid-transition, true again once settled", async () => {
    // Two columns, not two objects in one column: a within-column swap
    // between exactly two (never-sandwiched) siblings is a settle-signal
    // no-op — neither object's own geometry channel ever engages (see
    // SceneObject's wasEverSandwichedRef) — so this needs the column-level
    // width/margin/camera-pan channels a cross-column focus swap reliably
    // engages instead.
    function Harness() {
      const [focused, setFocused] = useState<"left" | "right">("left");
      return (
        <Scene>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused={focused === "left"}>
              <div data-testid="content-left" style={{ width: 300, height: 200 }}>
                left
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-obj" focused={focused === "right"}>
              <div data-testid="content-right" style={{ width: 300, height: 200 }}>
                right
              </div>
            </SceneObject>
          </SceneColumn>
          <button data-testid="focus-right" onClick={() => setFocused("right")}>
            focus right
          </button>
        </Scene>
      );
    }

    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Harness />
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    await wait(1000);
    expect(scene.getAttribute("data-scene-settled")).toBe("true");

    getByTestId("focus-right").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForAnimationFrame();
    expect(scene.getAttribute("data-scene-settled")).toBe("false");

    await wait(1000);
    expect(scene.getAttribute("data-scene-settled")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// onTransitionEnd (criterion 8)
// ---------------------------------------------------------------------------

describe("onTransitionEnd", () => {
  test("does not fire on pure-entrance settle (initial mount, no focus change)", async () => {
    const fired: unknown[] = [];
    await render(
      <TestWrapper>
        <Scene duration={0} onTransitionEnd={(arrangement) => fired.push(arrangement)}>
          <SceneColumn name="col">
            <SceneObject name="obj" focused>
              <div data-testid="content">content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    expect(fired.length).toBe(0);
  });

  test("fires exactly once after a settled focus transition with the settled arrangement", async () => {
    const fired: Array<Array<{ name: string; focused: boolean }>> = [];

    function Harness() {
      const [focused, setFocused] = useState<"left" | "right">("left");
      return (
        <Scene onTransitionEnd={(arrangement) => fired.push(arrangement)}>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused={focused === "left"}>
              <div data-testid="content-left" style={{ width: 300, height: 200 }}>
                left
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-obj" focused={focused === "right"}>
              <div data-testid="content-right" style={{ width: 300, height: 200 }}>
                right
              </div>
            </SceneObject>
          </SceneColumn>
          <button data-testid="focus-right" onClick={() => setFocused("right")}>
            focus right
          </button>
        </Scene>
      );
    }

    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Harness />
      </TestWrapper>,
    );
    await wait(1000);
    expect(fired.length).toBe(0);

    getByTestId("focus-right").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await wait(1500);

    expect(fired.length).toBe(1);
    const arrangement = fired[0]!;
    const left = arrangement.find((o) => o.name === "left-obj");
    const right = arrangement.find((o) => o.name === "right-obj");
    expect(left?.focused).toBe(false);
    expect(right?.focused).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inertness gating (criteria 3/4/9)
// ---------------------------------------------------------------------------

describe("transition-scoped inertness", () => {
  test("settled-unfocused object's content stays inert; already-focused object click is a no-op", async () => {
    let activateCount = 0;

    function Harness() {
      const [focused, setFocused] = useState<"a" | "b">("a");
      return (
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject
              name="a"
              focused={focused === "a"}
              onActivate={() => {
                activateCount++;
                setFocused("a");
              }}
            >
              <div data-testid="content-a">a</div>
            </SceneObject>
            <SceneObject name="b" focused={focused === "b"} onActivate={() => setFocused("b")}>
              <button data-testid="content-b-btn">b button</button>
            </SceneObject>
          </SceneColumn>
        </Scene>
      );
    }

    const { getByTestId } = await render(
      <TestWrapper>
        <Harness />
      </TestWrapper>,
    );

    const contentB = getByTestId("content-b-btn").element() as HTMLElement;
    const objectA = getByTestId("content-a").element().closest("[data-scene-id]") as HTMLElement;

    // b is settled-unfocused: its content stays inert.
    const bInnerWrapper = contentB.parentElement as HTMLElement;
    expect(bInnerWrapper.hasAttribute("inert")).toBe(true);

    // a is already focused — clicking it is a no-op path (onClick is undefined
    // once focused, per the existing `!focused ? onActivate : undefined` gate).
    objectA.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForAnimationFrame();
    expect(activateCount).toBe(0);
  });
});
