import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import { Scene, SceneObject } from "@/src";

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

// Spring animations are JS-driven (requestAnimationFrame), not CSS transitions.
// getAnimations() returns nothing for motion springs, so freezeAnimationsAt()
// won't work here. Instead we wait for the spring to fully settle before
// screenshotting. stiffness=120, damping=30 settles in ~500-800ms; 1500ms
// gives a safe buffer across test machine speed variation.
const SPRING_SETTLE_MS = 1500;

function settle() {
  return new Promise<void>((r) => setTimeout(r, SPRING_SETTLE_MS));
}

// ---------------------------------------------------------------------------
// Single focused object
// ---------------------------------------------------------------------------

describe("Scene single focused object", () => {
  it("scene-single-focused-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene>
          <SceneObject name="panel" focused>
            <div style={{ width: 200, height: 150, background: "#334", display: "flex", alignItems: "center", justifyContent: "center", color: "#aac" }}>
              Panel
            </div>
          </SceneObject>
        </Scene>
      </TestWrapper>,
    );
    await settle();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("scene-single-focused-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene>
          <SceneObject name="panel" focused>
            <div style={{ width: 200, height: 150, background: "#dde", display: "flex", alignItems: "center", justifyContent: "center", color: "#446" }}>
              Panel
            </div>
          </SceneObject>
        </Scene>
      </TestWrapper>,
    );
    await settle();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Two objects horizontal — one focused
// ---------------------------------------------------------------------------

describe("Scene two objects horizontal, one focused", () => {
  it("scene-two-horizontal-left-focused-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene>
          <div style={{ display: "flex", gap: 24 }}>
            <SceneObject name="left" focused>
              <div style={{ width: 200, height: 150, background: "#234", display: "flex", alignItems: "center", justifyContent: "center", color: "#9cf" }}>
                Left (focused)
              </div>
            </SceneObject>
            <SceneObject name="right" focused={false}>
              <div style={{ width: 200, height: 150, background: "#342", display: "flex", alignItems: "center", justifyContent: "center", color: "#fc9" }}>
                Right
              </div>
            </SceneObject>
          </div>
        </Scene>
      </TestWrapper>,
    );
    await settle();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("scene-two-horizontal-right-focused-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene>
          <div style={{ display: "flex", gap: 24 }}>
            <SceneObject name="left" focused={false}>
              <div style={{ width: 200, height: 150, background: "#234", display: "flex", alignItems: "center", justifyContent: "center", color: "#9cf" }}>
                Left
              </div>
            </SceneObject>
            <SceneObject name="right" focused>
              <div style={{ width: 200, height: 150, background: "#342", display: "flex", alignItems: "center", justifyContent: "center", color: "#fc9" }}>
                Right (focused)
              </div>
            </SceneObject>
          </div>
        </Scene>
      </TestWrapper>,
    );
    await settle();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Two objects horizontal — both focused
// ---------------------------------------------------------------------------

describe("Scene two objects horizontal, both focused", () => {
  it("scene-two-horizontal-both-focused-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene>
          <div style={{ display: "flex", gap: 24 }}>
            <SceneObject name="left" focused>
              <div style={{ width: 180, height: 130, background: "#234", display: "flex", alignItems: "center", justifyContent: "center", color: "#9cf" }}>
                Left (focused)
              </div>
            </SceneObject>
            <SceneObject name="right" focused>
              <div style={{ width: 180, height: 130, background: "#342", display: "flex", alignItems: "center", justifyContent: "center", color: "#fc9" }}>
                Right (focused)
              </div>
            </SceneObject>
          </div>
        </Scene>
      </TestWrapper>,
    );
    await settle();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// No objects focused — camera frames everything
// ---------------------------------------------------------------------------

describe("Scene no objects focused", () => {
  it("scene-no-focused-frames-all-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene>
          <div style={{ display: "flex", gap: 24 }}>
            <SceneObject name="a" focused={false}>
              <div style={{ width: 160, height: 120, background: "#433", display: "flex", alignItems: "center", justifyContent: "center", color: "#f99" }}>
                Alpha
              </div>
            </SceneObject>
            <SceneObject name="b" focused={false}>
              <div style={{ width: 160, height: 120, background: "#334", display: "flex", alignItems: "center", justifyContent: "center", color: "#99f" }}>
                Beta
              </div>
            </SceneObject>
            <SceneObject name="c" focused={false}>
              <div style={{ width: 160, height: 120, background: "#343", display: "flex", alignItems: "center", justifyContent: "center", color: "#9f9" }}>
                Gamma
              </div>
            </SceneObject>
          </div>
        </Scene>
      </TestWrapper>,
    );
    await settle();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// 2D grid layout — 2×2, bottom-right focused
// ---------------------------------------------------------------------------

describe("Scene 2x2 grid layout", () => {
  it("scene-grid-2x2-bottom-right-focused-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene>
          <div style={{ display: "grid", gridTemplateColumns: "200px 200px", gap: 16 }}>
            <SceneObject name="tl" focused={false}>
              <div style={{ width: 200, height: 140, background: "#433", display: "flex", alignItems: "center", justifyContent: "center", color: "#f99" }}>
                Top-Left
              </div>
            </SceneObject>
            <SceneObject name="tr" focused={false}>
              <div style={{ width: 200, height: 140, background: "#334", display: "flex", alignItems: "center", justifyContent: "center", color: "#99f" }}>
                Top-Right
              </div>
            </SceneObject>
            <SceneObject name="bl" focused={false}>
              <div style={{ width: 200, height: 140, background: "#343", display: "flex", alignItems: "center", justifyContent: "center", color: "#9f9" }}>
                Bottom-Left
              </div>
            </SceneObject>
            <SceneObject name="br" focused>
              <div style={{ width: 200, height: 140, background: "#443", display: "flex", alignItems: "center", justifyContent: "center", color: "#ff9" }}>
                Bottom-Right (focused)
              </div>
            </SceneObject>
          </div>
        </Scene>
      </TestWrapper>,
    );
    await settle();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Asymmetric sizes — small focused next to large unfocused
// ---------------------------------------------------------------------------

describe("Scene asymmetric sizes", () => {
  it("scene-asymmetric-small-focused-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
            <SceneObject name="small" focused>
              <div style={{ width: 100, height: 80, background: "#533", display: "flex", alignItems: "center", justifyContent: "center", color: "#f99" }}>
                Small (focused)
              </div>
            </SceneObject>
            <SceneObject name="large" focused={false}>
              <div style={{ width: 350, height: 280, background: "#335", display: "flex", alignItems: "center", justifyContent: "center", color: "#99f" }}>
                Large
              </div>
            </SceneObject>
          </div>
        </Scene>
      </TestWrapper>,
    );
    await settle();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Padding prop — focused object with padding=32
// ---------------------------------------------------------------------------

describe("Scene padding prop", () => {
  it("scene-padding-32-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene padding={32}>
          <SceneObject name="panel" focused>
            <div style={{ width: 200, height: 150, background: "#344", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ff" }}>
              Padded (focused)
            </div>
          </SceneObject>
        </Scene>
      </TestWrapper>,
    );
    await settle();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("scene-padding-32-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene padding={32}>
          <SceneObject name="panel" focused>
            <div style={{ width: 200, height: 150, background: "#cee", display: "flex", alignItems: "center", justifyContent: "center", color: "#266" }}>
              Padded (focused)
            </div>
          </SceneObject>
        </Scene>
      </TestWrapper>,
    );
    await settle();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Unfocused objects remain visible outside the camera viewport
// ---------------------------------------------------------------------------

describe("Scene unfocused objects visible outside viewport", () => {
  it("scene-unfocused-overflow-visible-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    // The Camera sets overflow:visible on its motion.div, so unfocused objects
    // placed outside the camera bounds should still render in the screenshot.
    const screen = await render(
      <TestWrapper fullPage>
        <Scene>
          <div style={{ display: "flex", gap: 32 }}>
            <SceneObject name="focused" focused>
              <div style={{ width: 160, height: 120, background: "#234", display: "flex", alignItems: "center", justifyContent: "center", color: "#9cf" }}>
                Focused
              </div>
            </SceneObject>
            <SceneObject name="unfocused-a" focused={false}>
              <div style={{ width: 160, height: 120, background: "#432", display: "flex", alignItems: "center", justifyContent: "center", color: "#f96" }}>
                Unfocused A
              </div>
            </SceneObject>
            <SceneObject name="unfocused-b" focused={false}>
              <div style={{ width: 160, height: 120, background: "#342", display: "flex", alignItems: "center", justifyContent: "center", color: "#9f6" }}>
                Unfocused B
              </div>
            </SceneObject>
          </div>
        </Scene>
      </TestWrapper>,
    );
    await settle();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});
