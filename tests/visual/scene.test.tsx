import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import { Scene, SceneColumn, SceneObject } from "@/src";

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

// ---------------------------------------------------------------------------
// Phase 1: Flex layout visual tests
// ---------------------------------------------------------------------------

describe("Scene flex layout", () => {
  it("scene-single-focused-column", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="content">
            <SceneObject name="panel" focused>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(99,102,241,0.3)",
                  border: "1px solid rgba(99,102,241,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                }}
              >
                Focused Panel
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("scene-two-focused-columns-side-by-side", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="left">
            <SceneObject name="left-panel" focused>
              <div
                style={{
                  height: 300,
                  background: "rgba(99,102,241,0.3)",
                  border: "1px solid rgba(99,102,241,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                }}
              >
                Left Panel
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-panel" focused>
              <div
                style={{
                  height: 300,
                  background: "rgba(244,114,182,0.3)",
                  border: "1px solid rgba(244,114,182,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                }}
              >
                Right Panel
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("scene-one-focused-one-unfocused", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="visible">
            <SceneObject name="visible-panel" focused>
              <div
                style={{
                  height: 300,
                  background: "rgba(99,102,241,0.3)",
                  border: "1px solid rgba(99,102,241,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                }}
              >
                Focused (Visible)
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="hidden">
            <SceneObject name="hidden-panel" focused={false}>
              <div
                style={{
                  height: 300,
                  background: "rgba(244,114,182,0.3)",
                  border: "1px solid rgba(244,114,182,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                }}
              >
                Unfocused (Hidden)
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Phase 2: Vertical swap and multi-focus visual tests
// ---------------------------------------------------------------------------

describe("Scene vertical swap and multi-focus", () => {
  it("scene-vertical-swap-post-swap", async () => {
    // Shows a column after a vertical swap: object B is focused, object A is
    // out of flow. The column slides to show B at the top.
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="content">
            <SceneObject name="obj-a" focused={false}>
              <div
                style={{
                  width: 400,
                  height: 200,
                  background: "rgba(99,102,241,0.3)",
                  border: "1px solid rgba(99,102,241,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                }}
              >
                Object A (unfocused)
              </div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div
                style={{
                  width: 400,
                  height: 200,
                  background: "rgba(244,114,182,0.3)",
                  border: "1px solid rgba(244,114,182,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                }}
              >
                Object B (focused — visible)
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("scene-multi-focus-stacking", async () => {
    // Shows two focused objects stacked vertically in the same column.
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="content">
            <SceneObject name="obj-a" focused>
              <div
                style={{
                  width: 400,
                  height: 200,
                  background: "rgba(99,102,241,0.3)",
                  border: "1px solid rgba(99,102,241,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                }}
              >
                Object A (focused)
              </div>
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div
                style={{
                  width: 400,
                  height: 200,
                  background: "rgba(244,114,182,0.3)",
                  border: "1px solid rgba(244,114,182,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                }}
              >
                Object B (focused)
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Phase 2: 3D depth deck visual tests
// ---------------------------------------------------------------------------

describe("Scene depth deck", () => {
  it("scene-depth-deck-3d-perspective", async () => {
    // Two focused outer columns, two unfocused in-between columns stacked in the
    // depth deck. The perspective + translateZ effect should make the stacked
    // columns appear smaller and receding. The greyscale filter visually
    // reinforces the depth.
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="left">
            <SceneObject name="left-panel" focused>
              <div
                style={{
                  width: 200,
                  height: 300,
                  background: "rgba(99,102,241,0.3)",
                  border: "1px solid rgba(99,102,241,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Left (focused)
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="middle1">
            <SceneObject name="middle1-panel" focused={false}>
              <div
                style={{
                  width: 200,
                  height: 300,
                  background: "rgba(244,114,182,0.3)",
                  border: "1px solid rgba(244,114,182,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Middle 1 (depth-2)
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="middle2">
            <SceneObject name="middle2-panel" focused={false}>
              <div
                style={{
                  width: 200,
                  height: 300,
                  background: "rgba(52,211,153,0.3)",
                  border: "1px solid rgba(52,211,153,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Middle 2 (depth-1)
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-panel" focused>
              <div
                style={{
                  width: 200,
                  height: 300,
                  background: "rgba(251,191,36,0.3)",
                  border: "1px solid rgba(251,191,36,0.6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Right (focused)
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});
