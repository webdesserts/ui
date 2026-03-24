import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import { Scene, SceneObject, SceneColumn } from "@/src";

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

// ---------------------------------------------------------------------------
// Single focused object
// ---------------------------------------------------------------------------

describe("Scene single focused object", () => {
  it("scene-single-focused-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneObject name="panel" focused>
            <div style={{ width: 200, height: 150, background: "#334", display: "flex", alignItems: "center", justifyContent: "center", color: "#aac" }}>
              Panel
            </div>
          </SceneObject>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("scene-single-focused-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneObject name="panel" focused>
            <div style={{ width: 200, height: 150, background: "#dde", display: "flex", alignItems: "center", justifyContent: "center", color: "#446" }}>
              Panel
            </div>
          </SceneObject>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Two focused objects side by side
// ---------------------------------------------------------------------------

describe("Scene two focused objects", () => {
  it("scene-two-focused-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneObject name="left" focused>
            <div style={{ width: 200, height: 150, background: "#234", display: "flex", alignItems: "center", justifyContent: "center", color: "#9cf" }}>
              Left (focused)
            </div>
          </SceneObject>
          <SceneObject name="right" focused>
            <div style={{ width: 200, height: 150, background: "#342", display: "flex", alignItems: "center", justifyContent: "center", color: "#fc9" }}>
              Right (focused)
            </div>
          </SceneObject>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// One focused, one unfocused
// ---------------------------------------------------------------------------

describe("Scene one focused one unfocused", () => {
  it("scene-one-focused-one-unfocused-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    // The unfocused object was never focused, so it is hidden (opacity: 0) and
    // absolutely positioned outside the flex flow.
    const screen = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneObject name="focused" focused>
            <div style={{ width: 200, height: 150, background: "#234", display: "flex", alignItems: "center", justifyContent: "center", color: "#9cf" }}>
              Focused
            </div>
          </SceneObject>
          <SceneObject name="unfocused" focused={false}>
            <div style={{ width: 200, height: 150, background: "#432", display: "flex", alignItems: "center", justifyContent: "center", color: "#f96" }}>
              Unfocused
            </div>
          </SceneObject>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// SceneColumn layout
// ---------------------------------------------------------------------------

describe("SceneColumn — single focused column", () => {
  it("scene-column-single-focused-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj" focused>
              <div style={{ width: 240, height: 160, background: "#234", display: "flex", alignItems: "center", justifyContent: "center", color: "#9cf" }}>
                Column A (focused)
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

describe("SceneColumn — two columns side by side", () => {
  it("scene-column-two-focused-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    // Both columns are focused, so they share horizontal space in a flex row.
    const screen = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused>
              <div style={{ width: 200, height: 160, background: "#234", display: "flex", alignItems: "center", justifyContent: "center", color: "#9cf" }}>
                Left column
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-obj" focused>
              <div style={{ width: 200, height: 160, background: "#342", display: "flex", alignItems: "center", justifyContent: "center", color: "#fc9" }}>
                Right column
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

describe("SceneColumn — vertical swap result", () => {
  it("scene-column-swap-result-dark", async () => {
    document.documentElement.style.colorScheme = "dark";

    // Render with the first child focused, then swap to the second. With
    // duration={0} the swap is instant — no animation phases fire, so the
    // screenshot captures the post-swap settled state immediately.
    function SwappableColumn({ focused }: { focused: "first" | "second" }) {
      return (
        <TestWrapper fullPage>
          <Scene duration={0}>
            <SceneColumn name="col">
              <SceneObject name="first" focused={focused === "first"}>
                <div style={{ width: 240, height: 120, background: "#234", display: "flex", alignItems: "center", justifyContent: "center", color: "#9cf" }}>
                  First
                </div>
              </SceneObject>
              <SceneObject name="second" focused={focused === "second"}>
                <div style={{ width: 240, height: 120, background: "#432", display: "flex", alignItems: "center", justifyContent: "center", color: "#f96" }}>
                  Second
                </div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const screen = await render(<SwappableColumn focused="first" />);
    // Swap to the second child — instant with duration={0}.
    await screen.rerender(<SwappableColumn focused="second" />);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});
