import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import { Scene, SceneObject } from "@/src";

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
