/**
 * F17 commit 3: the composer regression pin. Michael's on-device report
 * (main feed 1106, via Peri's scene-lab 77 handoff: "sometimes jumps to the
 * MIDDLE of the screen, then back to the bottom on settle") traced through
 * two mechanisms, both closed by commits 1-2: a sticky `position: sticky;
 * bottom: 0` composer, as the last child of a flex column, can only be held
 * by `sticky` as far down as its own containing block's true edge — when
 * scrollY ran unboundedly past maxScroll (commit 1's bug), the composer
 * correctly-but-uselessly followed that overscroll, displacing it visually.
 * Sticky itself was never the problem; an unbounded scroll value was.
 *
 * This is `sticky-webkit-probe3.mjs`'s exact stream shape and sampling
 * methodology (real browser, real WheelEvents, one composer/scene rect
 * sample per real animation frame, throughout both the stream and the
 * settle), promoted from an ad hoc scratchpad probe into a committed
 * regression test against the fixture the report was originally reproduced
 * against (VerticalScrollDemo's CR-1-shaped sticky-footer-stack in
 * ScenePage.tsx).
 *
 * The composer's rendered bottom edge is compared against the SCENE
 * element's own bottom edge (a fixed reference — Scene itself never moves
 * or resizes during a scroll-only gesture) on every sampled frame. A
 * legitimate rubber-band overscroll (scrollY outside [0, maxScroll], per
 * commit 1's own bounded margin) is excluded from the tight tolerance —
 * mirrors the exact `inOverscroll` guard ScenePage.tsx's own device-probe
 * composer tracker (checkComposer) uses, allowing a wider margin there
 * instead of asserting a hard failure, since that displacement is correct,
 * expected physics rather than the bug under test.
 */

import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneColumn, SceneObject } from "../src";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame } from "./utils/animation";

/** Mirrors ScenePage.tsx's VerticalScrollDemo CR-1-shaped fixture exactly:
 * a flex column with minHeight:100cqh wrapping scrollable content plus a
 * position:sticky;bottom:0 composer sibling — the reported chat structure. */
function StickyFooterFixture() {
  return (
    <Scene>
      <SceneColumn name="col">
        <SceneObject name="tall-content" focused style={{ width: 480 }}>
          <div
            data-testid="sticky-footer-stack"
            style={{ display: "flex", flexDirection: "column", minHeight: "100cqh" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }}>
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} style={{ height: 120 }}>
                  Section {i + 1}
                </div>
              ))}
            </div>
            <div
              data-testid="composer"
              style={{
                position: "sticky",
                bottom: 0,
                height: 56,
                background: "red",
                flexShrink: 0,
              }}
            >
              composer
            </div>
          </div>
        </SceneObject>
      </SceneColumn>
    </Scene>
  );
}

/** One sampled frame's composer-vs-scene-edge deviation, classified against
 * commit 1's own legitimate-overscroll boundary. */
interface Sample {
  frame: number;
  deviation: number;
  inOverscroll: boolean;
}

async function driveStreamAndSample(scene: HTMLElement, column: HTMLElement, frames: number): Promise<Sample[]> {
  const composer = scene.querySelector("[data-testid='composer']") as HTMLElement;
  const colRect = column.getBoundingClientRect();
  const x = colRect.left + colRect.width / 2;
  const y = colRect.top + 100;
  const samples: Sample[] = [];

  const sampleOnce = (frame: number) => {
    const off = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    const max = parseFloat(column.getAttribute("data-max-scroll") ?? "0");
    // Mirrors ScenePage.tsx's checkComposer inOverscroll guard exactly.
    const inOverscroll = max > 0 && (off > max || off < 0);
    const sceneBottom = scene.getBoundingClientRect().bottom;
    const composerBottom = composer.getBoundingClientRect().bottom;
    samples.push({ frame, deviation: Math.abs(sceneBottom - composerBottom), inOverscroll });
  };

  // Trackpad-style stream: 2 small wheel events per animation frame,
  // decaying deltas — sticky-webkit-probe3.mjs's exact shape.
  for (let i = 0; i < frames; i++) {
    const d = Math.max(4, 40 - i * 0.5);
    scene.dispatchEvent(
      new WheelEvent("wheel", { deltaY: d, clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );
    scene.dispatchEvent(
      new WheelEvent("wheel", { deltaY: d * 0.8, clientX: x, clientY: y, bubbles: true, cancelable: true }),
    );
    await waitForAnimationFrame();
    sampleOnce(i);
  }

  // Settle watch — probe3 samples through this too (120 frames there;
  // scaled down here since commit 1's bound converges well within that).
  for (let i = 0; i < 60; i++) {
    await waitForAnimationFrame();
    sampleOnce(frames + i);
  }

  return samples;
}

describe("Scene sticky composer — tracks the scene's bottom edge under a real wheel stream (F17 commit 3)", () => {
  test("composer bottom stays within ~2px of the scene's bottom edge on every sampled frame, except during legitimate rubber-band overscroll", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <StickyFooterFixture />
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const maxScroll = parseFloat(column.getAttribute("data-max-scroll") ?? "0");
    expect(maxScroll).toBeGreaterThan(0);

    const samples = await driveStreamAndSample(scene, column, 72);

    // In-bounds frames: composer must track the scene's bottom edge tightly
    // — this is the actual regression pin. A frame-by-frame max (not just
    // an aggregate) so a single bad frame can't hide inside an average.
    const inBoundsSamples = samples.filter((s) => !s.inOverscroll);
    const worstInBoundsDeviation = Math.max(...inBoundsSamples.map((s) => s.deviation));
    expect(worstInBoundsDeviation).toBeLessThan(2);

    // Overscroll frames (if any occurred): still bounded — commit 1's own
    // SPRING_RUBBER_BAND_MARGIN_PX (40px) plus this test's own measured
    // reaction lag, comfortably under the pre-fix failure magnitude
    // (hundreds to thousands of px) — never unbounded.
    const overscrollSamples = samples.filter((s) => s.inOverscroll);
    if (overscrollSamples.length > 0) {
      const worstOverscrollDeviation = Math.max(...overscrollSamples.map((s) => s.deviation));
      expect(worstOverscrollDeviation).toBeLessThan(600);
    }
  });
});
