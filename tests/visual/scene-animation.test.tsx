/**
 * Animation mid-frame capture tests.
 *
 * These tests validate that we can reliably capture mid-spring frames during
 * Scene transitions. Each test probes a different animation path:
 *
 * 1. Focus → unfocus: Column opacity + translateX (WAAPI) — can be frozen
 *    deterministically with freezeAnimationsAt().
 *
 * 2. Camera pan: Stage `left` spring (rAF-based, not WAAPI) — captured via
 *    wait(). Non-deterministic; used to diagnose clipping bug during panning.
 *
 * 3. Layout FLIP: motion's layout FLIP (WAAPI) — frozen at 50% with
 *    freezeAnimationsAt() for a precise deterministic frame.
 *
 * Key finding: motion/react uses WAAPI for `opacity`, `transform`, and other
 * accelerated values. Direct CSS property springs (`left`, `top`) use rAF.
 * WAAPI animations can be reliably frozen; rAF-based animations cannot.
 *
 * Default spring: stiffness=300, damping=30.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import { Scene, SceneColumn, SceneObject } from "@/src";
import {
  wait,
  animationScreenshotOptions,
  waitForAnimationFrame,
  freezeAnimationsAt,
  unfreezeAnimations,
} from "../utils/animation";

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

// ---------------------------------------------------------------------------
// 1: Focus → unfocus (WAAPI opacity + transform)
//
// When a column becomes unfocused it slides offscreen and fades. These
// transitions use WAAPI (opacity and transform are accelerated values in
// motion/react), so freezeAnimationsAt() can pause them at a precise frame.
// ---------------------------------------------------------------------------

describe("mid-animation capture (focus → unfocus)", () => {
  it("focus-to-unfocus-settled-start", async () => {
    // Baseline: fully focused column — start state with duration=0.
    document.documentElement.style.colorScheme = "dark";
    const { container } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="content">
            <SceneObject name="panel" focused>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(99,102,241,0.5)",
                  border: "2px solid rgba(99,102,241,0.9)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 16,
                }}
              >
                Focused Panel
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();
    await expect.element(page.elementLocator(container)).toMatchScreenshot();
  });

  it("focus-to-unfocus-frozen-at-50pct", async () => {
    // Start focused (with duration=0 so the initial render is instant), then
    // trigger the spring by removing duration — the unfocus uses default springs.
    // Freeze WAAPI animations at 50% to capture a deterministic mid-frame.
    //
    // motion/react uses WAAPI for opacity and transform (both accelerated values),
    // so freezeAnimationsAt() should pause the fade-out and slide mid-way.
    document.documentElement.style.colorScheme = "dark";
    const { container, rerender } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="content">
            <SceneObject name="panel" focused>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(99,102,241,0.5)",
                  border: "2px solid rgba(99,102,241,0.9)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 16,
                }}
              >
                Focused Panel
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Switch to unfocused with default spring physics — WAAPI animations start.
    await rerender(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="content">
            <SceneObject name="panel" focused={false}>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(99,102,241,0.5)",
                  border: "2px solid rgba(99,102,241,0.9)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 16,
                }}
              >
                Focused Panel
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // One frame so WAAPI animations are registered in getAnimations().
    await waitForAnimationFrame();

    // Freeze all WAAPI animations at 50% progress. For opacity and transform
    // (which are accelerated), this pauses them at a precise mid-frame.
    const frozen = freezeAnimationsAt(container as HTMLElement, 0.5, { subtree: true });

    await expect.element(page.elementLocator(container)).toMatchScreenshot(
      "focus-to-unfocus-frozen-at-50pct",
      { ...animationScreenshotOptions, maxDiffPixelRatio: 0.005 },
    );

    unfreezeAnimations(frozen);
  });

  it("focus-to-unfocus-mid-spring-wait", async () => {
    // Alternative: timed wait to catch the spring mid-flight.
    // This is less deterministic than freezeAnimationsAt() because rAF-based
    // animations (like `left`) vary slightly between runs under CPU load.
    document.documentElement.style.colorScheme = "dark";
    const { container, rerender } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="content">
            <SceneObject name="panel" focused>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(99,102,241,0.5)",
                  border: "2px solid rgba(99,102,241,0.9)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 16,
                }}
              >
                Focused Panel
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Switch to unfocused — slow-mo spring animation begins (~800ms to settle).
    await rerender(
      <TestWrapper fullPage>
        <Scene slowMo>
          <SceneColumn name="content">
            <SceneObject name="panel" focused={false}>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(99,102,241,0.5)",
                  border: "2px solid rgba(99,102,241,0.9)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 16,
                }}
              >
                Focused Panel
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Wait 250ms — ~30% through the slow-mo spring, clearly mid-slide.
    await wait(250);

    // Tighter tolerance because slower springs produce less jitter between frames.
    await expect.element(page.elementLocator(container)).toMatchScreenshot(
      "focus-to-unfocus-mid-spring-wait",
      { ...animationScreenshotOptions, maxDiffPixelRatio: 0.01 },
    );
  });
});

// ---------------------------------------------------------------------------
// 2: Camera pan mid-capture
//
// Two columns focused, then Nav unfocuses — Camera spring-pans to recenter on
// Article only. The stage `left` property is animated via rAF (not WAAPI),
// so freezeAnimationsAt() won't work — only wait() is available.
//
// This is the exact scenario where we saw Article content clipping during the
// Camera pan. This test captures the mid-pan state to help diagnose and verify
// fixes for that clipping bug.
// ---------------------------------------------------------------------------

describe("camera pan mid-capture", () => {
  it("camera-pan-settled-both-focused", async () => {
    // Baseline: both Nav and Article focused — stage centered on both.
    document.documentElement.style.colorScheme = "dark";
    const { container } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="nav-panel" focused>
              <div
                style={{
                  width: 160,
                  height: 300,
                  background: "rgba(244,114,182,0.4)",
                  border: "2px solid rgba(244,114,182,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Nav
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="article">
            <SceneObject name="article-panel" focused>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(52,211,153,0.4)",
                  border: "2px solid rgba(52,211,153,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Article
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();
    await expect.element(page.elementLocator(container)).toMatchScreenshot();
  });

  it("camera-pan-mid-spring", async () => {
    // Start with both focused (duration=0 for instant initial layout), then
    // unfocus Nav using default spring so the Camera pans to recenter Article.
    // The `left` spring on the stage is rAF-based — wait() is the only capture
    // strategy available. High tolerance accommodates frame-timing variance.
    document.documentElement.style.colorScheme = "dark";
    const { container, rerender } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="nav">
            <SceneObject name="nav-panel" focused>
              <div
                style={{
                  width: 160,
                  height: 300,
                  background: "rgba(244,114,182,0.4)",
                  border: "2px solid rgba(244,114,182,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Nav
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="article">
            <SceneObject name="article-panel" focused>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(52,211,153,0.4)",
                  border: "2px solid rgba(52,211,153,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Article
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Unfocus Nav with slow-mo spring physics — stage left springs rightward (~800ms to settle).
    await rerender(
      <TestWrapper fullPage>
        <Scene slowMo>
          <SceneColumn name="nav">
            <SceneObject name="nav-panel" focused={false}>
              <div
                style={{
                  width: 160,
                  height: 300,
                  background: "rgba(244,114,182,0.4)",
                  border: "2px solid rgba(244,114,182,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Nav
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="article">
            <SceneObject name="article-panel" focused>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(52,211,153,0.4)",
                  border: "2px solid rgba(52,211,153,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Article
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Wait 250ms — ~30% through the slow-mo spring, clearly mid-pan. Also exposes
    // the Article clipping bug: content may be clipped on the left/top/bottom
    // during the pan because preserve-3d + translateZ creates an implicit stacking
    // context that clips overflow.
    await wait(250);

    // Looser tolerance than WAAPI tests — rAF-based `left` spring still has
    // some frame-timing variance even with slow-mo springs.
    await expect.element(page.elementLocator(container)).toMatchScreenshot(
      "camera-pan-mid-spring",
      { ...animationScreenshotOptions, maxDiffPixelRatio: 0.05 },
    );
  });
});

// ---------------------------------------------------------------------------
// 3: Layout FLIP mid-capture (unfocused → focused)
//
// A column starts unfocused (out of flex flow, frozen dimensions), then gets
// focused (enters flex flow with motion's layout FLIP). motion's layout
// animations use WAAPI internally, so freezeAnimationsAt() can pause them at
// a precise frame for a deterministic screenshot.
// ---------------------------------------------------------------------------

describe("layout FLIP mid-capture (unfocused → focused)", () => {
  it("layout-flip-settled-unfocused", async () => {
    // Baseline: the column is unfocused — out of flex flow, frozen size.
    document.documentElement.style.colorScheme = "dark";
    const { container } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="content">
            <SceneObject name="panel" focused={false}>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(251,191,36,0.4)",
                  border: "2px solid rgba(251,191,36,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Unfocused Panel
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();
    await expect.element(page.elementLocator(container)).toMatchScreenshot();
  });

  it("layout-flip-frozen-at-50pct", async () => {
    // Start unfocused (duration=0), then focus with default spring. motion's
    // layout FLIP uses WAAPI for the positional correction, so we can freeze
    // it at 50% for a deterministic mid-FLIP screenshot.
    document.documentElement.style.colorScheme = "dark";
    const { container, rerender } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="content">
            <SceneObject name="panel" focused={false}>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(251,191,36,0.4)",
                  border: "2px solid rgba(251,191,36,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Panel (was unfocused)
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Focus the column with default spring — FLIP animation starts.
    await rerender(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="content">
            <SceneObject name="panel" focused>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(251,191,36,0.4)",
                  border: "2px solid rgba(251,191,36,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Panel (now focused)
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // One frame so WAAPI animations appear in getAnimations().
    await waitForAnimationFrame();

    // Freeze all WAAPI animations at 50% — captures the FLIP correction mid-way.
    // If motion's layout FLIP uses WAAPI for this transition, the panel will
    // appear halfway through its positional correction (between off-screen and
    // centered). If no WAAPI animations are found, frozen is empty and the
    // screenshot shows the fully-settled state — that's a finding too.
    const frozen = freezeAnimationsAt(container as HTMLElement, 0.5, { subtree: true });

    await expect.element(page.elementLocator(container)).toMatchScreenshot(
      "layout-flip-frozen-at-50pct",
      { ...animationScreenshotOptions, maxDiffPixelRatio: 0.005 },
    );

    unfreezeAnimations(frozen);
  });

  it("layout-flip-mid-spring-wait", async () => {
    // Alternative timed-wait approach for comparison. Captures the FLIP
    // animation at ~100ms using only wait() — useful to see how the rAF-based
    // portion of the transition (e.g. spring overshoot) looks at that moment.
    document.documentElement.style.colorScheme = "dark";
    const { container, rerender } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="content">
            <SceneObject name="panel" focused={false}>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(251,191,36,0.4)",
                  border: "2px solid rgba(251,191,36,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Panel (was unfocused)
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Focus the column — slow-mo FLIP animation begins (~800ms to settle).
    await rerender(
      <TestWrapper fullPage>
        <Scene slowMo>
          <SceneColumn name="content">
            <SceneObject name="panel" focused>
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: "rgba(251,191,36,0.4)",
                  border: "2px solid rgba(251,191,36,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: 14,
                }}
              >
                Panel (now focused)
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Wait 250ms — ~30% through the slow-mo spring, clearly mid-FLIP.
    await wait(250);

    // Tighter tolerance because slower springs produce less jitter between frames.
    await expect.element(page.elementLocator(container)).toMatchScreenshot(
      "layout-flip-mid-spring-wait",
      { ...animationScreenshotOptions, maxDiffPixelRatio: 0.01 },
    );
  });
});
