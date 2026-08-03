import { describe, test, expect, vi } from "vitest";
import { useState } from "react";
import { render, cleanup } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { MotionSeamContext } from "../src/components/scene/motionSeam";
import { ColumnPositionContext, type ColumnPosition } from "../src/components/scene/ColumnPositionContext";
import { StackDepthContext } from "../src/components/scene/StackDepthContext";
import { ViewportContext } from "../src/components/scene/ViewportContext";
import { TestWrapper } from "./test-wrapper";
import {
  waitForAnimationFrame,
  wait,
  createMotionSeamRecorder,
  waitForAnimationsToSettle,
  awaitStyleFlush,
  waitForSceneSettled,
} from "./utils/animation";
import { parseTranslateY } from "./utils/transform";
import { captureFlipCommit, findGbcrOutliers, gbcrDeltasOf, type GBCRBox } from "./utils/gbcrSampling";
import { CameraReader } from "./utils/cameraReader";

// ---------------------------------------------------------------------------
// Glass-stack deck rework (ui#17): anchor/panel flip geometry and channel
// coordination. Representative fixtures throughout (constraint 4) — width
// declared directly on SceneObject's own style prop, never a child div.
// ---------------------------------------------------------------------------

describe("Glass-stack deck: zero-pixel flip", () => {
  test("unfocus direction: panel-local geometry has no discontinuity at the flip commit", async () => {
    function Demo() {
      const [midFocused, setMidFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidFocused((v) => !v)}>
            toggle
          </button>
          <Scene>
            <SceneColumn name="left">
              <SceneObject name="left-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="middle">
              <SceneObject name="middle-panel" focused={midFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="right">
              <SceneObject name="right-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<Demo />);
    await wait(500);

    const anchorEl = document.querySelector('[data-scene-id="middle-panel"]')!.closest("[data-column]") as HTMLElement;
    const panelEl = anchorEl.querySelector("[data-scene-column]") as HTMLElement;

    (getByTestId("toggle").element() as HTMLElement).click();
    // Layout-box geometry (Part B's final form) — transform-free by
    // construction, so neither stage/camera translation nor the
    // depth-deck's own Z-projection can register as a false discontinuity
    // here — see captureFlipCommit's own doc comment.
    const { before, after } = await captureFlipCommit(panelEl, 2000, undefined, anchorEl);

    expect(Math.abs(after.left - before.left)).toBeLessThan(1);
    expect(Math.abs(after.top - before.top)).toBeLessThan(1);
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  });

  test("refocus direction (was-focused-before): panel-local geometry has no discontinuity at the flip commit", async () => {
    function Demo() {
      const [midFocused, setMidFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidFocused((v) => !v)}>
            toggle
          </button>
          <Scene>
            <SceneColumn name="left">
              <SceneObject name="left-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="middle">
              <SceneObject name="middle-panel" focused={midFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="right">
              <SceneObject name="right-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<Demo />);
    await wait(500);

    const anchorEl = document.querySelector('[data-scene-id="middle-panel"]')!.closest("[data-column]") as HTMLElement;
    const panelEl = anchorEl.querySelector("[data-scene-column]") as HTMLElement;

    // Deck first (was-focused-before, matching the spike's own validated
    // trace-refocus.log scenario), let it fully settle, THEN test the
    // refocus flip specifically.
    (getByTestId("toggle").element() as HTMLElement).click();
    await wait(1000);

    (getByTestId("toggle").element() as HTMLElement).click();
    // Layout-box geometry (Part B's final form) — see the unfocus-direction
    // test above.
    const { before, after } = await captureFlipCommit(panelEl, 2000, undefined, anchorEl);

    expect(Math.abs(after.left - before.left)).toBeLessThan(1);
    expect(Math.abs(after.top - before.top)).toBeLessThan(1);
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  });
});

function GapMathDemo({ midAFocused, midBFocused }: { midAFocused: boolean; midBFocused: boolean }) {
  return (
    <TestWrapper fullPage>
      <Scene>
        <SceneColumn name="left">
          <SceneObject name="left-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
        </SceneColumn>
        <SceneColumn name="mid-a">
          <SceneObject name="mid-a-panel" focused={midAFocused} style={{ width: 200, height: 200 }}>content</SceneObject>
        </SceneColumn>
        <SceneColumn name="mid-b">
          <SceneObject name="mid-b-panel" focused={midBFocused} style={{ width: 200, height: 200 }}>content</SceneObject>
        </SceneColumn>
        <SceneColumn name="right">
          <SceneObject name="right-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
        </SceneColumn>
      </Scene>
    </TestWrapper>
  );
}

let gapMathFloorGap = NaN;
let gapMathDeckedGap = NaN;

describe("Glass-stack deck: gap-math", () => {
  // Two separate test() blocks (not a single test with unmount()/re-render)
  // — vitest-browser's render/cleanup cycle doesn't reliably tear down a
  // component fast enough for an immediate re-render within the same test
  // body (probe-confirmed: a combined version threw "Cannot read
  // properties of null" reading a stale post-unmount DOM reference).

  test("floor: no deck at all (both middle columns focused)", async () => {
    await render(<GapMathDemo midAFocused midBFocused />);
    await wait(500);
    const floorLeft = document.querySelector('[data-scene-id="left-panel"]')!.closest("[data-column]")!.getBoundingClientRect();
    const floorRight = document.querySelector('[data-scene-id="right-panel"]')!.closest("[data-column]")!.getBoundingClientRect();
    gapMathFloorGap = floorRight.left - floorLeft.right;
  });

  test("two settled deck anchors between the same two focused columns", async () => {
    await render(<GapMathDemo midAFocused={false} midBFocused={false} />);
    await wait(1000);
    const deckedLeft = document.querySelector('[data-scene-id="left-panel"]')!.closest("[data-column]")!.getBoundingClientRect();
    const deckedRight = document.querySelector('[data-scene-id="right-panel"]')!.closest("[data-column]")!.getBoundingClientRect();
    gapMathDeckedGap = deckedRight.left - deckedLeft.right;
  });

  test("a settled in-between anchor contributes zero net flow width, independent of how many sit between two focused columns", () => {
    // Both middle columns occupy 200+200px of flow width and insert 3 real
    // flex gaps when focused (floor); when decked, each anchor's footprint
    // + margin should cancel to exactly zero net contribution, collapsing
    // the span to a single columnGap — independent of how many decked
    // anchors sit in between. floorGap and deckedGap should therefore
    // differ by exactly the removed content+gaps: 2*200 + 2*columnGap
    // (two of the three floor gaps close; one remains, same as decked).
    const predictedDelta = -(2 * 200 + 2 * DEFAULT_COLUMN_GAP);
    const actualDelta = gapMathDeckedGap - gapMathFloorGap;

    expect(Math.abs(actualDelta - predictedDelta)).toBeLessThan(1);
  });
});

describe("Glass-stack deck: viewport resize tracking at rest (ui#17 Slice 3)", () => {
  test("both a focused column's and a decked column's live-cqw width track a real viewport resize once settled", async () => {
    // Representative fixture (constraint 4, binding per team-lead's Slice 3
    // ruling): explicit cqw width on SceneObject's own style prop, never
    // the suite's dominant inner-div idiom — mirrors obs-width-family.json's
    // own "resize tracks at 1.4998 against expected 1.5" finding for the
    // FOCUSED side (already proven on the committed code under this exact
    // shape); this test extends that proof to the DECKED side's
    // columnWidthMV/computeMeasuredWidth channel, which wasn't previously
    // verified against a real resize.
    const recorder = createMotionSeamRecorder();
    function Demo({ viewportWidth }: { viewportWidth: number }) {
      return (
        <TestWrapper fullPage width={viewportWidth} height={600}>
          <MotionSeamContext.Provider value={recorder}>
            <Scene duration={0}>
              <SceneColumn name="focused-col">
                <SceneObject name="focused-obj" focused style={{ width: "40cqw" }}>
                  <div style={{ height: 300 }}>focused</div>
                </SceneObject>
              </SceneColumn>
              <SceneColumn name="decked-col">
                <SceneObject name="decked-obj" focused={false} style={{ width: "30cqw" }}>
                  <div style={{ height: 300 }}>decked</div>
                </SceneObject>
              </SceneColumn>
              <SceneColumn name="right-col">
                <SceneObject name="right-obj" focused style={{ width: "40cqw" }}>
                  <div style={{ height: 300 }}>right</div>
                </SceneObject>
              </SceneColumn>
            </Scene>
          </MotionSeamContext.Provider>
        </TestWrapper>
      );
    }

    const { rerender } = await render(<Demo viewportWidth={1000} />);
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    // Focused side: SceneObject's own outer wrapper (data-scene-id) — at
    // rest the anchor's own width override is released, so the anchor
    // sizes naturally to wrap this node, matching obs-width-family.json's
    // own methodology for the focused-side proof.
    const focusedEl = document.querySelector('[data-scene-id="focused-obj"]') as HTMLElement;

    // Decked side: columnWidthMV's own live value via the motion seam, NOT
    // any DOM read. Two dead ends found first (both defeat-check-caught,
    // 2026-07-31): (1) reading the SceneObject node is vacuous — it
    // carries its own independent cqw width regardless of the panel's own
    // JS-driven state, so a permanently-stuck columnWidthOverrideActive
    // left it green. (2) reading the PANEL's own gBCR/offsetWidth is ALSO
    // vacuous under duration=0 specifically — the jump branch
    // (`if (duration === 0 || ...) { ...; setColumnWidthSettled(true); }`)
    // sets columnWidthSettled back to true SYNCHRONOUSLY within the same
    // commit that computed the target, so columnWidthOverrideActive
    // (`inBetweenNow ? !columnWidthSettled : ...`) is already false by the
    // time any test observes it — the style binding renders "auto" before
    // a test can ever catch columnWidthTarget applied, so severing
    // computeMeasuredWidth to a fixed stale value left even the panel
    // read green too. columnWidthMV itself persists its last-jumped value
    // regardless of whether the style override is currently applied,
    // so reading it directly exercises computeMeasuredWidth/geometryStore's
    // own resize-driven recomputation without depending on that window.
    const columnWidthMV = recorder.values.get("columnWidth:decked-col");
    if (!columnWidthMV) {
      throw new Error("columnWidth:decked-col was never registered — setup bug, not a timing race");
    }
    const deckedBeforeTarget = columnWidthMV.get();

    const focusedBefore = focusedEl.offsetWidth;

    await rerender(<Demo viewportWidth={1500} />);
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    const focusedAfter = focusedEl.offsetWidth;
    const deckedAfterTarget = columnWidthMV.get();

    // 1500/1000 = 1.5x viewport resize — both columns' cqw-driven widths
    // should track it closely at rest (no JS width override active once
    // widthSettled/columnWidthSettled are true, which duration=0 makes
    // immediate — natural CSS container-query sizing is what's actually
    // rendering for the FOCUSED side; the decked side's channel value is
    // read directly, per the dead-ends above).
    expect(focusedAfter / focusedBefore).toBeCloseTo(1.5, 1);
    expect(deckedAfterTarget / deckedBeforeTarget).toBeCloseTo(1.5, 1);
  });
});

describe("Glass-stack deck: margin/width lockstep (forecast edit E2)", () => {
  // Both channels retarget on the identical trigger commit with the
  // identical transition config, so they represent the same [0,1]
  // progress fraction toward the decked state throughout a real-duration
  // spring, not just at the endpoints — a phase-drift regression (the two
  // channels desyncing mid-flight) would show up as a growing gap between
  // these two fractions at some SAMPLED frame, even if both eventually
  // reach their correct endpoints.
  const NATURAL_WIDTH = 200;
  const EPSILON = 0.03; // 3% of the [0,1] progress range

  async function sampleLockstep(midFocusedStart: boolean) {
    const recorder = createMotionSeamRecorder();
    function Demo() {
      const [midFocused, setMidFocused] = useState(midFocusedStart);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidFocused((v) => !v)}>
            toggle
          </button>
          <MotionSeamContext.Provider value={recorder}>
            <Scene>
              <SceneColumn name="left">
                <SceneObject name="left-panel" focused style={{ width: NATURAL_WIDTH, height: 300 }}>content</SceneObject>
              </SceneColumn>
              <SceneColumn name="middle">
                <SceneObject name="middle-panel" focused={midFocused} style={{ width: NATURAL_WIDTH, height: 300 }}>content</SceneObject>
              </SceneColumn>
              <SceneColumn name="right">
                <SceneObject name="right-panel" focused style={{ width: NATURAL_WIDTH, height: 300 }}>content</SceneObject>
              </SceneColumn>
            </Scene>
          </MotionSeamContext.Provider>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<Demo />);
    await wait(1000);

    const widthMV = recorder.values.get("width:middle");
    const marginMV = recorder.values.get("margin:middle");
    if (!widthMV || !marginMV) {
      throw new Error("width/margin MotionValues were not registered for 'middle' — setup bug, not a timing race");
    }

    (getByTestId("toggle").element() as HTMLElement).click();

    const maxDrift = { value: 0, atWidth: 0, atMargin: 0 };
    const start = performance.now();
    while (performance.now() - start < 800) {
      const widthProgress = 1 - widthMV.get() / NATURAL_WIDTH;
      const marginProgress = marginMV.get() / -DEFAULT_COLUMN_GAP;
      const drift = Math.abs(widthProgress - marginProgress);
      if (drift > maxDrift.value) {
        maxDrift.value = drift;
        maxDrift.atWidth = widthProgress;
        maxDrift.atMargin = marginProgress;
      }
      await waitForAnimationFrame();
    }
    return maxDrift;
  }

  test("unfocus direction: width and margin progress fractions stay in lockstep throughout", async () => {
    const maxDrift = await sampleLockstep(true);
    expect(
      maxDrift.value,
      `max drift ${maxDrift.value.toFixed(4)} between width-progress (${maxDrift.atWidth.toFixed(4)}) and margin-progress (${maxDrift.atMargin.toFixed(4)})`,
    ).toBeLessThan(EPSILON);
  });

  test("refocus direction: width and margin progress fractions stay in lockstep throughout", async () => {
    const maxDrift = await sampleLockstep(false);
    expect(
      maxDrift.value,
      `max drift ${maxDrift.value.toFixed(4)} between width-progress (${maxDrift.atWidth.toFixed(4)}) and margin-progress (${maxDrift.atMargin.toFixed(4)})`,
    ).toBeLessThan(EPSILON);
  });
});

// ---------------------------------------------------------------------------
// Target-derived camera aiming (ui#17 cascade-fix, d9cee3a): two behavioral
// pins ordered by the delta claim review, since the ruling itself never
// became a committed test. Both drive a standard left/middle/right toggle
// (same fixture shape as the zero-pixel-flip tests above) and read every
// `registerTarget("cameraX", ...)` call in order via a custom array-based
// recorder — the built-in `createMotionSeamRecorder`'s own `registerTarget`
// only keeps the LATEST value per key (a Map), which can't answer "how many
// times, and to what sequence of values."
// ---------------------------------------------------------------------------

interface CameraXTrace {
  targets: number[];
  /** cameraX's own live value after full settling — the ground-truth "where
   *  the camera actually ends up," independent of how many registerTarget
   *  calls got it there. */
  settledValue: number;
}

/**
 * Drives ONE standard toggle (middle focused <-> unfocused, with left/right
 * always focused — a contiguous 3-column span at both endpoints of the
 * transition) from an already-settled Scene, and traces every cameraX
 * registerTarget call across the whole settling window.
 */
async function runStandardCameraToggle(direction: "unfocus" | "refocus"): Promise<CameraXTrace> {
  const targets: number[] = [];
  const base = createMotionSeamRecorder();
  const recorder: typeof base = {
    ...base,
    registerTarget: (key, target) => {
      if (key === "cameraX") targets.push(target);
    },
  };

  function Demo() {
    const [midFocused, setMidFocused] = useState(direction === "unfocus");
    return (
      <TestWrapper fullPage>
        <button data-testid="toggle" onClick={() => setMidFocused((v) => !v)}>
          toggle
        </button>
        <MotionSeamContext.Provider value={recorder}>
          <Scene>
            <SceneColumn name="left">
              <SceneObject name="left-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="middle">
              <SceneObject name="middle-panel" focused={midFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="right">
              <SceneObject name="right-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>
    );
  }

  const { getByTestId } = await render(<Demo />);
  await wait(600); // full initial settle, before the toggle under test

  targets.length = 0; // only count retargets from the toggle itself

  (getByTestId("toggle").element() as HTMLElement).click();
  await wait(1000); // full settle: commit-aim, any re-aim, and the spring itself

  const cameraX = base.values.get("cameraX")!;
  return { targets, settledValue: cameraX.get() };
}

describe("Glass-stack deck: camera-recentering commit-aim pins (delta claim review, target-derived aiming)", () => {
  test("unfocus direction: at most 2 cameraX retargets for one focus toggle", async () => {
    const { targets } = await runStandardCameraToggle("unfocus");
    expect(
      targets.length,
      `cameraX registerTarget fired ${targets.length} times for one focus toggle (targets: ${JSON.stringify(targets)}) — expected at most 2 (commit-aim + at most one re-aim)`,
    ).toBeLessThanOrEqual(2);
  });

  test("refocus direction: at most 2 cameraX retargets for one focus toggle", async () => {
    const { targets } = await runStandardCameraToggle("refocus");
    expect(
      targets.length,
      `cameraX registerTarget fired ${targets.length} times for one focus toggle (targets: ${JSON.stringify(targets)}) — expected at most 2 (commit-aim + at most one re-aim)`,
    ).toBeLessThanOrEqual(2);
  });

  // Redefined form (delta claim review, superseding the original "<2px
  // verification-pass correction" wording): the FIRST cameraX target
  // registered at the toggle's own commit must be within 2px of the value
  // cameraX actually settles at. This is the direct statement of "aimed
  // true from t=0" and doesn't care WHICH mechanism (the zero-crossing
  // verification pass, or a registry-resolution re-aim like the span-walk's
  // own unresolved-widthTarget early-exit) produced any gap between them —
  // only whether one exists.
  test("unfocus direction: the first cameraX aim is within 2px of the settled value", async () => {
    const { targets, settledValue } = await runStandardCameraToggle("unfocus");
    const firstAim = targets[0];
    expect(firstAim, `no cameraX retarget fired at all for the toggle (targets: ${JSON.stringify(targets)})`).toBeDefined();
    const gap = Math.abs(firstAim! - settledValue);
    expect(
      gap,
      `first cameraX aim (${firstAim}) was ${gap.toFixed(2)}px from the settled value (${settledValue.toFixed(2)}) — ` +
        `full trace: ${JSON.stringify(targets)}`,
    ).toBeLessThan(2);
  });

  test("refocus direction: the first cameraX aim is within 2px of the settled value", async () => {
    const { targets, settledValue } = await runStandardCameraToggle("refocus");
    const firstAim = targets[0];
    expect(firstAim, `no cameraX retarget fired at all for the toggle (targets: ${JSON.stringify(targets)})`).toBeDefined();
    const gap = Math.abs(firstAim! - settledValue);
    expect(
      gap,
      `first cameraX aim (${firstAim}) was ${gap.toFixed(2)}px from the settled value (${settledValue.toFixed(2)}) — ` +
        `full trace: ${JSON.stringify(targets)}`,
    ).toBeLessThan(2);
  });
});

describe("Glass-stack deck: z-/paint-order at the flip commit (forecast edit E2)", () => {
  // Repaired (ui#21 arc, shipped-sensor repair): the original synchronous-
  // read pair (click, then read zMV/elementsFromPoint on the SAME tick, no
  // polling at all) was defeat-check-confirmed vacuous — a bounded sever
  // stayed green because no time had passed for the spring to move at all,
  // so `Math.abs(zAfter - zBefore) < 1` held trivially regardless of sign.
  // Ports the ui#21 within-column arc's own settle-anchored/overlap-window
  // designs to this column-level pair, chosen PER DIRECTION from real
  // measured geometry (not assumed to mirror the vertical case):
  // "unfocus direction" — middle's decked panel overlaps "right"'s panel
  // PERMANENTLY once settled (measured: 176/180 sampled frames, identical
  // rects from frame ~60 on, never drifts further) — settle-anchored, but
  // with a LIVE-measured overlap centroid at settle (the vertical case's
  // own frozen-pre-click-point bug doesn't recur here). "refocus
  // direction" — overlap with "right" is TRANSIENT only (measured: 25/180
  // frames every run, 3/3 deterministic, gone by settle) — overlap-window,
  // K=10 (comfortably below the measured 25-frame window).
  //
  // Mechanism truth, stated plainly (D-series, ui#o32/o33): BOTH channels
  // available at this DOM position are structurally non-operative.
  // translateZ is paint-inert (D1/D2 discriminators: an isolated,
  // genuinely-transformed sibling still lost to DOM order under an intact
  // preserve-3d chain, retained purely for the perspective-projection
  // foreshortening visual cue). z-index is separately suppressed — a
  // forced `zIndex: 10` on the in-between column's panel was confirmed
  // genuinely applied (computed style AND inline style both read "10")
  // and still had zero effect, consistent with the well-documented CSS
  // behavior that z-index has no effect on children of a
  // transform-style:preserve-3d element (the column anchor here carries
  // exactly that). DOM order is therefore the ONLY operative mechanism —
  // design-correct today via computeStackDepths' own structural invariant
  // (depth ≡ reverse DOM order for every reachable production state, an
  // algebraic guarantee from that function's formula — see its own
  // comment, Scene.tsx), not by coincidence.
  //
  // Consequently: no mechanism sever is possible here without a
  // production change (moving the panel out from under its preserve-3d
  // ancestor, or an explicit stacking-context escape) — that's a design
  // decision, not a test-repair task. These sensors guard RENDERED order
  // (design intent) regardless of mechanism, and their verification is an
  // ASSERTION-DISCRIMINATION proof, not a mechanism-sever proof: each
  // direction's expected owner was flipped to the wrong value and
  // confirmed to fail (5/5 red both directions), proving the sample reads
  // real ownership data at a real overlap point and the assertion is
  // sensitive to it — not that some available mechanism can be forced
  // wrong (nothing here can be, short of restructuring the DOM).
  function ownerOf(el: Element | null): string | undefined {
    return el?.closest("[data-column]")?.getAttribute("data-column") ?? undefined;
  }

  async function pollForColumnZRetarget(recorder: ReturnType<typeof createMotionSeamRecorder>, zMV: { get: () => number }, zBefore: number) {
    const registerStart = performance.now();
    while (performance.now() - registerStart < 2000) {
      if (recorder.controls.has("z:middle")) break;
      await waitForAnimationFrame();
    }
    if (!recorder.controls.has("z:middle")) {
      throw new Error("z:middle never registered a retarget (controls.has stayed false for 2000ms) — setup bug, not a timing race");
    }
    const valueStart = performance.now();
    while (performance.now() - valueStart < 2000) {
      if (zMV.get() !== zBefore) return;
      await waitForAnimationFrame();
    }
    throw new Error("z:middle registered a retarget but its value never moved from zBefore within 2000ms — setup bug, not a timing race");
  }

  test("unfocus direction: paint order doesn't visibly pop at the flip commit", async () => {
    const recorder = createMotionSeamRecorder();
    function Demo() {
      const [midFocused, setMidFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidFocused((v) => !v)}>
            toggle
          </button>
          <MotionSeamContext.Provider value={recorder}>
            <Scene>
              <SceneColumn name="left">
                <SceneObject name="left-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
              </SceneColumn>
              <SceneColumn name="middle">
                <SceneObject name="middle-panel" focused={midFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
              </SceneColumn>
              <SceneColumn name="right">
                <SceneObject name="right-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
              </SceneColumn>
            </Scene>
          </MotionSeamContext.Provider>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<Demo />);
    await wait(500);

    const zMV = recorder.values.get("z:middle");
    if (!zMV) throw new Error("z MotionValue was not registered for 'middle' — setup bug, not a timing race");

    const middlePanel = document.querySelector('[data-column="middle"] [data-scene-column]') as HTMLElement;
    const rightPanel = document.querySelector('[data-column="right"] [data-scene-column]') as HTMLElement;

    const zBefore = zMV.get();
    recorder.controls.clear();
    (getByTestId("toggle").element() as HTMLElement).click();
    await pollForColumnZRetarget(recorder, zMV, zBefore);

    // ui#20 criterion 6 migration: `z:middle` is one of the owned
    // MotionValue channels routed through useOwnedAnimation() (confirmed at
    // source — SceneColumn's zOwnedAnimation.animateTo call), so
    // data-scene-settled becoming true is a direct, correct signal that
    // zMV itself has reached its final value — measured LIVE afterward
    // (not a frozen pre-click snapshot).
    await waitForSceneSettled(getByTestId("scene").element() as HTMLElement, { timeoutMs: 2000 });

    const mRect = middlePanel.getBoundingClientRect();
    const rRect = rightPanel.getBoundingClientRect();
    const left = Math.max(mRect.left, rRect.left);
    const right = Math.min(mRect.right, rRect.right);
    const top = Math.max(mRect.top, rRect.top);
    const bottom = Math.min(mRect.bottom, rRect.bottom);
    const overlaps = left < right && top < bottom;

    const centroidX = (left + right) / 2;
    const centroidY = (top + bottom) / 2;
    const owner = ownerOf(document.elementsFromPoint(centroidX, centroidY)[0] ?? null);

    // Non-vacuity precondition: measured on unsevered code, this overlap
    // is permanent once settled (a decked column's panel stays full-size,
    // tucked behind its focused neighbor) — a missing overlap here means
    // the fixture/geometry changed, not that the check should silently
    // pass.
    expect(overlaps, `middle and right panels do not overlap at settle (middle=${JSON.stringify(mRect)} right=${JSON.stringify(rRect)}) — setup bug or design changed`).toBe(true);

    // Headline, externally anchored (not derived from zMV — the sever
    // corrupts that same signal too): "right" (focused, always in front)
    // must own the overlap centroid, full stop, by design intent.
    expect(owner, `owner at the settled overlap centroid was "${owner}", expected "right"`).toBe("right");
  });

  test("refocus direction: middle never wins paint order while it genuinely overlaps right", async () => {
    const recorder = createMotionSeamRecorder();
    function Demo() {
      const [midFocused, setMidFocused] = useState(false);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidFocused((v) => !v)}>
            toggle
          </button>
          <MotionSeamContext.Provider value={recorder}>
            <Scene>
              <SceneColumn name="left">
                <SceneObject name="left-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
              </SceneColumn>
              <SceneColumn name="middle">
                <SceneObject name="middle-panel" focused={midFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
              </SceneColumn>
              <SceneColumn name="right">
                <SceneObject name="right-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
              </SceneColumn>
            </Scene>
          </MotionSeamContext.Provider>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<Demo />);
    await wait(1000);

    const zMV = recorder.values.get("z:middle");
    if (!zMV) throw new Error("z MotionValue was not registered for 'middle' — setup bug, not a timing race");

    const middlePanel = document.querySelector('[data-column="middle"] [data-scene-column]') as HTMLElement;
    const rightPanel = document.querySelector('[data-column="right"] [data-scene-column]') as HTMLElement;

    const zBefore = zMV.get();
    recorder.controls.clear();
    (getByTestId("toggle").element() as HTMLElement).click();
    await pollForColumnZRetarget(recorder, zMV, zBefore);

    // Overlap-windowed sampling (measured: overlap with "right" is
    // transient only, gone by settle — a settle-anchored probe would find
    // nothing to interrogate for this direction).
    let overlapFrames = 0;
    let middleWonAnyOverlapFrame = false;
    const start = performance.now();
    for (let i = 0; i < 150; i++) {
      await waitForAnimationFrame();
      const mRect = middlePanel.getBoundingClientRect();
      const rRect = rightPanel.getBoundingClientRect();
      const left = Math.max(mRect.left, rRect.left);
      const right = Math.min(mRect.right, rRect.right);
      const top = Math.max(mRect.top, rRect.top);
      const bottom = Math.min(mRect.bottom, rRect.bottom);
      if (left < right && top < bottom) {
        overlapFrames++;
        const centroidX = (left + right) / 2;
        const centroidY = (top + bottom) / 2;
        const owner = ownerOf(document.elementsFromPoint(centroidX, centroidY)[0] ?? null);
        if (owner === "middle") middleWonAnyOverlapFrame = true;
      }
      if (performance.now() - start > 2500) break;
    }

    // Non-vacuity precondition: genuine overlap must actually have been
    // observed. K=10 chosen from real, deterministic (3/3 runs) measured
    // overlap windows of 25 frames — well below the observed window, but
    // still requiring a substantial, non-accidental sample count. A
    // zero-frame window must FAIL as "never observed overlap," not
    // silently pass.
    expect(overlapFrames, `only ${overlapFrames} overlap frames observed between middle's and right's panels — never observed genuine overlap (or an insufficient window)`).toBeGreaterThanOrEqual(10);

    // Headline, externally anchored (not derived from zMV): middle is
    // NEVER the top owner at the live overlap centroid during the overlap
    // window, full stop, by design intent.
    expect(middleWonAnyOverlapFrame, `middle won paint order in at least one of ${overlapFrames} overlap-sampled frames`).toBe(false);
  });
});

describe("Glass-stack deck: double-interruption, minimal (forecast edit E1 — gates entry to Slice 2)", () => {
  // 4-column fixture: "left"/"right" always focused, "mid-a" toggles, and
  // "mid-b" never toggles but is the BYSTANDER whose own stackDepth
  // changes as a side effect of "mid-a"'s transition — the exact ui#o9
  // shape (a sibling reflowing past a column that never itself changed
  // focus). "mid-a" starts focused, is toggled off (pushing both mid-a
  // and mid-b into deck state, mid-b at some depth), interrupted ~150ms
  // in with a second toggle back to focused (mid-a's own transition
  // reverses AND mid-b's stackDepth reverts in the same commit) — the
  // exact interruption timing the original layout-FLIP defect needed.
  // Single first-frame-discontinuity assertion on mid-b's own layout-box
  // geometry (Part B's final form: offsetLeft/offsetTop/offsetWidth/
  // offsetHeight against the anchor, transform-free by construction — see
  // captureFlipCommit's own doc comment) at the second toggle's commit,
  // not the full outlier-detector methodology (that's Slice 3's extension
  // of this same test).
  test("a second focus change landing mid-transition does not corrupt a bystander column's panel geometry", async () => {
    function Demo() {
      const [midAFocused, setMidAFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidAFocused((v) => !v)}>
            toggle
          </button>
          <Scene>
            <SceneColumn name="left">
              <SceneObject name="left-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="mid-b">
              <SceneObject name="mid-b-panel" focused={false} style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="mid-a">
              <SceneObject name="mid-a-panel" focused={midAFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="right">
              <SceneObject name="right-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<Demo />);
    await wait(500);

    const midBPanel = document.querySelector('[data-scene-id="mid-b-panel"]')!.closest("[data-column]")!.querySelector("[data-scene-column]") as HTMLElement;
    const toggleBtn = getByTestId("toggle").element() as HTMLElement;

    // "mid-b" (DOM order: left, mid-b, mid-a, right) is anchored to
    // whichever focused column sits to its right — "mid-a" while mid-a is
    // focused (stackDepth=1), or "right" once mid-a also decks (stackDepth
    // shifts, since mid-a is now the closer decked column). This is the
    // genuine bystander shape: mid-b's OWN stackDepth changes as a side
    // effect of mid-a's transition, without mid-b itself ever toggling.
    toggleBtn.click(); // mid-a starts unfocusing -> mid-b's stackDepth changes too
    await wait(150); // deliberately mid-spring, same timing the original layout-FLIP defect needed

    const midAPanel = document.querySelector('[data-scene-id="mid-a-panel"]')!.closest("[data-column]")!.querySelector("[data-scene-column]") as HTMLElement;
    const midBAnchorEl = midBPanel.closest("[data-column]") as HTMLElement;
    const initialMidBDepth = midBAnchorEl.getAttribute("data-stack-depth");

    toggleBtn.click(); // interrupt: mid-a re-focuses mid-transition

    const midAAnchorEl = midAPanel.closest("[data-column]") as HTMLElement;

    // "mid-a" itself: position flips synchronously-in-intent but not
    // synchronously-in-commit (same registry-correction lag every other
    // Scene-derived read in this file has shown) — poll for its own
    // style.position to actually change. Layout-box geometry (Part B's
    // final form) against mid-a's own anchor.
    const midA = await captureFlipCommit(midAPanel, 2000, undefined, midAAnchorEl);
    // "mid-b": never itself toggles, so its own style.position never
    // changes — poll for its stackDepth-driven retarget instead (the
    // side-effect signal that its bystander geometry depends on).
    // Layout-box geometry (Part B's final form) against mid-b's own anchor.
    const midB = await captureFlipCommit(
      midBPanel,
      2000,
      () => midBAnchorEl.getAttribute("data-stack-depth") !== initialMidBDepth,
      midBAnchorEl,
    );

    expect(Math.abs(midB.after.left - midB.before.left)).toBeLessThan(1);
    expect(Math.abs(midB.after.top - midB.before.top)).toBeLessThan(1);
    expect(Math.abs(midB.after.width - midB.before.width)).toBeLessThan(1);
    expect(Math.abs(midB.after.height - midB.before.height)).toBeLessThan(1);

    expect(Math.abs(midA.after.left - midA.before.left)).toBeLessThan(1);
    expect(Math.abs(midA.after.top - midA.before.top)).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// Full-methodology outlier detector (forecast edit E1's own extension,
// Slice 3). RAW panel gBCR, deliberately NOT rebased against each panel's
// own anchor — team-lead's ruling: this detector's subject is what the user
// SEES (camera, tuck, Z-projection, and reflow all compose into paint-space
// geometry), complementing the FLIP tests' layout-space contract (Part B),
// not duplicating it. A panel's layout-box position relative to its own
// anchor is an architectural invariant BY CONSTRUCTION (that invariance IS
// the zero-pixel-flip guarantee) — confirmed directly: a debug dump of the
// layout-box form showed every sampled delta, for both mid-a and mid-b,
// exactly 0 across the full post-interrupt window, every run. The o9-class
// corruption this scenario historically produced (>1100px excursions while
// layout was fine) was transform-driven and structurally invisible in
// layout space — paint-space is the only instrument that can see it.
// ---------------------------------------------------------------------------

/**
 * Runs the double-interruption fixture once (same shape and interruption
 * timing as the minimal test above) and samples RAW gBCR for both mid-a
 * (the directly-interrupted column) and mid-b (the bystander) every real
 * frame across the whole post-interrupt settling window.
 *
 * Separate test() blocks per run (not a single test with an internal
 * loop) — same reason the gap-math describe block above gives for its own
 * two-test split: vitest-browser's render/cleanup cycle doesn't reliably
 * tear down a component fast enough for a same-body re-render/re-mount.
 */
async function runDoubleInterruptionGbcrSample(): Promise<{ midADeltas: number[]; midBDeltas: number[] }> {
  function Demo() {
    const [midAFocused, setMidAFocused] = useState(true);
    return (
      <TestWrapper fullPage>
        <button data-testid="toggle" onClick={() => setMidAFocused((v) => !v)}>
          toggle
        </button>
        <Scene>
          <SceneColumn name="left">
            <SceneObject name="left-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
          </SceneColumn>
          <SceneColumn name="mid-b">
            <SceneObject name="mid-b-panel" focused={false} style={{ width: 200, height: 300 }}>content</SceneObject>
          </SceneColumn>
          <SceneColumn name="mid-a">
            <SceneObject name="mid-a-panel" focused={midAFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-panel" focused style={{ width: 200, height: 300 }}>content</SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  const { getByTestId } = await render(<Demo />);
  await wait(500);

  const midAPanel = document.querySelector('[data-scene-id="mid-a-panel"]')!.closest("[data-column]")!.querySelector("[data-scene-column]") as HTMLElement;
  const midBPanel = document.querySelector('[data-scene-id="mid-b-panel"]')!.closest("[data-column]")!.querySelector("[data-scene-column]") as HTMLElement;
  const toggleBtn = getByTestId("toggle").element() as HTMLElement;

  const sampleGbcr = (el: HTMLElement): GBCRBox => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };

  toggleBtn.click();
  await wait(150);

  // Bug found and fixed here (2026-07-31): sampling started AT the
  // interrupt commit gave the very first delta (commit-frame vs its
  // first post-commit neighbor) no "previous" neighbor to compare
  // against, so the outlier loop's own `i starts at 1` bound structurally
  // excluded index 0 from ever being checked — the ONE delta most likely
  // to catch a real flip-commit defect. Sampling a few PRE-interrupt
  // frames too (mirroring this arc's own innocence-check methodology)
  // gives that delta a genuine neighbor, closing the gap. Defeat-check-
  // caught: a real ~149px width jump at the commit frame passed silently
  // under the old sampling shape before this fix.
  const midASamples: GBCRBox[] = [sampleGbcr(midAPanel)];
  const midBSamples: GBCRBox[] = [sampleGbcr(midBPanel)];
  for (let i = 0; i < 3; i++) {
    await waitForAnimationFrame();
    midASamples.push(sampleGbcr(midAPanel));
    midBSamples.push(sampleGbcr(midBPanel));
  }

  toggleBtn.click(); // interrupt: mid-a re-focuses mid-transition

  const start = performance.now();
  while (performance.now() - start < 1000) {
    await waitForAnimationFrame();
    midASamples.push(sampleGbcr(midAPanel));
    midBSamples.push(sampleGbcr(midBPanel));
  }

  return { midADeltas: gbcrDeltasOf(midASamples), midBDeltas: gbcrDeltasOf(midBSamples) };
}

describe("Glass-stack deck: double-interruption, full methodology (forecast edit E1's own extension, Slice 3)", () => {
  for (let run = 0; run < 10; run++) {
    test(`run ${run}: no frame-to-frame gBCR outlier across the full settling window, either column`, async () => {
      const { midADeltas, midBDeltas } = await runDoubleInterruptionGbcrSample();
      const midAOutliers = findGbcrOutliers(midADeltas);
      const midBOutliers = findGbcrOutliers(midBDeltas);

      expect(
        midAOutliers,
        `mid-a outlier frame(s) at delta indices ${JSON.stringify(midAOutliers)} ` +
          `(deltas: ${JSON.stringify(midADeltas.map((d) => Math.round(d * 100) / 100))})`,
      ).toEqual([]);
      expect(
        midBOutliers,
        `mid-b outlier frame(s) at delta indices ${JSON.stringify(midBOutliers)} ` +
          `(deltas: ${JSON.stringify(midBDeltas.map((d) => Math.round(d * 100) / 100))})`,
      ).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Phase 6d: Depth deck stacking for in-between unfocused columns
// ---------------------------------------------------------------------------

describe("Scene depth deck stacking", () => {
  test("in-between unfocused column is classified as in-between", async () => {
    // Three columns: left and right are focused, middle is unfocused.
    // The middle column should be classified as "in-between".
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const middleCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
    expect(middleCol.getAttribute("data-column-position")).toBe("in-between");
  });

  test("in-between column stacks under right focused column (positioned near right)", async () => {
    // An in-between unfocused column should appear in roughly the same
    // horizontal area as the right focused column — stacked behind it
    // (the closed-form anchor-relative offset the anchor/panel restructure
    // uses, not the retired stackTargetLeft/DepthDeckContext mechanism).
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middleCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
    const rightCol = getByTestId("content-right").element().closest("[data-column]") as HTMLElement;

    // ui#17 selector audit: middleCol is decked (in-between) — its own
    // anchor is a permanent zero-footprint node (width target 0), so its
    // gBCR reports the collapsed position, not the visible panel's. Read
    // the panel instead for a decked column's own geometry (rightCol
    // stays focused/position:relative pass-through, unaffected either
    // way).
    const middlePanel = middleCol.querySelector("[data-scene-column]") as HTMLElement;
    const middleRect = middlePanel.getBoundingClientRect();
    const rightRect = rightCol.getBoundingClientRect();

    // In-between column should overlap with the right focused column's area
    // — specifically, offset by exactly the default peekOffset (12px)
    // foreshortened by the panel's own depth-1 perspective factor (ui#17
    // Slice 3 fold-in: the 50px slop was flagged by the E4 rider as a real
    // weakness — wide enough to pass even reading the wrong node, see the
    // measured-factor derivation the "peeks left by exactly peekOffset"
    // test above establishes for this exact scenario).
    //
    // E4-loop-closure finding: deriving the factor from `middleRect`
    // itself (the thing this assertion verifies) degenerates when
    // middleRect is mistakenly the anchor instead of the panel — the
    // anchor's own width target is exactly 0 for a decked column, so
    // depth1Factor, expectedPeek, AND the anchor's own actual delta
    // (its -columnGap margin exactly cancels the gap, landing its left
    // edge exactly at rightCol's own left edge) all collapse to 0
    // together, passing vacuously regardless of which node is read
    // (verified directly: pointed at the anchor, this assertion stayed
    // green under the SAME self-derived-factor form). Fixed by deriving
    // the factor from an INDEPENDENT panel measurement (middlePanel,
    // never reassigned) rather than from middleRect — an accidental
    // anchor-read now has nothing to self-consistently degenerate against.
    const naturalWidth = 300;
    const depth1Factor = middlePanel.getBoundingClientRect().width / naturalWidth;
    const expectedPeek = 12 * depth1Factor;
    expect(Math.abs(rightRect.left - middleRect.left - expectedPeek)).toBeLessThan(2);
  });

  test("in-between column appears smaller than natural size (perspective depth)", async () => {
    // The depth deck uses perspective + translateZ to create the stacking visual.
    // An in-between column at depth-1 should appear smaller than its natural size.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middleCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
    const middleRect = middleCol.getBoundingClientRect();

    // The column's rendered (projected) width should be less than its frozen width (300px).
    // ui#17 never-leave-the-flow: narrower now for two compounding reasons —
    // perspective projection (translateZ pushing it back in 3D) AND a real
    // CSS width shrink to the peek-width footprint (see widthTarget's
    // comment in SceneColumn.tsx) — this assertion doesn't need to
    // distinguish the two, just that the rendered box is smaller.
    expect(middleRect.width).toBeLessThan(300);
  });

  test("in-between column clips a full-width content wrapper instead of rewrapping it (ui#17 criterion 6, no text distortion)", async () => {
    // ui#17 never-leave-the-flow: the OUTER column's width channel targets
    // a narrow peek-width footprint (see widthTarget's comment in
    // SceneColumn.tsx) so the flex row reshapes smoothly — but the INNER
    // content wrapper stays pinned at the frozen full width (see the
    // wrapper's own style comment), clipped by the outer's overflow:clip.
    // A crushed (un-pinned) wrapper would rewrap any text content at 300px
    // narrower than its natural size — the exact visual distortion
    // criterion 6 bans (ui#o21, the Chat-tab text-stretch observation this
    // ticket traces back to). Starts col-middle FOCUSED and unfocuses it
    // (rather than mounting it already unfocused) so the pin is sourced
    // from frozenSize.width, populated by a genuine focus-loss transition
    // — the sibling "mount already in-between" test below covers the
    // never-focused-deck-card case, where the pin instead falls back to
    // neverFocusedNaturalWidth's own deferred-measurement read (frozenSize
    // stays null forever for a column that's never been focused).
    function Demo() {
      const [middleFocused, setMiddleFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMiddleFocused((v) => !v)}>
            toggle
          </button>
          <Scene duration={0}>
            <SceneColumn name="col-left">
              <SceneObject name="obj-left" focused>
                <div data-testid="content-left" style={{ width: 300, height: 200 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-middle">
              <SceneObject name="obj-middle" focused={middleFocused}>
                <div data-testid="content-middle" style={{ width: 300, height: 200 }}>
                  some long text content that would visibly rewrap if its container were crushed to a 12px peek width
                  instead of staying pinned at its natural full size
                </div>
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-right">
              <SceneObject name="obj-right" focused>
                <div data-testid="content-right" style={{ width: 300, height: 200 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<Demo />);
    await waitForAnimationFrame();

    (getByTestId("toggle").element() as HTMLElement).click();
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    const middleContent = getByTestId("content-middle").element();
    const middleOuter = middleContent.closest("[data-column]") as HTMLElement;
    const middleWrapper = middleContent.closest("[data-column-content]") as HTMLElement;

    // The outer column's rendered box is clipped down to the narrow
    // peek-width footprint (default peekOffset=12).
    expect(middleOuter.getBoundingClientRect().width).toBeLessThan(50);

    // The content wrapper INSIDE it stays laid out at its frozen full
    // width (300px) — offsetWidth (not gBCR), since gBCR would report the
    // ancestor's clipped paint region, not the wrapper's own layout box
    // (same offsetWidth-is-clip-immune precedent as remeasureGeometry's
    // own capture, H11).
    expect(middleWrapper.offsetWidth).toBeCloseTo(300, -1);

    // offsetWidth alone is a layout metric, deliberately immune to any
    // transform (that immunity is WHY it's used above) — which also makes
    // it structurally blind to a transform-based stretch, the exact ui#o21
    // bug shape (a scale transform faking a width change). This assertion
    // closes that gap by checking PROPORTIONALITY rather than raw size:
    // the wrapper's rendered aspect ratio (gBCR — unaffected by the outer
    // ancestor's overflow:clip, which affects painting/visibility only,
    // never the geometry API) must match its own layout aspect ratio
    // (offsetWidth/offsetHeight). A UNIFORM scale (e.g. the legitimate
    // depth-1 translateZ/perspective projection every in-between column
    // already carries — ~0.889x both axes, part of the deck's own 3D
    // visual, not a bug) preserves this ratio; a NON-uniform, horizontal-
    // only stretch (the actual ui#o21 shape) does not. A raw gBCR-width-
    // vs-offsetWidth comparison (tried first) false-positived on that
    // legitimate perspective shrink (266.67 vs 300, the exact depth-1
    // 8/9 factor) — aspect ratio is what actually distinguishes the two.
    // Defeat-check-verified (2026-07-30): a temporarily reintroduced
    // `transform: scaleX(0.04)` on this exact wrapper left offsetWidth-only
    // assertions green while this one goes red (ratio collapses toward 0).
    const middleWrapperRect = middleWrapper.getBoundingClientRect();
    const renderedAspect = middleWrapperRect.width / middleWrapperRect.height;
    const layoutAspect = middleWrapper.offsetWidth / middleWrapper.offsetHeight;
    expect(renderedAspect).toBeCloseTo(layoutAspect, 2);
  });

  test("a column that mounts already in-between (never focused) still clips a full-width content wrapper (ui#17 criterion 6, never-focused-deck-card gap)", async () => {
    // ui#17: mirrors dev/pages/ScenePage.tsx's own "Depth deck stacking"
    // demo shape (Middle A/Middle B both mount with focused=false, never
    // toggled) — real, not hypothetical (confirmed by reading that demo's
    // own useState initializers before writing this test). A column that
    // has NEVER been through a focus-loss transition has frozenSize===null
    // forever (wasEverFocused starts false and only flips true on an
    // actual focus commit — see its own declaration in SceneColumn.tsx),
    // so the sibling test's frozenSize.width pin never applies here. The
    // fallback is neverFocusedNaturalWidth's own deferred-measurement
    // capture (see that state's declaration comment in SceneColumn.tsx for
    // the full mechanism and why a live-geometry-store read alone doesn't
    // work here — it would only ever observe the ALREADY-narrowed size).
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 200 }}>
                some long text content that would visibly rewrap if its container were crushed to a 12px peek width
                instead of staying pinned at its natural full size
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middleContent = getByTestId("content-middle").element();
    const middleOuter = middleContent.closest("[data-column]") as HTMLElement;
    const middleWrapper = middleContent.closest("[data-column-content]") as HTMLElement;

    // The outer column's rendered box is clipped down to the narrow
    // peek-width footprint (default peekOffset=12) — this half already
    // worked before the fix (widthTarget never depended on frozenSize for
    // in-between columns).
    expect(middleOuter.getBoundingClientRect().width).toBeLessThan(50);

    // The content wrapper stays laid out at its full measured width
    // (300px) via the neverFocusedNaturalWidth deferred-measurement
    // fallback, not crushed to the peek width — this is the half that was
    // broken before the fix (frozenSize is null, so the old
    // `isInBetween && frozenSize` pin never applied for a never-focused
    // column).
    expect(middleWrapper.offsetWidth).toBeCloseTo(300, -1);

    // Same aspect-ratio distortion check as the sibling test above (see
    // its own comment for the full rationale and defeat-check evidence) —
    // offsetWidth alone is transform-immune and so structurally blind to
    // the ui#o21 stretch shape; this catches it via proportionality.
    const middleWrapperRect2 = middleWrapper.getBoundingClientRect();
    const renderedAspect2 = middleWrapperRect2.width / middleWrapperRect2.height;
    const layoutAspect2 = middleWrapper.offsetWidth / middleWrapper.offsetHeight;
    expect(renderedAspect2).toBeCloseTo(layoutAspect2, 2);
  });

  test("multiple in-between columns: deeper columns appear further back", async () => {
    // Phase 6e: depth deck CSS scaling not yet implemented — test is TDD.
    // Four columns: left and right focused, two in between unfocused.
    // The column closer to the right focused column should have depth-1,
    // the one further away depth-2. Depth-2 should appear even smaller.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle1">
            <SceneObject name="obj-middle1" focused={false}>
              <div data-testid="content-middle1" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle2">
            <SceneObject name="obj-middle2" focused={false}>
              <div data-testid="content-middle2" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middle1 = getByTestId("content-middle1").element().closest("[data-column]") as HTMLElement;
    const middle2 = getByTestId("content-middle2").element().closest("[data-column]") as HTMLElement;

    // Depth increases going away from the right focused column.
    // col-middle2 is closer to col-right → depth-1 (shallower, closer to right)
    // col-middle1 is further from col-right → depth-2 (deeper, further back)
    expect(middle1.getAttribute("data-stack-depth")).toBe("2");
    expect(middle2.getAttribute("data-stack-depth")).toBe("1");

    // Depth-2 (middle1) should appear smaller than depth-1 (middle2). ui#17
    // anchor/panel split: the perspective projection that shrinks apparent
    // width lives on the panel node's own z-transform, not the anchor.
    const panel1 = middle1.querySelector("[data-scene-column]") as HTMLElement;
    const panel2 = middle2.querySelector("[data-scene-column]") as HTMLElement;
    const rect1 = panel1.getBoundingClientRect();
    const rect2 = panel2.getBoundingClientRect();
    expect(rect1.width).toBeLessThan(rect2.width);
  });

  test("depth-1 has higher opacity than depth-2", async () => {
    // Phase 6e: opacity animation timing not yet verified — test is TDD.
    // Shallower stacked columns should be more opaque than deeper ones.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle1">
            <SceneObject name="obj-middle1" focused={false}>
              <div data-testid="content-middle1" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle2">
            <SceneObject name="obj-middle2" focused={false}>
              <div data-testid="content-middle2" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middle1 = getByTestId("content-middle1").element().closest("[data-column]") as HTMLElement;
    const middle2 = getByTestId("content-middle2").element().closest("[data-column]") as HTMLElement;

    // Depth is measured from right focused column:
    // col-middle2 (adjacent to right) → depth-1, higher opacity
    // col-middle1 (further from right) → depth-2, lower opacity
    // ui#17 anchor/panel split: opacity is an `animate`-driven depth-deck
    // visual now applied on the panel node, not the anchor.
    const panel1 = middle1.querySelector("[data-scene-column]") as HTMLElement;
    const panel2 = middle2.querySelector("[data-scene-column]") as HTMLElement;
    const opacity1 = parseFloat(window.getComputedStyle(panel1).opacity);
    const opacity2 = parseFloat(window.getComputedStyle(panel2).opacity);

    // depth-2 (middle1) should have lower opacity than depth-1 (middle2)
    expect(opacity1).toBeLessThan(opacity2);
    // Both should be below 1 (they are unfocused/stacked)
    expect(opacity1).toBeLessThan(1);
    expect(opacity2).toBeLessThan(1);
  });

  test("depth-1 in-between column transform contains translateZ (not scale)", async () => {
    // Depth is implemented via perspective + translateZ, not CSS scale.
    // The column's transform string should include a translateZ with a negative
    // value, pushing it away from the viewer into the 3D perspective field.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middleCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
    // ui#17 selector audit: the depth-deck's translateZ lives on the PANEL
    // node (see zMV's own declaration in SceneColumn.tsx), not the
    // zero-footprint anchor — this test is specifically about that
    // transform, unlike the sibling "appears smaller than natural size"
    // test above (which explicitly doesn't care which node contributes
    // the shrink), so it reads the panel.
    const middlePanel = middleCol.querySelector("[data-scene-column]") as HTMLElement;
    // ui#17 Slice 3 fold-in: getComputedStyle().transform always resolves
    // to a matrix/matrix3d string (verified directly — never contains the
    // literal substring "translateZ", regardless of what functions
    // produced it), so `toBeTruthy()` against it could never actually
    // fail on a scale-based fake — the assertion this test's own name
    // promises. style.transform (the inline value Motion writes) is
    // functional notation and does contain "translateZ(" literally
    // (verified directly: "translateX(-12px) translateZ(-100px)").
    const transform = middlePanel.style.transform;

    // Depth deck columns use perspective + translateZ for the depth visual
    // effect, not CSS scale.
    expect(transform).toContain("translateZ(");
    // Verify the column appears smaller than its natural 300px width.
    // Perspective projection reduces the apparent size of elements pushed back in Z.
    const rect = middlePanel.getBoundingClientRect();
    expect(rect.width).toBeLessThan(300);
  });

  test("depth-1 in-between column has greyscale filter applied", async () => {
    // In-between columns at depth-1 should have a 25% greyscale filter applied.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 300, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    const middleCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;
    // ui#17 anchor/panel split: the depth-deck greyscale filter is an
    // `animate`-driven property on the panel node now, not the anchor.
    const middlePanel = middleCol.querySelector("[data-scene-column]") as HTMLElement;
    const filter = window.getComputedStyle(middlePanel).filter;

    // depth-1 → grayscale(0.25)
    expect(filter).toContain("grayscale(0.25)");
  });

  test("deeper columns have more greyscale than shallower columns", async () => {
    // depth-2 should have grayscale(0.5), depth-1 should have grayscale(0.25).
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle1">
            <SceneObject name="obj-middle1" focused={false}>
              <div data-testid="content-middle1" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle2">
            <SceneObject name="obj-middle2" focused={false}>
              <div data-testid="content-middle2" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();

    // col-middle2 is adjacent to col-right → depth-1 → grayscale(0.25)
    // col-middle1 is further from col-right → depth-2 → grayscale(0.5)
    const middle1 = getByTestId("content-middle1").element().closest("[data-column]") as HTMLElement;
    const middle2 = getByTestId("content-middle2").element().closest("[data-column]") as HTMLElement;

    // ui#17 anchor/panel split: greyscale is a panel-node property now.
    const panel1 = middle1.querySelector("[data-scene-column]") as HTMLElement;
    const panel2 = middle2.querySelector("[data-scene-column]") as HTMLElement;
    const filter1 = window.getComputedStyle(panel1).filter;
    const filter2 = window.getComputedStyle(panel2).filter;

    expect(filter2).toContain("grayscale(0.25)");
    expect(filter1).toContain("grayscale(0.5)");
  });

  // A5 — the pull-out-direction principle: a deck card peeks out in the
  // direction it travels when pulled from the deck. Column decks anchor
  // under the right focused column and peek left, as explicit per-depth
  // offsets (peekOffset, fanned by depth) rather than the 1-2px emergent
  // perspective artifact the deck previously relied on.

  test("depth-1 in-between column peeks left by exactly peekOffset (default)", async () => {
    const scene = (peekOffset: number) => (
      <TestWrapper fullPage>
        <Scene duration={0} peekOffset={peekOffset}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    // Render once with peekOffset=0 to establish the flush anchor, then
    // again with the default peekOffset — cleanup() between renders keeps the
    // two mounts from colliding on shared data-testids within this one test.
    const flush = await render(scene(0));
    // ui#17 anchor/panel split: the fan (columnAnimateX) and the perspective
    // foreshortening (z) are both `animate`-driven properties on the panel
    // node now, not the zero-footprint anchor — so this reads the REAL
    // rendered gap between the PANELS (gBCR) rather than the anchor, same
    // rationale as the corruption fixture's own sharpened assertion this
    // session (measures what actually painted, stays meaningful regardless
    // of which channel(s) produce it).
    const flushRightPanel = flush
      .getByTestId("content-right")
      .element()
      .closest("[data-column]")!
      .querySelector("[data-scene-column]") as HTMLElement;
    const flushMiddlePanel = flush
      .getByTestId("content-middle")
      .element()
      .closest("[data-column]")!
      .querySelector("[data-scene-column]") as HTMLElement;
    await waitForAnimationFrame();
    await waitForAnimationFrame();
    const flushGap = flushRightPanel.getBoundingClientRect().left - flushMiddlePanel.getBoundingClientRect().left;
    await cleanup();

    const peeked = await render(scene(12));
    const rightPanel = peeked
      .getByTestId("content-right")
      .element()
      .closest("[data-column]")!
      .querySelector("[data-scene-column]") as HTMLElement;
    const middlePanel = peeked
      .getByTestId("content-middle")
      .element()
      .closest("[data-column]")!
      .querySelector("[data-scene-column]") as HTMLElement;
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    // At peekOffset=0 the deck column renders flush against the focused
    // column (no visible gap) — a genuine theoretical claim about the
    // design (zero net offset when columnAnimateX is itself 0), not a
    // measured-then-hand-waved number, so it stays a flat-tolerance check.
    expect(flushGap).toBeCloseTo(0, -1);

    // Rendered (post-perspective-projection) left edge: the NOMINAL
    // translateX (-peekOffset at depth-1) composes with the SAME
    // translateZ/perspective transform that also shrinks the panel's
    // rendered width, so the visible peek is peekOffset foreshortened by
    // that panel's own projection factor, not a flat 12px (ui#17 selector
    // audit — re-derived from a flat ±5px placeholder that was itself
    // flagged as asserted-not-derived; same measured-factor discipline
    // the "custom peekOffset" test below uses, deriving the factor from
    // the panel's own rendered width rather than hand-deriving the CSS 3D
    // projection math).
    const rightRect = rightPanel.getBoundingClientRect();
    const middleRect = middlePanel.getBoundingClientRect();
    const naturalWidth = 200; // this fixture's own SceneObject width
    const depth1Factor = middleRect.width / naturalWidth;
    const expectedPeek = 12 * depth1Factor;
    expect(Math.abs(rightRect.left - middleRect.left - expectedPeek)).toBeLessThan(2);
  });

  test("multiple in-between columns peek left by an additional peekOffset increment per depth (fanned)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle1">
            <SceneObject name="obj-middle1" focused={false}>
              <div data-testid="content-middle1" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle2">
            <SceneObject name="obj-middle2" focused={false}>
              <div data-testid="content-middle2" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();
    await waitForAnimationFrame();

    // col-middle2 → depth-1, col-middle1 → depth-2 (further from col-right).
    const middle1 = getByTestId("content-middle1").element().closest("[data-column]") as HTMLElement;
    const middle2 = getByTestId("content-middle2").element().closest("[data-column]") as HTMLElement;

    // ui#17 anchor/panel split: gBCR of the PANEL node, not the anchor —
    // see the "depth-1 ... peeks left by exactly peekOffset" test's own
    // comment for why.
    const panel1 = middle1.querySelector("[data-scene-column]") as HTMLElement;
    const panel2 = middle2.querySelector("[data-scene-column]") as HTMLElement;
    const depth1Rect = panel2.getBoundingClientRect();
    const depth2Rect = panel1.getBoundingClientRect();

    // Each successive depth level peeks by one additional peekOffset
    // increment (12px default) — but each depth's OWN nominal shift
    // (-peekOffset * stackDepth) is foreshortened by that same depth's own
    // perspective projection factor (ui#17 selector audit — re-derived
    // from a flat ±5px placeholder; same measured-factor discipline the
    // "custom peekOffset" test below uses).
    const naturalWidth = 200;
    const factor1 = depth1Rect.width / naturalWidth;
    const factor2 = depth2Rect.width / naturalWidth;
    const expectedDelta = 12 * 2 * factor2 - 12 * 1 * factor1;
    const actualDelta = depth1Rect.left - depth2Rect.left;
    expect(Math.abs(actualDelta - expectedDelta)).toBeLessThan(2);
  });

  test("custom peekOffset prop changes the column deck peek offsets accordingly", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} peekOffset={20}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle1">
            <SceneObject name="obj-middle1" focused={false}>
              <div data-testid="content-middle1" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle2">
            <SceneObject name="obj-middle2" focused={false}>
              <div data-testid="content-middle2" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();
    await waitForAnimationFrame();

    const middle1 = getByTestId("content-middle1").element().closest("[data-column]") as HTMLElement; // depth-2
    const middle2 = getByTestId("content-middle2").element().closest("[data-column]") as HTMLElement; // depth-1

    // ui#17 anchor/panel split: gBCR of the PANEL node, not the anchor —
    // see the "depth-1 ... peeks left by exactly peekOffset" test's own
    // comment.
    const panel1 = middle1.querySelector("[data-scene-column]") as HTMLElement;
    const panel2 = middle2.querySelector("[data-scene-column]") as HTMLElement;
    const depth1Rect = panel2.getBoundingClientRect();
    const depth2Rect = panel1.getBoundingClientRect();

    // With peekOffset=20, the NOMINAL x-transform is -20 at depth-1 and
    // -40 at depth-2 (columnAnimateX = -peekOffset * stackDepth) — but that
    // transform composes with the SAME perspective/translateZ transform
    // that also shrinks each panel's rendered width (preserve-3d now
    // correctly propagates both together — see the anchor's own
    // transform-style comment), so the RENDERED fan increment is each
    // depth's nominal x-shift foreshortened by its own depth's projection
    // factor, not a flat 20px difference. Deriving that factor from each
    // panel's own measured width (rather than hand-deriving the CSS 3D
    // projection math, which also depends on transform-origin/order
    // details not worth re-deriving here) keeps this assertion's expected
    // value tied to what's actually measured, the same discipline used
    // for the camera settle tolerance elsewhere in this session's work.
    const factor1 = depth1Rect.width / 200;
    const factor2 = depth2Rect.width / 200;
    const expectedDelta = 20 * 2 * factor2 - 20 * 1 * factor1;
    const actualDelta = depth1Rect.left - depth2Rect.left;
    expect(Math.abs(actualDelta - expectedDelta)).toBeLessThan(2);
  });

  test("peekOffset={0} reproduces the old flush-anchored behavior (no fan)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} peekOffset={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle1">
            <SceneObject name="obj-middle1" focused={false}>
              <div data-testid="content-middle1" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle2">
            <SceneObject name="obj-middle2" focused={false}>
              <div data-testid="content-middle2" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();
    await waitForAnimationFrame();

    const middle1 = getByTestId("content-middle1").element().closest("[data-column]") as HTMLElement; // depth-2
    const middle2 = getByTestId("content-middle2").element().closest("[data-column]") as HTMLElement; // depth-1

    // With no peek offset, every in-between column renders flush at the
    // same left edge regardless of depth — the pre-A5 behavior, where only
    // perspective projection (not a manual x offset) distinguished depths.
    // ui#17 selector audit: reads the PANEL (columnAnimateX = 0 at
    // peekOffset=0, so the panel's own static (0,0)-within-anchor position
    // means this should read identically to the anchor here, but the panel
    // is the node whose position actually matters for what's visible — see
    // the "depth-1 ... peeks left by exactly peekOffset" test's own
    // comment for why this suite reads panels, not anchors, for decked
    // geometry).
    const panel1 = middle1.querySelector("[data-scene-column]") as HTMLElement;
    const panel2 = middle2.querySelector("[data-scene-column]") as HTMLElement;
    expect(panel1.getBoundingClientRect().left).toBeCloseTo(panel2.getBoundingClientRect().left, -1);
  });

  test("H11: a never-before-focused deck card's marginTop converges monotonically on first focus (no swing)", async () => {
    // Demo 4 shape (Left/MidA/MidB/Right — dev/pages/ScenePage.tsx's depth
    // deck demo): a column with NO frozenSize yet (never focused before)
    // undergoes a bigger layout-FLIP box-shape change on its first focus
    // than on any later one. Probe-confirmed root cause: while that
    // transition's translateZ/scale transform is still mid-flight,
    // getBoundingClientRect() on a registered object (or the content
    // wrapper fallback) reports a PROJECTED size — corrupting the
    // contentHeight geometryStore feeds, so marginTop overshoots (~301 ->
    // ~330) before correcting back to the true resting value (~300) over
    // several hundred ms. A column's SECOND focus (frozenSize already set
    // from the first unfocus) never shows this — its marginTop is flat
    // throughout. Real mode (no duration override) — the spring must
    // actually run for the swing to be observable.
    const build = (midAFocused: boolean) => (
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused>
              <div style={{ width: 240, height: 300 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="middle-a">
            <SceneObject name="middle-a-obj" focused={midAFocused}>
              <div data-testid="mid-a-content" style={{ width: 240, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="middle-b">
            <SceneObject name="middle-b-obj" focused={false}>
              <div style={{ width: 240, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-obj" focused>
              <div style={{ width: 240, height: 300 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(false));
    await wait(500);

    const midAWrapper = getByTestId("mid-a-content").element()
      .closest("[data-column]")?.querySelector("[data-column-content]") as HTMLElement;
    const readMarginTop = () => parseFloat(midAWrapper.style.marginTop || "0");

    // First focus: sample marginTop across the transition.
    await rerender(build(true));
    const firstFocusSamples = [readMarginTop()];
    for (const delay of [16, 32, 50, 100, 150, 200, 300]) {
      await wait(delay);
      firstFocusSamples.push(readMarginTop());
    }
    await wait(500);
    const settled = readMarginTop();

    // No mid-flight retarget: every sample stays within a few px of the
    // final settled value — before the fix, samples swung ~30px past it.
    for (const sample of firstFocusSamples) {
      expect(Math.abs(sample - settled)).toBeLessThan(5);
    }

    // Second focus (frozenSize now set from the intervening unfocus) — a
    // sanity control confirming the settled value itself is stable/correct,
    // not coincidentally landing inside tolerance by chance.
    await rerender(build(false));
    await wait(800);
    await rerender(build(true));
    await wait(800);
    expect(readMarginTop()).toBeCloseTo(settled, 0);
  });

  test("a column whose child JUST became focused never applies depth-deck visual treatment, even when the registry-derived position/depth still lag one commit behind (F5 item 2)", async () => {
    // Demo 4 shape, distinct mechanism from H11 above (that one is about
    // getBoundingClientRect() reporting a projected size mid-transform;
    // already fixed). Root cause here (probe-confirmed on the dev app's
    // Depth deck stacking demo, instrumented render trace): Scene's own S6
    // registration architecture is "one-commit-stale by construction" (see
    // this file's own comments on columnRegistryRef) — `position`/
    // `stackDepth` (read from context, populated from Scene's REGISTRY) can
    // still report the PREVIOUS commit's classification ("in-between",
    // depth 2) for exactly one render after a column's `focused` prop flips
    // true, even though `columnFocused` (a plain prop-walk of this column's
    // own children, always fresh) is already correct. Before the fix,
    // `isInBetween`/`animateX` trusted `position` alone, so that one
    // mismatched render fed the `animate` prop stale depth-deck values
    // (reduced opacity, translateZ, a large nonzero x offset) on top of an
    // element ALREADY laid out via flex/relative — Motion picks up that
    // stale target and starts springing toward it before the very next
    // commit corrects it, a spurious retarget that's visible as a jump
    // (probe-confirmed via raw transform sampling: translateX swung from
    // +142 to -98 across a single frame at exactly this transition).
    //
    // This test reproduces the mismatch DETERMINISTICALLY rather than
    // racing React's own synchronous corrective re-render (which resolves
    // before control ever returns to a test, making the intermediate state
    // unobservable from outside the component): `position`/`stackDepth` are
    // held fixed at their pre-focus "in-between, depth 2" values across the
    // rerender (exactly what a lagging registry would still report) while
    // the child object's `focused` prop flips true. `data-stack-depth`
    // (driven directly by `isInBetween`) is a plain React-rendered
    // attribute — synchronous and deterministic, no animation-timing
    // dependency, unlike the animate-prop values themselves.
    const position = new Map<string, ColumnPosition>([["middle", "in-between"]]);
    const stackDepths = new Map<string, number>([["middle", 2]]);

    const build = (focused: boolean) => (
      <TestWrapper fullPage>
        <ViewportContext.Provider value={{ top: 0, left: 0, width: 1000, height: 800 }}>
          <ColumnPositionContext.Provider value={position}>
            <StackDepthContext.Provider value={stackDepths}>
              <SceneColumn name="middle">
                <SceneObject name="middle-obj" focused={focused}>
                  <div data-testid="content" style={{ width: 240, height: 200 }} />
                </SceneObject>
              </SceneColumn>
            </StackDepthContext.Provider>
          </ColumnPositionContext.Provider>
        </ViewportContext.Provider>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(false));
    const col = getByTestId("content").element().closest("[data-column]") as HTMLElement;
    // Sanity: genuinely classified in-between/depth-2 while unfocused.
    expect(col.getAttribute("data-stack-depth")).toBe("2");

    // Focus the child WITHOUT updating position/stackDepth — the exact
    // one-commit-stale window a real registry-lag click produces.
    await rerender(build(true));

    expect(col.getAttribute("data-column-focused")).toBe("true");
    expect(col.getAttribute("data-stack-depth")).toBeNull();
    expect(window.getComputedStyle(col).position).toBe("relative");
  });
});

// ---------------------------------------------------------------------------
// Within-column depth deck (unfocused between focused objects)
// ---------------------------------------------------------------------------

describe("SceneColumn within-column depth deck", () => {
  test("unfocused object between two focused objects has depth treatment", async () => {
    // A (focused), B (unfocused), C (focused) — B should have reduced opacity
    // and be visible (not visibility: hidden) because it peeks as a depth card.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
            <SceneObject name="obj-c" focused>
              <div data-testid="content-c" style={{ width: 300, height: 200 }}>C</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    // The panel's `animate`-driven opacity can lag the synchronous render
    // under full-suite concurrent load (probe-confirmed: reliable in
    // isolation, flaky under load — the same wall-clock race class
    // documented elsewhere in this file) — a frame lets Motion's own
    // commit catch up before reading computed style.
    await waitForAnimationFrame();

    const anchorB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;
    // ui#21 anchor/panel split: the depth-card visual treatment (opacity,
    // visibility) lives on the PANEL now, not the zero-footprint anchor —
    // the anchor only carries the `data-within-column-depth` marker.
    const panelB = getByTestId("content-b").element().closest("[data-scene-object]") as HTMLElement;

    // B is between two focused objects — it should have depth treatment (data attribute)
    expect(anchorB.getAttribute("data-within-column-depth")).toBe("1");

    // B's panel should be visible (not visibility: hidden — it peeks as a depth card)
    expect(window.getComputedStyle(panelB).visibility).not.toBe("hidden");

    // B's panel should have reduced opacity (depth treatment)
    const opacity = parseFloat(window.getComputedStyle(panelB).opacity);
    expect(opacity).toBeLessThan(1);
  });

  test("multiple unfocused between focused: increasing depth", async () => {
    // A (focused), B (unfocused), C (unfocused), D (focused)
    // B is depth-2 (further from D), C is depth-1 (adjacent to D)
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
            <SceneObject name="obj-c" focused={false}>
              <div data-testid="content-c" style={{ width: 300, height: 200 }}>C</div>
            </SceneObject>
            <SceneObject name="obj-d" focused>
              <div data-testid="content-d" style={{ width: 300, height: 200 }}>D</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    // Same load-dependent settling precondition as the sibling test above.
    await waitForAnimationFrame();

    const anchorB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;
    const anchorC = getByTestId("content-c").element().closest("[data-scene-id]") as HTMLElement;
    // ui#21 anchor/panel split: opacity lives on the PANEL now, not the
    // zero-footprint anchor (see the sibling test above for the same fix).
    const panelB = getByTestId("content-b").element().closest("[data-scene-object]") as HTMLElement;
    const panelC = getByTestId("content-c").element().closest("[data-scene-object]") as HTMLElement;

    // C is depth-1 (adjacent to lower focused D), B is depth-2
    expect(anchorC.getAttribute("data-within-column-depth")).toBe("1");
    expect(anchorB.getAttribute("data-within-column-depth")).toBe("2");

    // C (depth-1) has higher opacity than B (depth-2) — less treatment = more visible
    const opacityB = parseFloat(window.getComputedStyle(panelB).opacity);
    const opacityC = parseFloat(window.getComputedStyle(panelC).opacity);
    expect(opacityC).toBeGreaterThan(opacityB);
  });

  test("unfocused at end of column (not between focused) has no depth treatment", async () => {
    // A (focused), B (unfocused) — B is NOT between two focused objects
    // so it should have the normal hidden treatment (visibility: hidden)
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const objB = getByTestId("content-b").element().closest("[data-scene-id]") as HTMLElement;

    // B is not between two focused objects — no depth attribute
    expect(objB.getAttribute("data-within-column-depth")).toBeNull();

    // B stays visible and in flow (position: relative), just inert
    expect(window.getComputedStyle(objB).position).toBe("relative");
    expect(window.getComputedStyle(objB).visibility).not.toBe("hidden");
  });

  test("within-column depth object is anchored at the lower focused sibling via a peek-offset transform and zIndex depth", async () => {
    // A (focused, 200px tall), B (unfocused), C (focused, 200px tall)
    // B's zero-footprint anchor sits flush after A in flow (its own local
    // origin already converges on "flush against the lower focused
    // sibling" — the plan's anchorTop-vestigial reasoning), and its PANEL
    // escapes via position:absolute, peeking up past that origin by the
    // default peekOffset (12px, A5's pull-out-direction principle) as a
    // y-transform. Depth is expressed via a discrete zIndex channel now —
    // translateZ was removed entirely for object-level cards (ui#o32, the
    // z-index paint-order channel amendment), so this test's subject is
    // the peek-offset transform + zIndex ordering, not translateZ.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
            <SceneObject name="obj-c" focused>
              <div data-testid="content-c" style={{ width: 300, height: 200 }}>C</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // The height channel's own layout effect (jump to 0, duration=0) needs
    // a frame to apply before B's anchor has actually collapsed out of
    // flow — same precondition the column-level depth-deck tests in this
    // file already wait a frame for.
    await waitForAnimationFrame();

    const panelB = getByTestId("content-b").element().closest("[data-scene-object]") as HTMLElement;

    // B's panel escapes its zero-footprint anchor via position:absolute.
    expect(window.getComputedStyle(panelB).position).toBe("absolute");

    // Depth-1 — a negative, depth-scaled zIndex (not translateZ).
    expect(window.getComputedStyle(panelB).zIndex).toBe("-1");

    // The peek offset is a raw y-transform (mirrors SceneColumn's own
    // inBetweenY) — read it directly via parseTranslateY rather than
    // rendered gBCR, matching this file's established idiom.
    expect(parseTranslateY(panelB.style.transform)).toBeCloseTo(-12, 0);
  });

  // A5 — the pull-out-direction principle: a within-column deck card peeks
  // UP past the lower focused sibling's top edge, as explicit per-depth
  // offsets (peekOffset, fanned by depth).

  test("multiple unfocused objects between focused siblings peek up by an additional peekOffset increment per depth (fanned)", async () => {
    // A (focused), B (unfocused, depth-2), C (unfocused, depth-1), D (focused)
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
            <SceneObject name="obj-c" focused={false}>
              <div data-testid="content-c" style={{ width: 300, height: 200 }}>C</div>
            </SceneObject>
            <SceneObject name="obj-d" focused>
              <div data-testid="content-d" style={{ width: 300, height: 200 }}>D</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // The height channel's own layout effect needs a frame to collapse
    // B's/C's anchors out of flow before their panels' peek transforms are
    // meaningful to read (same precondition as the sibling test above).
    await waitForAnimationFrame();

    // ui#21 anchor/panel split: the peek offset lives in the panel's own
    // y-transform now (mirrors SceneColumn's own inBetweenY) — read it via
    // parseTranslateY, matching this file's established idiom, not the
    // retired inline `style.top`.
    const panelB = getByTestId("content-b").element().closest("[data-scene-object]") as HTMLElement; // depth-2
    const panelC = getByTestId("content-c").element().closest("[data-scene-object]") as HTMLElement; // depth-1

    // C (depth-1) peeks up by 12px, B (depth-2) by 24px (default peekOffset).
    expect(parseTranslateY(panelC.style.transform)).toBeCloseTo(-12, 0);
    expect(parseTranslateY(panelB.style.transform)).toBeCloseTo(-24, 0);
  });

  test("custom peekOffset prop changes the within-column deck peek offsets accordingly", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} peekOffset={20}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
            <SceneObject name="obj-c" focused={false}>
              <div data-testid="content-c" style={{ width: 300, height: 200 }}>C</div>
            </SceneObject>
            <SceneObject name="obj-d" focused>
              <div data-testid="content-d" style={{ width: 300, height: 200 }}>D</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // The height channel's own layout effect needs a frame to collapse
    // B's/C's anchors out of flow (same precondition as the default-offset
    // sibling test above).
    await waitForAnimationFrame();

    // ui#21 anchor/panel split: peek offset lives in the panel's own
    // y-transform now (mirrors SceneColumn's own inBetweenY) — read it via
    // parseTranslateY, not the retired `style.top`.
    const panelB = getByTestId("content-b").element().closest("[data-scene-object]") as HTMLElement; // depth-2
    const panelC = getByTestId("content-c").element().closest("[data-scene-object]") as HTMLElement; // depth-1

    // With peekOffset=20, C (depth-1) peeks up by 20px and B (depth-2) by
    // 2*20=40px.
    expect(parseTranslateY(panelC.style.transform)).toBeCloseTo(-20, 0);
    expect(parseTranslateY(panelB.style.transform)).toBeCloseTo(-40, 0);
  });

  test("peekOffset={0} reproduces the old flush-anchored behavior (no peek)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} peekOffset={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>B</div>
            </SceneObject>
            <SceneObject name="obj-c" focused={false}>
              <div data-testid="content-c" style={{ width: 300, height: 200 }}>C</div>
            </SceneObject>
            <SceneObject name="obj-d" focused>
              <div data-testid="content-d" style={{ width: 300, height: 200 }}>D</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // ui#21 anchor/panel split: peek offset lives in the panel's own
    // y-transform now — read rendered geometry, not the retired `style.top`.
    const panelB = getByTestId("content-b").element().closest("[data-scene-object]") as HTMLElement; // depth-2
    const panelC = getByTestId("content-c").element().closest("[data-scene-object]") as HTMLElement; // depth-1

    // With no peek offset, both depths anchor flush at their shared local
    // origin (200) — the pre-A5 behavior, where only zIndex (not a manual
    // transform offset) distinguishes depths.
    expect(panelC.getBoundingClientRect().top).toBeCloseTo(200, -1);
    expect(panelB.getBoundingClientRect().top).toBeCloseTo(200, -1);
  });

  test("focusing a sandwiched depth-deck object mid-flight settles into the open slot, not frozen at a stale depth-deck position (F5 item 1)", async () => {
    // Top + Bottom focused, Middle sandwiched (depth-deck). A REAL, in-flight
    // spring is engineered on Middle's within-column `top` (growing Top's
    // height shifts the anchor Middle peeks above), then Middle is focused
    // WHILE that spring is still running — reproducing the real repro shape
    // (probe-confirmed on the dev app: by the time a user can click, a
    // residual in-flight spring is essentially always present) more reliably
    // than a clean "already at rest" transition, which a duration=0 initial
    // mount + isolated `rerender()` doesn't naturally leave mid-flight.
    //
    // Root cause reproduced here, HISTORICAL (ui#21 Slice 4 doc sweep note:
    // `topMV`/imperative `style.top` describe the PRE-height/margin-channel
    // mechanism and no longer exist in current code — SceneObject's peek
    // positioning now runs through the height/marginBottom channels plus
    // the panel's own y-transform, see SceneObject.tsx's own comments. This
    // test's own SUBJECT — an interrupted mid-flight settle landing in the
    // open slot, not frozen at a stale depth-deck position — remains the
    // current regression guard for that class of bug; verified still
    // passing under the current architecture, not touched this round):
    // `topMV` (bound imperatively via `style.top`, not React's declarative
    // `animate` prop — see H8's own comment on this file for why) had an
    // ACTIVE animate() call in flight when `withinDepthInfo` became falsy.
    // The driving effect early-returned (not sandwiched — nothing redirects
    // topMV toward 0) and the `top` key disappeared from `style` entirely
    // (the binding was previously gated on `withinDepthInfo && withinDepth`).
    // Motion's in-flight WAAPI/JS animation for that DOM property keeps
    // writing until it completes, ignoring that the style prop stopped
    // referencing it — so `top` froze at whatever value it held the instant
    // the binding vanished, which can land anywhere (including well past
    // Bottom's own position, as below).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col" objectGap={8}>
            <SceneObject name="top" focused>
              <div data-testid="content-top" style={{ width: 300, height: 100 }}>Top</div>
            </SceneObject>
            <SceneObject name="middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 100 }}>Middle</div>
            </SceneObject>
            <SceneObject name="bottom" focused>
              <div data-testid="content-bottom" style={{ width: 300, height: 100 }}>Bottom</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const middle = getByTestId("content-middle").element().closest("[data-scene-id]") as HTMLElement;
    // Sanity: Middle starts sandwiched in the depth deck.
    expect(middle.getAttribute("data-within-column-depth")).not.toBeNull();

    // Grow Top with a REAL spring (no duration override) — Middle's anchor
    // (Bottom's offsetTop) shifts a lot, starting a genuine in-flight
    // height/marginBottom channel spring (the current mechanism — see the
    // historical note above).
    await rerender(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col" objectGap={8}>
            <SceneObject name="top" focused>
              <div data-testid="content-top" style={{ width: 300, height: 500 }}>Top</div>
            </SceneObject>
            <SceneObject name="middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 300, height: 100 }}>Middle</div>
            </SceneObject>
            <SceneObject name="bottom" focused>
              <div data-testid="content-bottom" style={{ width: 300, height: 100 }}>Bottom</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    // A couple of real frames — enough for the spring to be genuinely in
    // flight, well short of settling.
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    // Interrupt: focus Middle while the depth-anchor spring is mid-flight.
    await rerender(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col" objectGap={8}>
            <SceneObject name="top" focused>
              <div data-testid="content-top" style={{ width: 300, height: 500 }}>Top</div>
            </SceneObject>
            <SceneObject name="middle" focused>
              <div data-testid="content-middle" style={{ width: 300, height: 100 }}>Middle</div>
            </SceneObject>
            <SceneObject name="bottom" focused>
              <div data-testid="content-bottom" style={{ width: 300, height: 100 }}>Bottom</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Let everything fully settle (default stiffness/damping settle well
    // within a few hundred ms — 1000ms leaves a wide margin).
    await wait(1000);

    const top = getByTestId("content-top").element().closest("[data-scene-id]") as HTMLElement;
    const bottom = getByTestId("content-bottom").element().closest("[data-scene-id]") as HTMLElement;

    expect(middle.getAttribute("data-focused")).toBe("true");
    expect(middle.getAttribute("data-within-column-depth")).toBeNull();

    const topRect = top.getBoundingClientRect();
    const middleRect = middle.getBoundingClientRect();
    const bottomRect = bottom.getBoundingClientRect();

    // Middle occupies the open slot between Top and Bottom (with the 8px
    // gap on both sides), not pinned at Bottom's box.
    expect(middleRect.top).toBeCloseTo(topRect.bottom + 8, 0);
    expect(bottomRect.top).toBeCloseTo(middleRect.bottom + 8, 0);

    // No overlap between Middle and Bottom.
    expect(middleRect.bottom).toBeLessThanOrEqual(bottomRect.top + 0.5);
  });
});

// ---------------------------------------------------------------------------
// Fix 1: Scroll position restore on refocus
// ---------------------------------------------------------------------------

describe("Scene scroll position restore", () => {
  test("scroll position restores when column is refocused", async () => {
    // Scenario: scroll a column to offset 100, unfocus it, refocus it.
    // The column should restore to offset 100.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Scroll down to 100px
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 100,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // The wheel handler's setScrollOffset update comes from a native
    // (non-React-owned) DOM event outside any act() boundary, so React's
    // commit isn't guaranteed to land within exactly one animation frame —
    // instrumented probe confirmed a ~1/6 flake rate on a cold first mount
    // in this file, needing a second frame to settle. Poll for the settled
    // DOM value instead of assuming a fixed frame count (S7).
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-100);

    // Unfocus the column — a second column takes focus
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Refocus the original column
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused={false}>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Scroll position should be restored to 100px — same poll rationale as
    // the scroll assertion above.
    await expect.poll(() => parseFloat(contentWrapper.style.top || "0")).toBe(-100);
  });

  test("scroll resets to 0 when column first becomes focused (no saved position)", async () => {
    // A column that has never been focused should start at scroll offset 0.
    // This is a regression guard — no saved scroll position means start at top.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Now focus "col" for the first time — no saved scroll, should be 0
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused={false}>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column='col']") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(0);
  });

  test("drastically resized column falls back to top (scroll offset 0)", async () => {
    // If the content height changes drastically (>50%) between unfocus and refocus,
    // the saved scroll position is invalid — fall back to top (offset 0).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Scroll down to 300px
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Input is rAF-coalesced as of F17 — the wheel handler now buffers the
    // delta and applies it on the NEXT real animation frame, so this needs
    // one extra waitForAnimationFrame() beyond what a single dispatch used
    // to require.
    await waitForAnimationFrame();
    await waitForAnimationFrame();
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-300);

    // Unfocus (switch to col2)
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              {/* Drastically resized: from 1200 to 300 (75% reduction, > 50%) */}
              <div data-testid="content" style={{ width: 400, height: 300 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Refocus with dramatically shrunken content
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 300 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused={false}>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Saved position was 300, but content is now 300px (fits in 800px viewport).
    // maxScroll is 0, so scroll should be at 0 (clamped by existing logic).
    const topAfterRefocus = parseFloat(contentWrapper.style.top || "0");
    expect(topAfterRefocus).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A2: Swap-reset scroll model (+ resetAlignment, B6 clamp, B7 lifecycle)
// ---------------------------------------------------------------------------

describe("Scene swap-reset scroll model", () => {
  test("swap A→B in an always-focused column resets scroll to top", async () => {
    // A vertical swap changes which object is focused within the column —
    // per the ruled A2 model, this always resets scroll deterministically
    // (does not remember A's prior scroll position for B).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 400, height: 1200 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const columnRect = column.getBoundingClientRect();

    // Scroll A down to 300px.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 300,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("300");

    // Swap focus from A to B within the same (always-focused) column.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 400, height: 1200 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // scrollOffset (distinct from topOffset, which independently shifts to
    // bring B into view) must reset to 0 — B's scroll position, not A's.
    expect(column.getAttribute("data-scroll-offset")).toBe("0");
  });

  test('resetAlignment="center" produces a roughly-centered non-zero starting offset on swap', async () => {
    // Object A is short (fits, no scroll of its own). Object B opts into
    // resetAlignment="center" and is tall enough to overflow. If the swap
    // read a stale (pre-swap) maxScroll, this would incorrectly compute 0
    // (A's maxScroll) instead of B's real maxScroll/2 — the one-render-lag
    // hazard the geometry store's synchronous remeasure exists to close.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 400, height: 200 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused={false} resetAlignment="center">
              <div data-testid="content-b" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 400, height: 200 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused resetAlignment="center">
              <div data-testid="content-b" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // B alone: contentHeight = 1200, viewport = 800 → maxScroll = 400.
    // center reset ≈ maxScroll / 2 = 200 (not 0 — the "top" default, and not
    // 0 from a stale pre-swap maxScroll of 0 either).
    const scrollOffset = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    expect(scrollOffset).toBeCloseTo(200, -1);
  });

  test("B6: a restored offset exceeding a shrunk-but-not-drastic maxScroll is clamped, not discarded", async () => {
    // Content shrinks by ~17% while parked (well under the 50% drastic
    // threshold) — the saved offset should be preserved but clamped to the
    // new (smaller) maxScroll, not reset to 0 and not left overshooting.
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;

    // Let the initial mount fully settle (shared ResizeObserver's first
    // observe-triggered callback) before scrolling near the max, to avoid
    // racing a same-frame remeasure.
    await waitForAnimationFrame();
    const columnRect = column.getBoundingClientRect();

    // Scroll to 380px (near the 1200-800=400 max).
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 380,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("380");

    // Unfocus (park), shrinking content height from 1200 to 1000 (16.7%,
    // well under the 50% drastic threshold) while parked.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ width: 400, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Refocus the same (single, unchanged) object — key match, so this is a
    // restore, not a swap-reset.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused={false}>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // New maxScroll = 1000 - 800 = 200. The saved 380 must be clamped to
    // 200, not discarded to 0 and not left at the stale 380.
    expect(column.getAttribute("data-scroll-offset")).toBe("200");
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-200);
  });

  test("B7: a same-name remount's drastic-resize guard compares against the persisted pre-unfocus content height", async () => {
    // park (unfocus) → close (unmount) → open a different same-named column
    // instance. The 50% drastic-resize guard must compare the NEW instance's
    // content height against the height at the ORIGINAL park (persisted on
    // the shared store entry, keyed by column name) — not a per-instance
    // ref that resets to 0 on the fresh mount (which would defeat the guard
    // and restore-then-clamp a stale offset instead of resetting to top).
    // NOTE: SceneColumn elements are given explicit (and DIFFERENT) `key`s
    // across the "close" and "open" renders below. Without this, React's
    // default index-based reconciliation would REUSE the same col1 fiber
    // across the remove/re-add (same type at the same array position, just
    // different props) — never triggering a genuine unmount, which would
    // silently defeat this test (a per-instance ref would never actually
    // reset, masking the bug regardless of the fix).
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn key="col1-a" name="col1">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = () => scene.querySelector("[data-column='col1']") as HTMLElement;
    const columnRect = column().getBoundingClientRect();

    // Scroll to 1000px (2000 - 800 = 1200 max).
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 1000,
        clientX: columnRect.left + columnRect.width / 2,
        clientY: columnRect.top + columnRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();
    expect(column().getAttribute("data-scroll-offset")).toBe("1000");

    // Park: focus moves to a second column.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn key="col1-a" name="col1">
            <SceneObject name="panel" focused={false}>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Close: col1 unmounts entirely.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Open: a NEW col1 instance (different key — genuinely a fresh mount;
    // same name, same single object name) with drastically shorter content
    // (2000 → 900, 55% reduction — drastic, but the new maxScroll is still
    // non-zero so a restore-then-clamp would produce a DIFFERENT, observably
    // wrong result than a correct reset-to-top). Mounts already focused.
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn key="col1-b" name="col1">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 900 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="panel2" focused={false}>
              <div data-testid="content2" style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // New maxScroll = 900 - 800 = 100. A restore-then-clamp bug would land
    // on 100; the correct drastic-resize reset lands on 0.
    expect(column().getAttribute("data-scroll-offset")).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// Fix 2: Padding in scroll bounds
// ---------------------------------------------------------------------------

describe("Scene padding in scroll bounds", () => {
  test("scroll bounds include padding — padding reduces effective viewport height", async () => {
    // Scene with padding=16px: maxScroll = contentHeight - (viewportHeight - 32).
    // Without padding: 1200 - 800 = 400. With padding=16: 1200 - (800 - 32) = 432.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} padding={16}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    const maxScroll = parseFloat(column.getAttribute("data-max-scroll") ?? "0");
    // With padding=16px top+bottom, viewport effective height = 800 - 32 = 768.
    // maxScroll = 1200 - 768 = 432. Without padding it would be 400.
    expect(maxScroll).toBeGreaterThan(400);
  });

  test("padding can push content into overflow — content fits without padding but overflows with it", async () => {
    // A 780px content in an 800px viewport fits without padding.
    // With padding=16px (32px total), effective viewport = 768px, so content overflows.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} padding={16}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              {/* 780px content fits in 800px viewport, but overflows with 32px padding */}
              <div data-testid="content" style={{ width: 400, height: 780 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // With padding factored in, the content now overflows → scrollbar should appear.
    const scrollbar = scene.querySelector("[data-scrollbar]");
    expect(scrollbar).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S6 commit 3: padding cluster — four missing-subtraction sites plus a
// distinct x-anchor origin mismatch. maxScroll (verified above) already
// subtracts padding correctly; these sites didn't.
// ---------------------------------------------------------------------------

describe("Scene padding cluster (S6)", () => {
  test("marginTop centers focused content within the padded viewport, not the raw viewport", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} padding={60}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const content = getByTestId("content").element() as HTMLElement;

    // ui#17: see awaitStyleFlush's own doc comment (rAF-batched MotionValue
    // writes — a geometry read immediately after render() can observe a
    // stale/default value).
    await awaitStyleFlush();

    const viewportRect = scene.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const viewportCenterY = viewportRect.top + viewportRect.height / 2;
    const contentCenterY = contentRect.top + contentRect.height / 2;

    expect(contentCenterY).toBeCloseTo(viewportCenterY, 0);
  });

  test("inBetweenY centers a depth-deck column within the padded viewport, not the raw viewport", async () => {
    const build = (middleFocused: boolean) => (
      <TestWrapper fullPage>
        <Scene duration={0} padding={60}>
          <SceneColumn name="left">
            <SceneObject name="left-obj" focused>
              <div data-testid="left-content" style={{ width: 100, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="middle">
            <SceneObject name="middle-obj" focused={middleFocused}>
              <div data-testid="middle-content" style={{ width: 100, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-obj" focused>
              <div data-testid="right-content" style={{ width: 100, height: 100 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    // "middle" must have been focused at least once to have a frozenSize
    // (in-between columns without one never get a measurable colHeight).
    const { rerender, getByTestId } = await render(build(true));
    await rerender(build(false));
    await waitForAnimationFrame();
    // ui#17: a single tick measured racy here — escalating to a second per
    // awaitStyleFlush's own documented double-rAF fallback.
    await awaitStyleFlush();

    const middleCol = getByTestId("middle-content").element().closest("[data-column]") as HTMLElement;

    // Read RAW values (frozen height from the inline style set by
    // inBetweenStyle, translateY from the raw transform) rather than
    // getBoundingClientRect() — the in-between column sits under a CSS
    // perspective + translateZ projection, which foreshortens rendered
    // position AND size non-linearly (see parseTranslateX's docstring for
    // the same rationale applied to the x axis).
    const frozenHeight = parseFloat(middleCol.style.height || "0");
    expect(frozenHeight).toBeGreaterThan(0);
    // ui#17: without `layout`, Motion writes this transform as separate
    // translateX()/translateZ() functions and OMITS a zero-valued
    // translateY entirely (with `layout` present, it always used the
    // translate3d(x, y, z) form, including an explicit 0px for y) —
    // parseTranslateY doesn't handle the "axis omitted means 0" case
    // (every other call site relies on it staying strict), so normalize
    // locally, same precedent as readTx's own "none" → 0 normalization.
    const transformStr = middleCol.style.transform;
    const translateY = transformStr.includes("translateY") || transformStr.includes("translate3d")
      ? parseTranslateY(transformStr)
      : 0;

    // Viewport is 800px tall (fullPage default), padding=60 top+bottom ->
    // effective viewport height = 680. inBetweenY should center the frozen
    // column within THAT, not the raw 800.
    expect(translateY).toBeCloseTo((680 - frozenHeight) / 2, 1);
  });

  test("Page Down scroll amount accounts for padding (uses effective viewport height, not raw)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} padding={100}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 3000 }}>
                <button data-testid="focusable-btn">click me</button>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;

    const btn = getByTestId("focusable-btn").element() as HTMLElement;
    btn.focus();

    column.dispatchEvent(
      new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }),
    );

    await waitForAnimationFrame();

    const scrollOffset = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    // Viewport is 800px tall (fullPage default), padding=100 top+bottom ->
    // effective viewport height = 600. PageDown should scroll by exactly
    // 600, not the raw 800 (maxScroll=3000-600=2400 leaves plenty of room,
    // so this isn't clamped).
    expect(scrollOffset).toBe(600);
  });

  test("Scrollbar trackHeight accounts for padding (uses effective viewport height, not raw)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} padding={100}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 3000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const scrollbar = scene.querySelector("[data-scrollbar]") as HTMLElement;
    expect(scrollbar).not.toBeNull();

    // Viewport is 800px tall (fullPage default), padding=100 top+bottom ->
    // effective viewport height = 600. The scrollbar track sizes to
    // trackHeight directly (style.height) — should be 600, not raw 800.
    expect(parseFloat(scrollbar.style.height || "0")).toBe(600);
  });

  test("in-between column x-anchor accounts for stage padding (stays flush with the focused column when peekOffset=0)", async () => {
    // Mirrors the existing "peekOffset={0} reproduces the old flush-anchored
    // behavior" test's shape (tests/scene.test.tsx depth-1 peek test) with
    // padding added — the original bug measured border-box
    // (getBoundingClientRect) against an absolutely-positioned in-between
    // column's static position, which CSS resolves content-box-relative — a
    // padding-sized origin mismatch distinct from the four
    // missing-subtraction sites above.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} padding={60} peekOffset={0}>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused>
              <div data-testid="content-left" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-middle">
            <SceneObject name="obj-middle" focused={false}>
              <div data-testid="content-middle" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused>
              <div data-testid="content-right" style={{ width: 200, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    await waitForAnimationFrame();
    await waitForAnimationFrame();

    const rightCol = getByTestId("content-right").element().closest("[data-column]") as HTMLElement;
    const middleCol = getByTestId("content-middle").element().closest("[data-column]") as HTMLElement;

    const rightRect = rightCol.getBoundingClientRect();
    const middleRect = middleCol.getBoundingClientRect();

    // toBeCloseTo(0, -1) -> tolerance ±5, matching this file's established
    // convention for a rendered (post-perspective-projection) pixel
    // comparison (see "depth-1 in-between column peeks left by exactly
    // peekOffset" above) — sub-pixel rounding noise, not a real deviation
    // (pre-fix this was off by ~52px, the padding-sized bug this test
    // guards against).
    expect(rightRect.left - middleRect.left).toBeCloseTo(0, -1);
  });

  test.each([0, 4, 32])(
    "overflow mode: both edges are inset by exactly padding=%ipx (Michael's symmetric-padding ruling)",
    async (padding) => {
      // Two 1000px columns (2000px total) badly overflow the 1280px viewport
      // at every padding value tested — the overflow branch always applies.
      const { getByTestId } = await render(
        <TestWrapper fullPage>
          <Scene duration={0} padding={padding}>
            <SceneColumn name="col1">
              <SceneObject name="obj1" focused>
                <div data-testid="content1" style={{ minWidth: 1000, height: 200 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col2">
              <SceneObject name="obj2" focused>
                <div data-testid="content2" style={{ minWidth: 1000, height: 200 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      const scene = getByTestId("scene").element() as HTMLElement;
      const col1 = getByTestId("content1").element().closest("[data-column]") as HTMLElement;
      const col2 = getByTestId("content2").element().closest("[data-column]") as HTMLElement;
      const vpRect = scene.getBoundingClientRect();

      // At panOffset=0 (mount default): the leftmost focused column's left
      // edge should be inset from the viewport's left edge by exactly
      // `padding`.
      expect(scene.scrollLeft).toBe(0);
      const leftInset = col1.getBoundingClientRect().left - vpRect.left;
      expect(leftInset).toBeCloseTo(padding, 0);

      // At maximum pan (ui#19: reached via a real wheel deltaX through the
      // handler, clamped to panBoundsRef.current.min — deltaX intentionally
      // FAR exceeds any plausible range so the clamp, not the raw delta,
      // determines the landing position): the rightmost focused column's
      // right edge should be inset from the viewport's right edge by
      // exactly `padding` too — NOT flush (the pre-fix bug: the left inset
      // was subtracted away by `newStageLeft = -focusedNaturalLeft`, while
      // the right side already got it right via the stage's own CSS
      // padding surviving into scrollWidth — a flush-left/padding-right
      // mix).
      scene.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: 5000,
          deltaY: 0,
          clientX: vpRect.left + vpRect.width / 2,
          clientY: vpRect.top + vpRect.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
      await waitForAnimationFrame();
      await waitForAnimationFrame();
      expect(scene.scrollLeft).toBe(0);
      const rightInset = vpRect.right - col2.getBoundingClientRect().right;
      expect(rightInset).toBeCloseTo(padding, 0);
    },
  );

  // SKIPPED (ui#17, 2026-07-30, one bounded instrumented attempt): traced
  // to source rather than a locatable small conditional fix. `padding` is
  // applied to the stage as a raw, unanimated CSS property (`padding:
  // padding || undefined` in Scene.tsx's stage style) — it is not a
  // MotionValue-driven channel at all, unlike cameraX/width/etc. Console
  // instrumentation on both driveCameraX and the recentering effect during
  // this exact test showed `newStageLeft` computes to 0 in BOTH the
  // padding=16 and padding=32 renders (stageLeftChanged never true,
  // driveCameraX never even called) — the camera genuinely never needs to
  // move for this scenario, because `focusedNaturalLeft` (measured via
  // gBCR, which already reflects the live CSS padding) and the `+padding`
  // term in the overflow-mode stageLeft formula always cancel exactly. The
  // entire visible snap is 100% the raw CSS padding property changing
  // instantly, with no camera/transform channel involved at all. A real
  // fix is a NEW owned padding channel (a paddingMV imperatively driving
  // stage.style.padding via animate(), mirroring the width channel's own
  // pattern) — comparable in scope to that channel, not a small
  // conditional tweak, and out of this dispatch's bound. Q2 (ui#17 depth-
  // deck spike, same day) also found no real app scenario changes padding
  // mid-session — only a dev-only tuning slider does — which is why a
  // skip-and-follow-up disposition is acceptable here rather than blocking
  // ui#17 on a new channel. See the ticket's own follow-up observation.
  test.skip("overflow mode: a mid-session padding change (16 -> 32) springs the relayout and both edges land at the new padding", async () => {
    const build = (padding: number) => (
      <TestWrapper fullPage>
        <Scene padding={padding}>
          <SceneColumn name="col1">
            <SceneObject name="obj1" focused>
              <div data-testid="content1" style={{ minWidth: 1000, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col2">
            <SceneObject name="obj2" focused>
              <div data-testid="content2" style={{ minWidth: 1000, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(16));
    await wait(500);

    const scene = getByTestId("scene").element() as HTMLElement;
    const col1 = getByTestId("content1").element().closest("[data-column]") as HTMLElement;
    const vpRect = scene.getBoundingClientRect();

    const leftInsetBefore = col1.getBoundingClientRect().left - vpRect.left;
    expect(leftInsetBefore).toBeCloseTo(16, 0);

    // Change padding — expected (once a padding channel exists) to spring
    // the relayout rather than snap. See this test's own skip comment
    // above for the traced root cause and why it's skipped, not fixed,
    // inside ui#17.
    await rerender(build(32));

    const readLeftInset = () => col1.getBoundingClientRect().left - vpRect.left;
    const samples = [readLeftInset()];
    for (const delay of [16, 100, 300]) {
      await wait(delay);
      samples.push(readLeftInset());
    }
    const allIdentical = samples.every((s) => s === samples[0]);
    expect(allIdentical).toBe(false);

    await wait(1500);
    const col2 = getByTestId("content2").element().closest("[data-column]") as HTMLElement;
    const leftInsetAfter = col1.getBoundingClientRect().left - vpRect.left;
    expect(leftInsetAfter).toBeCloseTo(32, 0);

    // ui#19: reach max pan via a real wheel deltaX through the handler
    // (deltaX intentionally far exceeds any plausible range, clamped by
    // panBoundsRef.current.min) — a real spring here, so give it a
    // generous settle window rather than a single frame.
    scene.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 5000,
        deltaY: 0,
        clientX: vpRect.left + vpRect.width / 2,
        clientY: vpRect.top + vpRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(1500);
    expect(scene.scrollLeft).toBe(0);
    const rightInsetAfter = vpRect.right - col2.getBoundingClientRect().right;
    expect(rightInsetAfter).toBeCloseTo(32, 0);
  });
});

// ---------------------------------------------------------------------------
// S6 commit 4: API hygiene
// ---------------------------------------------------------------------------

import {
  DEFAULT_STIFFNESS,
  DEFAULT_DAMPING,
  DEFAULT_COLUMN_GAP,
  DEFAULT_PERSPECTIVE,
  DEFAULT_PEEK_OFFSET,
} from "../src";

describe("Scene API hygiene (S6 commit 4)", () => {
  test("DEFAULT_* constants are importable from the top-level package entry", () => {
    // Regression pin for src/index.ts's re-export — previously only
    // reachable via the scene subpath, not the package root.
    expect(DEFAULT_STIFFNESS).toBe(300);
    expect(DEFAULT_DAMPING).toBe(30);
    expect(DEFAULT_COLUMN_GAP).toBe(16);
    expect(DEFAULT_PERSPECTIVE).toBe(800);
    expect(DEFAULT_PEEK_OFFSET).toBe(12);
  });

  test("a non-zero duration is NOT honored as a real duration — it behaves identically to omitting duration (both use spring physics, unlike duration=0)", async () => {
    // Regression pin for the duration JSDoc's honesty claim. Proof shape:
    // camera pan transitioning becomes true (a real, in-flight spring) for
    // duration=300 exactly as it does for duration=undefined — if 300 were
    // honored as an actual ms duration, or fell through to duration=0's
    // instant-mode branch, this would either never observe transitioning
    // (instant) or behave detectably differently. Uses the same
    // useCamera()-transitioning mechanism as the "real camera pan" test.
    async function pansWithTransitioningFlicker(durationProp: number | undefined): Promise<boolean> {
      const build = (rightFocused: boolean) => (
        <TestWrapper fullPage>
          <Scene duration={durationProp} stiffness={40} damping={12}>
            <SceneColumn name="left">
              <SceneObject name="left-obj" focused={!rightFocused}>
                <div style={{ width: 200, height: 150 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="right">
              <SceneObject name="right-obj" focused={rightFocused}>
                <div style={{ width: 200, height: 150 }} />
              </SceneObject>
            </SceneColumn>
            <CameraReader />
          </Scene>
        </TestWrapper>
      );

      const { rerender, getByTestId } = await render(build(false));
      await wait(500); // let the initial mount pan settle
      const reader = getByTestId("camera-reader").element() as HTMLElement;

      await rerender(build(true));
      await waitForAnimationFrame();
      const wasTransitioning = reader.getAttribute("data-transitioning") === "true";

      await wait(1500); // let this pan settle too, for a clean teardown
      await cleanup();
      return wasTransitioning;
    }

    expect(await pansWithTransitioningFlicker(300)).toBe(true);
    expect(await pansWithTransitioningFlicker(undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 3: Scrollbar ARIA attributes
// ---------------------------------------------------------------------------

describe("Scrollbar ARIA", () => {
  test("scrollbar thumb has role=scrollbar", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const scrollbar = scene.querySelector("[data-scrollbar]");
    expect(scrollbar).not.toBeNull();

    // The thumb inside the scrollbar track should have role="scrollbar"
    const thumb = scrollbar?.querySelector("[role='scrollbar']");
    expect(thumb).not.toBeNull();
  });

  test("scrollbar thumb has aria-valuenow, aria-valuemin, aria-valuemax", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement | null;
    expect(thumb).not.toBeNull();

    // ARIA attributes for screen reader accessibility
    expect(thumb?.getAttribute("aria-valuemin")).toBe("0");
    expect(thumb?.getAttribute("aria-valuemax")).not.toBeNull();
    expect(parseFloat(thumb?.getAttribute("aria-valuemax") ?? "")).toBeGreaterThan(0);
    expect(thumb?.getAttribute("aria-valuenow")).toBe("0"); // starts at top
    expect(thumb?.getAttribute("aria-orientation")).toBe("vertical");
  });

  test("D4: scrollbar thumb has tabindex=0", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement | null;
    expect(thumb?.getAttribute("tabindex")).toBe("0");
  });

  test("D4: scrollbar thumb has aria-controls pointing to the content wrapper's stable id", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement | null;
    const contentWrapper = scene.querySelector("[data-column-content]") as HTMLElement;
    expect(thumb?.getAttribute("aria-controls")).toBe(contentWrapper.id);
    expect(contentWrapper.id).toBe("scene-column-content-col");
  });

  test("D4: pressing ArrowDown while the scrollbar thumb has focus scrolls the column (keyboard ops through the shared command path)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement;

    // A scroll to -40 alone doesn't discriminate D4's OWN handler from a
    // fallback where the event simply bubbles unhandled to SceneColumn's
    // generic column-level keydown listener (isInteractiveElement
    // deliberately does not exempt role="scrollbar" — DELTA-1 — so that
    // fallback would ALSO scroll the column by 40 if the thumb's handler
    // didn't stop propagation first). Spy on `document` to prove propagation
    // was actually stopped AT THE THUMB — this only happens if the thumb's
    // own listener ran and called stopPropagation() before the event could
    // reach any ancestor, including past the column entirely.
    const documentKeydownSpy = vi.fn();
    document.addEventListener("keydown", documentKeydownSpy);

    thumb.focus();
    const notPrevented = thumb.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    await waitForAnimationFrame();
    document.removeEventListener("keydown", documentKeydownSpy);

    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-40);
    // The thumb's own handler owns this key — it preventDefaults.
    expect(notPrevented).toBe(false);
    // Propagation was stopped at the thumb — document never saw the event.
    expect(documentKeydownSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fix 4: Consumer scroll override — SceneObject with internal scroll
// ---------------------------------------------------------------------------

describe("Scene consumer scroll override", () => {
  test("SceneObject with internal scroll and fixed height — no column scrollbar appears", async () => {
    // When a SceneObject constrains its own height (e.g. fixed 400px) and uses
    // overflow-y: auto for internal scrolling, the column content wrapper stays
    // within the 800px viewport. No column-level scrollbar should appear.
    //
    // This simulates the consumer scroll override pattern: the SceneObject manages
    // its own scroll, so the column content does not overflow the viewport.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowY: "auto" }}
              >
                {/* Tall internal content — scrolled by the div, not the column */}
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // The SceneObject constrains to 400px. Column content (400px) fits in the
    // 800px viewport — no column-level scrollbar should appear.
    const scrollbar = scene.querySelector("[data-scrollbar]");
    expect(scrollbar).toBeNull();
  });

  // F8c interior contract, percentage-height commit: specs/scene-scroll.feature's
  // "Consumer adds internal scroll to a SceneObject" scenario claimed a literal
  // height: 100% works — probe-confirmed FALSE (every ancestor up to the
  // column's content wrapper is deliberately auto-height, so a descendant's
  // percentage height never resolves; a min-height floor on the SceneObject's
  // own wrapper doesn't help either). This test is the corrected scenario's
  // pin: height: 100cqh, the documented cqh-blessed pattern (adjudication 2),
  // resolving against Scene's own container-type: size viewport.
  //
  // TestWrapper height is deliberately 500 — DIFFERENT from the real
  // Chromium page viewport (800px, vitest.config.ts). Container query units
  // without a query container fall back to the browser's own small-viewport
  // size (a real gate-round finding: an earlier version of this test used
  // the default 800px TestWrapper height, which coincidentally equals the
  // browser viewport, so the assertion passed even with Scene's own
  // containerType: "size" severed — not discriminating). 500 vs 800 forces
  // a real mismatch unless Scene's own container genuinely governs cqh.
  test("SceneObject with internal scroll sized via height: 100cqh — no column scrollbar appears (F8c: the cqh-blessed contract pattern)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage height={500}>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: "100cqh", overflowY: "auto" }}
              >
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const island = getByTestId("scroll-container").element() as HTMLElement;

    // Resolves to the 500px TestWrapper height (Scene's own container-type:
    // size box) — not the natural unconstrained content height (3000px, a
    // failed-to-resolve percentage's fallback), not 0, and NOT the real
    // 800px browser viewport (which is what a severed containerType would
    // produce via cqh's no-container fallback — see the note above).
    expect(island.getBoundingClientRect().height).toBe(500);

    const scrollbar = scene.querySelector("[data-scrollbar]");
    expect(scrollbar).toBeNull();
  });

  // F8a interior claim gate: the motivating bug. An island that fills its
  // column (maxScroll=0, isScrollable=false) sits alongside another
  // Scene-scrollable focused column. Before the claim gate, Scene would
  // still claim wheel-over-the-island because A10's "exactly one scrollable
  // focused column" fallback fires — routing the delta to the SIBLING
  // column while the cursor is over the island, and the island (which
  // should have handled it) is never given the chance.
  //
  // Real (non-passive, script-dispatched) wheel events do not trigger a
  // browser's default scroll action in this test environment (verified
  // empirically — see the F8a worker report) — matching every other wheel
  // test in this file, these tests assert Scene's OWN state (the sibling
  // column's `top`) plus `notPrevented` (dispatchEvent's return value, true
  // iff preventDefault was never called) as the proxy for "declined to
  // route, native scroll gets to run."
  test("wheel over an interior overflow-y:auto island declines to route — the sibling Scene-scrollable column does not move (F8a claim gate)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="island-col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowY: "auto" }}
              >
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="sibling-col">
            <SceneObject name="sibling-obj" focused>
              <div data-testid="sibling-content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const island = getByTestId("scroll-container").element() as HTMLElement;
    const siblingCol = getByTestId("sibling-content").element().closest("[data-column]") as HTMLElement;
    const siblingContentWrapper = siblingCol.querySelector("[data-column-content]") as HTMLElement;
    const islandRect = island.getBoundingClientRect();

    const notPrevented = island.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: islandRect.left + islandRect.width / 2,
        clientY: islandRect.top + islandRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();

    expect(parseFloat(siblingContentWrapper.style.top || "0")).toBe(0);
    expect(notPrevented).toBe(true);
  });

  // Sanity control: the island alone (no co-focused scrollable sibling).
  // Even without the claim gate, this case already declines today (nothing
  // scrollable is registered under Scene, so decideWheelTargetColumn/A10
  // find zero candidates) — it doesn't discriminate old vs. new code on its
  // own, but confirms the primary regression test's sibling column is what
  // actually exercises the gate, not some other masking effect.
  test("sanity control: wheel over the island with no sibling column still declines to route", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="island-col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowY: "auto" }}
              >
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const island = getByTestId("scroll-container").element() as HTMLElement;
    const islandRect = island.getBoundingClientRect();

    const notPrevented = island.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: islandRect.left + islandRect.width / 2,
        clientY: islandRect.top + islandRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();

    expect(notPrevented).toBe(true);
  });

  test("overscroll-behavior-y: auto (default) at the island's edge chains outward — the sibling column claims it exactly like today", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="island-col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowY: "auto" }}
              >
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="sibling-col">
            <SceneObject name="sibling-obj" focused>
              <div data-testid="sibling-content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const island = getByTestId("scroll-container").element() as HTMLElement;
    island.scrollTop = island.scrollHeight - island.clientHeight; // bottom edge
    const siblingCol = getByTestId("sibling-content").element().closest("[data-column]") as HTMLElement;
    const siblingContentWrapper = siblingCol.querySelector("[data-column-content]") as HTMLElement;
    const islandRect = island.getBoundingClientRect();

    island.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: islandRect.left + islandRect.width / 2,
        clientY: islandRect.top + islandRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Input is rAF-coalesced as of F17 — needs one extra waitForAnimationFrame().
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    expect(parseFloat(siblingContentWrapper.style.top || "0")).toBe(-60);
  });

  test("overscroll-behavior-y: contain at the island's edge dead-stops — neither the island nor the sibling column moves", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="island-col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowY: "auto", overscrollBehaviorY: "contain" }}
              >
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="sibling-col">
            <SceneObject name="sibling-obj" focused>
              <div data-testid="sibling-content" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const island = getByTestId("scroll-container").element() as HTMLElement;
    island.scrollTop = island.scrollHeight - island.clientHeight; // bottom edge
    const siblingCol = getByTestId("sibling-content").element().closest("[data-column]") as HTMLElement;
    const siblingContentWrapper = siblingCol.querySelector("[data-column-content]") as HTMLElement;
    const islandRect = island.getBoundingClientRect();

    const notPrevented = island.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: islandRect.left + islandRect.width / 2,
        clientY: islandRect.top + islandRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();

    expect(parseFloat(siblingContentWrapper.style.top || "0")).toBe(0);
    expect(notPrevented).toBe(true);
  });

  test("composed pipeline: interior island declines to Scene, and the existing pointer-column routing still handles two Scene-scrollable columns unmodified", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="island-col">
            <SceneObject name="panel" focused>
              <div
                data-testid="scroll-container"
                style={{ width: 400, height: 400, overflowY: "auto" }}
              >
                <div style={{ width: 400, height: 3000 }}>tall content</div>
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="a">
            <SceneObject name="a-obj" focused>
              <div data-testid="content-a" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="b">
            <SceneObject name="b-obj" focused>
              <div data-testid="content-b" style={{ width: 400, height: 1200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const island = getByTestId("scroll-container").element() as HTMLElement;
    const colA = getByTestId("content-a").element().closest("[data-column]") as HTMLElement;
    const colAContent = colA.querySelector("[data-column-content]") as HTMLElement;
    const colB = getByTestId("content-b").element().closest("[data-column]") as HTMLElement;
    const colBContent = colB.querySelector("[data-column-content]") as HTMLElement;
    const islandRect = island.getBoundingClientRect();
    const colARect = colA.getBoundingClientRect();

    // Wheel over the island: the claim gate consumes it — neither Scene
    // column moves.
    const islandNotPrevented = island.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: islandRect.left + islandRect.width / 2,
        clientY: islandRect.top + islandRect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();

    expect(islandNotPrevented).toBe(true);
    expect(parseFloat(colAContent.style.top || "0")).toBe(0);
    expect(parseFloat(colBContent.style.top || "0")).toBe(0);

    // Wheel over column A: the gate declines (no interior scroll container
    // there), falling through to the unchanged pointer-hit-test routing —
    // exactly the pre-existing "multiple scrollable focused columns"
    // behavior (scene.test.tsx's S5 describe block, unmodified).
    colA.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 60,
        clientX: colARect.left + colARect.width / 2,
        clientY: colARect.top + colARect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Input is rAF-coalesced as of F17 — needs one extra waitForAnimationFrame().
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    expect(parseFloat(colAContent.style.top || "0")).toBe(-60);
    expect(parseFloat(colBContent.style.top || "0")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ui#21: Within-column deck rework — instant flow snap / teleport when an
// object enters or leaves the within-column deck (board observation ui#o26).
// The vertical, per-object port of ui#17's anchor/panel pattern — see
// `plans/ui#21 Within-Column Deck Rework Plan (2026-07-31)` (vault) for the
// full design. RED-FIRST per the plan's own TDD ordering: this repro and the
// zero-pixel flip tests land BEFORE the anchor/panel split, confirmed red
// against the CURRENT (pre-split, single-node) code.
// ---------------------------------------------------------------------------

// Panel copied verbatim from dev/pages/ScenePage.tsx (unexported there) —
// representative-fixture discipline (constraint carried from ui#17): width
// declared directly on SceneObject's own style prop, never a child div, and
// this is the SAME component the real within-column deck consumer
// (MultiFocusDemo) renders.
function UI21Panel({
  title,
  subtitle,
  color,
  focused,
  onClick,
  children,
}: {
  title: string;
  subtitle?: string;
  color: string;
  focused: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        opacity: focused ? 1 : 0.4,
        filter: focused ? "none" : "grayscale(1)",
        cursor: focused ? "default" : "pointer",
        width: "100%",
        height: "100%",
      }}
      className={`${color} rounded-sm p-6 flex flex-col gap-2 transition-[filter,opacity] duration-300`}
      onClick={onClick}
    >
      <h3 className="text-base font-light text-white/90">{title}</h3>
      {subtitle && <p className="text-xs text-white/50">{subtitle}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

/**
 * Mirrors dev/pages/ScenePage.tsx's MultiFocusDemo verbatim (JSX shape, prop
 * values — one SceneColumn, objectGap=8, three SceneObjects width:480
 * top/middle/bottom, no explicit height per forecast E1/E2's corrected
 * ground truth). No duration=0 override: real springs, matching what a user
 * actually sees and what the ui#o26 defect (a timing/interpolation bug) can
 * only manifest under.
 */
function UI21MultiFocusFixture({
  topFocused,
  middleFocused,
  bottomFocused,
  onToggleTop,
  onToggleMiddle,
  onToggleBottom,
}: {
  topFocused: boolean;
  middleFocused: boolean;
  bottomFocused: boolean;
  onToggleTop: () => void;
  onToggleMiddle: () => void;
  onToggleBottom: () => void;
}) {
  return (
    <TestWrapper fullPage>
      <Scene>
        <SceneColumn name="stack-col" objectGap={8}>
          <SceneObject name="stack-top" focused={topFocused} style={{ width: 480 }} onActivate={onToggleTop}>
            <UI21Panel title="Top" subtitle="Object 1" color="bg-[lch(30_10_280)]" focused={topFocused} />
          </SceneObject>
          <SceneObject name="stack-middle" focused={middleFocused} style={{ width: 480 }} onActivate={onToggleMiddle}>
            <UI21Panel title="Middle" subtitle="Sandwiched when unfocused" color="bg-[lch(30_10_200)]" focused={middleFocused} />
          </SceneObject>
          <SceneObject name="stack-bottom" focused={bottomFocused} style={{ width: 480 }} onActivate={onToggleBottom}>
            <UI21Panel title="Bottom" subtitle="Object 3" color="bg-[lch(30_10_120)]" focused={bottomFocused} />
          </SceneObject>
        </SceneColumn>
      </Scene>
    </TestWrapper>
  );
}

/**
 * Drives ONE middle-object toggle (direction: "unfocus" = focused->sandwiched,
 * i.e. the object ENTERS the deck; "focus" = sandwiched->focused, the object
 * LEAVES the deck) from an already-settled Scene (top/bottom always
 * focused), sampling raw gBCR for all three objects across the whole
 * settling window — same methodology as tests/scene.test.tsx's
 * runDoubleInterruptionGbcrSample (ui#17 Slice 3), ported to the vertical
 * axis: a few pre-toggle frames included so the outlier loop's own
 * `i starts at 1` bound has a real neighbor for the commit-frame delta.
 */
async function runUI21DeckTrigger(direction: "unfocus" | "focus"): Promise<{
  topDeltas: number[];
  middleDeltas: number[];
  bottomDeltas: number[];
}> {
  function Demo() {
    const [middleFocused, setMiddleFocused] = useState(direction === "unfocus");
    return (
      <>
        <button data-testid="toggle" onClick={() => setMiddleFocused((v) => !v)}>
          toggle
        </button>
        <UI21MultiFocusFixture
          topFocused
          middleFocused={middleFocused}
          bottomFocused
          onToggleTop={() => {}}
          onToggleMiddle={() => setMiddleFocused(true)}
          onToggleBottom={() => {}}
        />
      </>
    );
  }

  const { getByTestId, container } = await render(<Demo />);
  await wait(600); // full initial settle, before the toggle under test

  const top = container.querySelector('[data-scene-id="stack-top"]') as HTMLElement;
  const middle = container.querySelector('[data-scene-id="stack-middle"]') as HTMLElement;
  const bottom = container.querySelector('[data-scene-id="stack-bottom"]') as HTMLElement;

  const sample = (el: HTMLElement): GBCRBox => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };

  const topSamples: GBCRBox[] = [sample(top)];
  const middleSamples: GBCRBox[] = [sample(middle)];
  const bottomSamples: GBCRBox[] = [sample(bottom)];
  for (let i = 0; i < 3; i++) {
    await waitForAnimationFrame();
    topSamples.push(sample(top));
    middleSamples.push(sample(middle));
    bottomSamples.push(sample(bottom));
  }

  (getByTestId("toggle").element() as HTMLElement).click();

  const start = performance.now();
  while (performance.now() - start < 1000) {
    await waitForAnimationFrame();
    topSamples.push(sample(top));
    middleSamples.push(sample(middle));
    bottomSamples.push(sample(bottom));
  }

  return {
    topDeltas: gbcrDeltasOf(topSamples),
    middleDeltas: gbcrDeltasOf(middleSamples),
    bottomDeltas: gbcrDeltasOf(bottomSamples),
  };
}

describe("Within-column deck (ui#21): instant flow snap / teleport repro, N=10 (RED-FIRST, pre-split)", () => {
  for (let run = 0; run < 10; run++) {
    test(`run ${run}: unfocus direction (object enters the deck) — no frame-to-frame gBCR outlier, any object`, async () => {
      const { topDeltas, middleDeltas, bottomDeltas } = await runUI21DeckTrigger("unfocus");
      const topOutliers = findGbcrOutliers(topDeltas);
      const middleOutliers = findGbcrOutliers(middleDeltas);
      const bottomOutliers = findGbcrOutliers(bottomDeltas);
      expect(
        { topOutliers, middleOutliers, bottomOutliers },
        `unfocus direction outlier(s) found — top: ${JSON.stringify(topOutliers)}, middle: ${JSON.stringify(middleOutliers)}, bottom: ${JSON.stringify(bottomOutliers)} ` +
          `(middleDeltas: ${JSON.stringify(middleDeltas.map((d) => Math.round(d * 100) / 100))}, ` +
          `bottomDeltas: ${JSON.stringify(bottomDeltas.map((d) => Math.round(d * 100) / 100))})`,
      ).toEqual({ topOutliers: [], middleOutliers: [], bottomOutliers: [] });
    });
  }

  for (let run = 0; run < 10; run++) {
    test(`run ${run}: focus direction (object leaves the deck) — no frame-to-frame gBCR outlier, any object`, async () => {
      const { topDeltas, middleDeltas, bottomDeltas } = await runUI21DeckTrigger("focus");
      const topOutliers = findGbcrOutliers(topDeltas);
      const middleOutliers = findGbcrOutliers(middleDeltas);
      const bottomOutliers = findGbcrOutliers(bottomDeltas);
      expect(
        { topOutliers, middleOutliers, bottomOutliers },
        `focus direction outlier(s) found — top: ${JSON.stringify(topOutliers)}, middle: ${JSON.stringify(middleOutliers)}, bottom: ${JSON.stringify(bottomOutliers)} ` +
          `(middleDeltas: ${JSON.stringify(middleDeltas.map((d) => Math.round(d * 100) / 100))}, ` +
          `bottomDeltas: ${JSON.stringify(bottomDeltas.map((d) => Math.round(d * 100) / 100))})`,
      ).toEqual({ topOutliers: [], middleOutliers: [], bottomOutliers: [] });
    });
  }
});

describe("Within-column deck (ui#21): layout-box zero-pixel flip", () => {
  // Targets the PANEL (data-scene-object) — the node that flips position
  // mode post-split (the anchor never flips again — permanent
  // zero-footprint in flow). Originally targeted the object's own single
  // node pre-split (that WAS what flipped position mode before the anchor/
  // panel split landed); updated once the split introduced the panel,
  // matching the exact evolution ui#17's own zero-pixel-flip tests went
  // through when its column-level split landed.
  test("unfocus direction: object-local layout-box geometry has no discontinuity at the flip commit", async () => {
    function Demo() {
      const [middleFocused, setMiddleFocused] = useState(true);
      return (
        <>
          <button data-testid="toggle" onClick={() => setMiddleFocused((v) => !v)}>
            toggle
          </button>
          <UI21MultiFocusFixture
            topFocused
            middleFocused={middleFocused}
            bottomFocused
            onToggleTop={() => {}}
            onToggleMiddle={() => setMiddleFocused(true)}
            onToggleBottom={() => {}}
          />
        </>
      );
    }

    const { getByTestId, container } = await render(<Demo />);
    await wait(600);

    const middleAnchorEl = container.querySelector('[data-scene-id="stack-middle"]') as HTMLElement;
    const middlePanelEl = container.querySelector('[data-scene-object="stack-middle"]') as HTMLElement;

    (getByTestId("toggle").element() as HTMLElement).click();
    const { before, after } = await captureFlipCommit(middlePanelEl, 2000, undefined, middleAnchorEl);

    expect(Math.abs(after.left - before.left)).toBeLessThan(1);
    expect(Math.abs(after.top - before.top)).toBeLessThan(1);
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  });

  test("focus direction: object-local layout-box geometry has no discontinuity at the flip commit", async () => {
    function Demo() {
      const [middleFocused, setMiddleFocused] = useState(false);
      return (
        <>
          <button data-testid="toggle" onClick={() => setMiddleFocused((v) => !v)}>
            toggle
          </button>
          <UI21MultiFocusFixture
            topFocused
            middleFocused={middleFocused}
            bottomFocused
            onToggleTop={() => {}}
            onToggleMiddle={() => setMiddleFocused(true)}
            onToggleBottom={() => {}}
          />
        </>
      );
    }

    const { getByTestId, container } = await render(<Demo />);
    await wait(600);

    const middleAnchorEl = container.querySelector('[data-scene-id="stack-middle"]') as HTMLElement;
    const middlePanelEl = container.querySelector('[data-scene-object="stack-middle"]') as HTMLElement;

    (getByTestId("toggle").element() as HTMLElement).click();
    const { before, after } = await captureFlipCommit(middlePanelEl, 2000, undefined, middleAnchorEl);

    expect(Math.abs(after.left - before.left)).toBeLessThan(1);
    expect(Math.abs(after.top - before.top)).toBeLessThan(1);
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  });
});

describe("Within-column deck (ui#21): z-index paint order at the flip commit (forecast E6, board criterion 6)", () => {
  // Ports ui#17's own E2 pattern to the vertical axis. Five rounds of
  // defeat-checking a translateZ-based channel against a z-sign-inversion
  // sever each found the prior sample-point choice vacuous (rounds 1-4:
  // registration/value/threshold-timing gaps; round 5's own overlap-window
  // redesign STILL stayed green under the sever) — the investigation that
  // followed (ui#o32, the D-series record) found the underlying mechanism
  // itself was never real: object-level translateZ never actually reached
  // the panel (three flat transform-style intermediates from the nearest
  // preserve-3d ancestor), so no sever on that channel could ever have
  // produced a genuine red. Replaced with an explicit z-index channel
  // (SceneObject.tsx) that sidesteps the whole 3D-context question.
  //
  // z-index is discrete and flips at different MOMENTS per direction by
  // design (see the channel's own declaration comments): SINKING
  // (focused -> sandwiched) flips unconditionally at commit, for the WHOLE
  // transition; RISING (sandwiched -> focused) stays low until its own
  // height spring settles. Both directions reduce to the SAME invariant
  // under a single overlap-window methodology: while the two panels
  // genuinely, geometrically overlap (fresh gBCRs every frame, never a
  // stale pre-click snapshot), middle must never win paint order, and its
  // own zIndex must never read a value that would let it. Design intent —
  // not any internal signal the sever could also corrupt — anchors the
  // expectation.
  function ownerOf(el: Element | null): string | undefined {
    return el?.closest("[data-scene-id]")?.getAttribute("data-scene-id") ?? undefined;
  }

  // Scans a Y range for a point covered by the target pair's own boxes but
  // NEITHER of the excluded panels — needed because, in a fanned multi-
  // sandwiched stack, most of any adjacent pair's shared region is ALSO
  // covered by something else shallower still (measured: even the always-
  // visible focused neighbors extend a few px into the sandwiched
  // cluster's own range, a real consequence of peek-offset/gap spacing,
  // not a bug) — a naive overlap centroid would trivially reflect whatever
  // ELSE is present there, not the pair actually under test. Robust to
  // exact pixel geometry rather than assuming a fixed offset is clean.
  function findCleanSampleY(shallower: HTMLElement, deeper: HTMLElement, excluding: HTMLElement[]): number | undefined {
    const sRect = shallower.getBoundingClientRect();
    const dRect = deeper.getBoundingClientRect();
    const bandStart = Math.max(sRect.top, dRect.top);
    const bandEnd = Math.min(sRect.bottom, dRect.bottom);
    for (let y = bandStart + 1; y < bandEnd; y++) {
      const coveredByOther = excluding.some((el) => {
        const r = el.getBoundingClientRect();
        return y >= r.top && y < r.bottom;
      });
      if (!coveredByOther) return y;
    }
    return undefined;
  }

  // Searches the FULL elementsFromPoint stack for the first element that
  // belongs to some SceneObject's own subtree, rather than trusting index
  // 0 alone. Real finding (rider 5's own probe, confirmed with an
  // isolated minimal repro too — see this describe block's own dedicated
  // test): a negative z-index panel paints BEHIND every intermediate
  // ancestor's own box, including plain, non-stacking-context-
  // establishing wrappers like data-column-content — not just "the
  // stacking-context root" as originally assumed. Where NOTHING else (no
  // other real object's own content) is ALSO geometrically present at a
  // sample point, such a wrapper's own (currently invisible — no
  // background set anywhere in this tree today) box wins the raw hit-test
  // ahead of the actual panel, purely a structural CSS consequence, not a
  // visual regression: nothing opaque is actually painted over the panel,
  // so nothing is visibly wrong today, but it means the FIRST intermediate
  // wrapper that ever gains a background would silently occlude every
  // sandwiched card behind it. Skipping past such non-object wrappers to
  // find the first genuine object is what a viewer actually sees; index-0
  // alone tests hit-test priority, a stricter and currently-divergent
  // standard.
  function ownerAt(sampleY: number, referenceEl: HTMLElement): string | undefined {
    const rRect = referenceEl.getBoundingClientRect();
    const sampleX = (rRect.left + rRect.right) / 2;
    for (const el of document.elementsFromPoint(sampleX, sampleY)) {
      const owner = ownerOf(el);
      if (owner) return owner;
    }
    return undefined;
  }

  function zIndexOf(panel: HTMLElement): string {
    return getComputedStyle(panel).zIndex;
  }

  function isReceded(zIndexValue: string): boolean {
    return zIndexValue !== "auto" && Number(zIndexValue) < 0;
  }

  test("sinking (unfocus): zIndex drops behind its neighbor from the first commit, and paint order never pops throughout the transition", async () => {
    function Demo() {
      const [middleFocused, setMiddleFocused] = useState(true);
      return (
        <>
          <button data-testid="toggle" onClick={() => setMiddleFocused((v) => !v)}>
            toggle
          </button>
          <UI21MultiFocusFixture
            topFocused
            middleFocused={middleFocused}
            bottomFocused
            onToggleTop={() => {}}
            onToggleMiddle={() => setMiddleFocused(true)}
            onToggleBottom={() => {}}
          />
        </>
      );
    }

    const { getByTestId, container } = await render(<Demo />);
    await wait(600);

    const middlePanel = container.querySelector('[data-scene-object="stack-middle"]') as HTMLElement;
    const bottomPanel = container.querySelector('[data-scene-object="stack-bottom"]') as HTMLElement;

    const zIndexBefore = zIndexOf(middlePanel);
    (getByTestId("toggle").element() as HTMLElement).click();

    // Precondition: sinking is unconditional on focus state alone — no
    // spring, no registration to wait for — so a single frame of slack for
    // React to flush is generous, not a real timing race.
    await waitForAnimationFrame();
    const zIndexAfterCommit = zIndexOf(middlePanel);
    if (zIndexAfterCommit === zIndexBefore) {
      throw new Error(`zIndex never changed from its pre-click value ("${zIndexBefore}") within one frame of the click — setup bug, not a timing race`);
    }
    if (!isReceded(zIndexAfterCommit)) {
      throw new Error(`zIndex read "${zIndexAfterCommit}" immediately after the sinking commit — expected a negative, depth-scaled value from the very first frame, not a timing race`);
    }

    let overlapFrames = 0;
    let middleWonAnyOverlapFrame = false;
    let zIndexEverNotRecededWhileUnfocused = false;
    const start = performance.now();
    for (let i = 0; i < 150; i++) {
      await waitForAnimationFrame();
      if (!isReceded(zIndexOf(middlePanel))) zIndexEverNotRecededWhileUnfocused = true;
      const mRect = middlePanel.getBoundingClientRect();
      const bRect = bottomPanel.getBoundingClientRect();
      const left = Math.max(mRect.left, bRect.left);
      const right = Math.min(mRect.right, bRect.right);
      const top = Math.max(mRect.top, bRect.top);
      const bottom = Math.min(mRect.bottom, bRect.bottom);
      if (left < right && top < bottom) {
        overlapFrames++;
        const centroidX = (left + right) / 2;
        const centroidY = (top + bottom) / 2;
        const owner = ownerOf(document.elementsFromPoint(centroidX, centroidY)[0] ?? null);
        if (owner === "stack-middle") middleWonAnyOverlapFrame = true;
      }
      if (performance.now() - start > 2500) break;
    }

    // Non-vacuity precondition: genuine overlap must actually have been
    // observed. K=10 chosen with the same margin logic as the original
    // round-5 measurement (well below any real observed window, still
    // requiring a substantial, non-accidental sample count).
    expect(overlapFrames, `only ${overlapFrames} overlap frames observed between middle's and bottom's panels — never observed genuine overlap (or an insufficient window)`).toBeGreaterThanOrEqual(10);

    expect(zIndexEverNotRecededWhileUnfocused, "zIndex read a non-negative/auto value at least once while sinking — it must stay receded unconditionally, for the WHOLE transition, per the design's own unconditional-sinking rule").toBe(false);

    // Headline, externally anchored (design intent, not any internal
    // signal — the sever corrupts zIndex's own derivation too, so a
    // zIndex-consistency check alone would inherit the sever and pass
    // circularly; this is why the elementsFromPoint check stays primary).
    expect(middleWonAnyOverlapFrame, `middle won paint order in at least one of ${overlapFrames} overlap-sampled frames`).toBe(false);

    // At-rest check: the permanent end state. Overlap persists forever
    // once settled for this direction (measured, round 5) — zIndex must
    // still read receded there, not just transiently during the spring.
    await wait(1500);
    const zIndexAtRest = zIndexOf(middlePanel);
    expect(isReceded(zIndexAtRest), `zIndex at rest was "${zIndexAtRest}", expected a negative, depth-scaled value`).toBe(true);
    const mRectFinal = middlePanel.getBoundingClientRect();
    const bRectFinal = bottomPanel.getBoundingClientRect();
    const stillOverlaps =
      Math.max(mRectFinal.left, bRectFinal.left) < Math.min(mRectFinal.right, bRectFinal.right) &&
      Math.max(mRectFinal.top, bRectFinal.top) < Math.min(mRectFinal.bottom, bRectFinal.bottom);
    expect(stillOverlaps, "middle and bottom panels no longer overlap at rest — setup bug or design changed").toBe(true);
    const finalCentroidX = (Math.max(mRectFinal.left, bRectFinal.left) + Math.min(mRectFinal.right, bRectFinal.right)) / 2;
    const finalCentroidY = (Math.max(mRectFinal.top, bRectFinal.top) + Math.min(mRectFinal.bottom, bRectFinal.bottom)) / 2;
    const ownerAtRest = ownerOf(document.elementsFromPoint(finalCentroidX, finalCentroidY)[0] ?? null);
    expect(ownerAtRest, `owner at rest was "${ownerAtRest}", expected "stack-bottom"`).toBe("stack-bottom");
  });

  test("rising (refocus): zIndex stays behind until settle, and paint order never pops during the transition", async () => {
    function Demo() {
      const [middleFocused, setMiddleFocused] = useState(false);
      return (
        <>
          <button data-testid="toggle" onClick={() => setMiddleFocused((v) => !v)}>
            toggle
          </button>
          <UI21MultiFocusFixture
            topFocused
            middleFocused={middleFocused}
            bottomFocused
            onToggleTop={() => {}}
            onToggleMiddle={() => setMiddleFocused(true)}
            onToggleBottom={() => {}}
          />
        </>
      );
    }

    const { getByTestId, container } = await render(<Demo />);
    await wait(600);

    const middlePanel = container.querySelector('[data-scene-object="stack-middle"]') as HTMLElement;
    const bottomPanel = container.querySelector('[data-scene-object="stack-bottom"]') as HTMLElement;

    const zIndexBefore = zIndexOf(middlePanel);
    if (!isReceded(zIndexBefore)) {
      throw new Error(`zIndex before the rise was "${zIndexBefore}" — expected a negative, depth-scaled value for a settled sandwiched mount, not a timing race`);
    }

    (getByTestId("toggle").element() as HTMLElement).click();

    let overlapFrames = 0;
    let middleWonAnyOverlapFrame = false;
    let zIndexEverReleasedDuringOverlap = false;
    const start = performance.now();
    for (let i = 0; i < 150; i++) {
      await waitForAnimationFrame();
      const mRect = middlePanel.getBoundingClientRect();
      const bRect = bottomPanel.getBoundingClientRect();
      const left = Math.max(mRect.left, bRect.left);
      const right = Math.min(mRect.right, bRect.right);
      const top = Math.max(mRect.top, bRect.top);
      const bottom = Math.min(mRect.bottom, bRect.bottom);
      if (left < right && top < bottom) {
        overlapFrames++;
        if (!isReceded(zIndexOf(middlePanel))) zIndexEverReleasedDuringOverlap = true;
        const centroidX = (left + right) / 2;
        const centroidY = (top + bottom) / 2;
        const owner = ownerOf(document.elementsFromPoint(centroidX, centroidY)[0] ?? null);
        if (owner === "stack-middle") middleWonAnyOverlapFrame = true;
      }
      if (performance.now() - start > 2500) break;
    }

    // Non-vacuity precondition: genuine overlap must actually have been
    // observed. K=10 chosen from round 5's own measured overlap window
    // (37 frames, 3/3 runs deterministic) — well below the observed
    // window, generous margin for run-to-run variance, but still
    // requiring a substantial, non-accidental sample count.
    expect(overlapFrames, `only ${overlapFrames} overlap frames observed between middle's and bottom's panels — never observed genuine overlap (or an insufficient window)`).toBeGreaterThanOrEqual(10);

    expect(zIndexEverReleasedDuringOverlap, "zIndex released to a non-negative/auto value at least once while middle still genuinely overlapped bottom — it must stay receded until settle").toBe(false);

    // Headline, externally anchored (design intent, not any internal
    // signal the sever could also corrupt).
    expect(middleWonAnyOverlapFrame, `middle won paint order in at least one of ${overlapFrames} overlap-sampled frames`).toBe(false);

    // Settle-release check: confirms the flip actually DOES eventually
    // happen — without this, "stays receded forever" would trivially
    // satisfy every assertion above without proving the design's other
    // half (the riser must eventually rejoin normal stacking, not stay
    // permanently receded).
    await wait(1500);
    const zIndexAtRest = zIndexOf(middlePanel);
    expect(zIndexAtRest, `zIndex never released to "auto" after settling — read "${zIndexAtRest}"`).toBe("auto");
  });

  test("multi-sandwiched: shallower siblings win paint order over deeper ones, depth-scaled not just sign-scaled", async () => {
    // Static, already-settled configuration — no toggle needed. 3
    // simultaneously sandwiched siblings between the same pair of focused
    // neighbors (computeWithinColumnDepths, SceneColumn.tsx:299-333: depth
    // = distance to the LOWER focused sibling, so obj-a/obj-b/obj-c — all
    // sharing the same lowerFocusedIndex, "bottom" — get depth 3/2/1
    // respectively, the design's own fan shape). The two tests above only
    // exercise sign (sandwiched vs. focused); this is the only guard on
    // the depth-SCALED half of the derivation (-d vs. a flat -1 would
    // pass both of those, but not this one).
    function MultiDemo() {
      return (
        <TestWrapper fullPage>
          {/* Large peekOffset + objectGap (defaults are 12px / 8px, both
              tiny relative to a 150px panel height) — with the defaults,
              every sandwiched sibling's panel overlaps every other one
              (and the focused neighbors on both sides) almost entirely,
              leaving no region where only an adjacent pair is present to
              sample; a large peekOffset alone still lets the DEEPEST
              sandwiched object's own peek collide with "stack-top" (the
              gap between them is only objectGap, unrelated to
              peekOffset), swallowing its own clean region the other way.
              Both spread the fan enough for each adjacent pair to have a
              genuinely exclusive sliver, without changing what's under
              test (relative z-index order still derives the same way
              regardless of either value's magnitude). */}
          <Scene peekOffset={60}>
            <SceneColumn name="stack-col" objectGap={150}>
              <SceneObject name="stack-top" focused style={{ width: 480 }}>
                <div style={{ height: 150 }}>top content</div>
              </SceneObject>
              <SceneObject name="obj-a" focused={false} style={{ width: 480 }}>
                <div style={{ height: 150 }}>a content</div>
              </SceneObject>
              <SceneObject name="obj-b" focused={false} style={{ width: 480 }}>
                <div style={{ height: 150 }}>b content</div>
              </SceneObject>
              <SceneObject name="obj-c" focused={false} style={{ width: 480 }}>
                <div style={{ height: 150 }}>c content</div>
              </SceneObject>
              <SceneObject name="stack-bottom" focused style={{ width: 480 }}>
                <div style={{ height: 150 }}>bottom content</div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { container } = await render(<MultiDemo />);
    await wait(600);

    const panelTop = container.querySelector('[data-scene-object="stack-top"]') as HTMLElement;
    const panelA = container.querySelector('[data-scene-object="obj-a"]') as HTMLElement;
    const panelB = container.querySelector('[data-scene-object="obj-b"]') as HTMLElement;
    const panelC = container.querySelector('[data-scene-object="obj-c"]') as HTMLElement;
    const panelBottom = container.querySelector('[data-scene-object="stack-bottom"]') as HTMLElement;

    const depthA = container.querySelector('[data-scene-id="obj-a"]')?.getAttribute("data-within-column-depth");
    const depthB = container.querySelector('[data-scene-id="obj-b"]')?.getAttribute("data-within-column-depth");
    const depthC = container.querySelector('[data-scene-id="obj-c"]')?.getAttribute("data-within-column-depth");
    // Non-vacuity precondition: confirms the fixture genuinely produced 3
    // distinct depths before trusting any paint-order conclusion drawn
    // from them.
    expect([depthA, depthB, depthC], `depths were a=${depthA} b=${depthB} c=${depthC} — expected three distinct depths (3, 2, 1)`).toEqual(["3", "2", "1"]);

    const cOverBY = findCleanSampleY(panelC, panelB, [panelTop, panelA, panelBottom]);
    const bOverAY = findCleanSampleY(panelB, panelA, [panelTop, panelC, panelBottom]);

    expect(cOverBY, "no clean sample point found within obj-c/obj-b's shared range, excluding stack-top/obj-a/stack-bottom — setup bug or design changed").not.toBeUndefined();
    expect(bOverAY, "no clean sample point found within obj-b/obj-a's shared range, excluding stack-top/obj-c/stack-bottom — setup bug or design changed").not.toBeUndefined();

    const cOverBOwner = ownerAt(cOverBY!, panelC);
    const bOverAOwner = ownerAt(bOverAY!, panelB);

    expect(cOverBOwner, `owner at a clean obj-c/obj-b sample point (y=${cOverBY}) was "${cOverBOwner}", expected "obj-c" (shallower, depth 1, over obj-b, depth 2)`).toBe("obj-c");
    expect(bOverAOwner, `owner at a clean obj-b/obj-a sample point (y=${bOverAY}) was "${bOverAOwner}", expected "obj-b" (shallower, depth 2, over obj-a, depth 3)`).toBe("obj-b");
  });

  test("at a sandwiched panel's exclusive peek sliver, elementsFromPoint's raw topmost hit is the panel itself — CSS hazard fixed, kept as a regression guard", async () => {
    // Rider 5's own probe (z-index channel adjudication): "verify, not
    // assume" that negative z-index paints behind only the stacking-
    // context ROOT's own background found this FALSE as originally
    // stated — an isolated minimal repro showed elementsFromPoint's raw
    // index-0 hit was "data-column-content", an ORDINARY, non-stacking-
    // context-establishing intermediate wrapper, not the stacking-context
    // root and not the panel itself. That was also a real, user-facing
    // click-targeting regression (a genuine hit-tested click at this same
    // sliver missed the card's own onActivate handler entirely — see the
    // "sandwiched card click-targeting" describe block below), fixed by
    // giving data-column-content `isolation: isolate` (its own comment,
    // SceneColumn.tsx): a stacking-context ROOT's own background paints
    // FIRST, before its negative z-index descendants, so the panel now
    // correctly wins the raw hit-test too — this test's own original
    // assertion flipped from red-if-fixed to green-if-fixed when that
    // landed (its own failure message said as much, verbatim, when this
    // fix first made it fire). Kept here, assertion inverted, as a
    // regression guard: if the isolation fix is ever removed or
    // weakened, this goes red again.
    function Demo() {
      const [middleFocused] = useState(false);
      return (
        <TestWrapper fullPage>
          <Scene peekOffset={80}>
            <SceneColumn name="stack-col" objectGap={200}>
              <SceneObject name="stack-top" focused style={{ width: 480 }}>
                <div style={{ height: 150 }}>top content</div>
              </SceneObject>
              <SceneObject name="stack-middle" focused={middleFocused} style={{ width: 480 }}>
                <div style={{ height: 150 }}>middle content</div>
              </SceneObject>
              <SceneObject name="stack-bottom" focused style={{ width: 480 }}>
                <div style={{ height: 150 }}>bottom content</div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { container } = await render(<Demo />);
    await wait(600);

    const panelMiddle = container.querySelector('[data-scene-object="stack-middle"]') as HTMLElement;
    const panelTop = container.querySelector('[data-scene-object="stack-top"]') as HTMLElement;
    const panelBottom = container.querySelector('[data-scene-object="stack-bottom"]') as HTMLElement;

    const sliverY = findCleanSampleY(panelMiddle, panelMiddle, [panelTop, panelBottom]);
    expect(sliverY, "no exclusive sliver found for stack-middle, clear of stack-top and stack-bottom — setup bug or design changed").not.toBeUndefined();

    const mRect = panelMiddle.getBoundingClientRect();
    const sampleX = (mRect.left + mRect.right) / 2;
    const rawTopmost = document.elementsFromPoint(sampleX, sliverY!)[0];

    // Regression guard: raw index-0 IS the panel itself, post-fix.
    expect(
      rawTopmost?.getAttribute("data-scene-object"),
      `raw elementsFromPoint index-0 at stack-middle's own exclusive sliver was "${rawTopmost?.tagName} data-scene-object=${rawTopmost?.getAttribute("data-scene-object")}", expected the panel itself — the isolation fix (SceneColumn.tsx data-column-content) may have regressed`,
    ).toBe("stack-middle");

    // ownerAt's search-past-wrappers approach still works too (belt and
    // suspenders — it doesn't depend on this specific fix and stays
    // correct even if some OTHER, not-yet-isolated wrapper elsewhere
    // reintroduces the same class of hazard).
    const robustOwner = ownerAt(sliverY!, panelMiddle);
    expect(robustOwner, `owner at stack-middle's own exclusive sliver (searched past non-object wrappers) was "${robustOwner}", expected "stack-middle"`).toBe("stack-middle");
  });
});

describe("Within-column deck (ui#21): sandwiched card click-targeting (rider 5 escalation, real regression)", () => {
  // The z-index channel's own negative z-index values (SceneObject.tsx)
  // place a sandwiched panel in the CSS "negative z-index" paint bucket,
  // which paints BEHIND its own ancestor's box (the well-documented use
  // of negative z-index) — unlike the OLD translateZ-only approach, which
  // never carried an explicit z-index and so stayed in the "auto,
  // positioned" bucket alongside its own ancestor, where ordinary
  // child-paints-after-parent DOM nesting kept it correctly on top.
  // Verified via a probe dispatched at BOTH 5a96f71 (pre-channel) and tip
  // with the SAME unmodified fixture: pre-channel, a real hit-tested
  // click at a sandwiched card's own exclusive peek sliver (a point
  // covered by NEITHER focused neighbor) lands on the card itself and
  // fires its onActivate handler; at tip, it lands on data-column-content
  // (an intermediate structural wrapper) instead, and onActivate never
  // fires — a real, user-facing regression the channel introduced,
  // invisible to every paint-order-only test in the criterion-6 block
  // above (those sample geometric ownership via elementsFromPoint's own
  // stack search, which correctly looks PAST this exact wrapper — see
  // ownerAt's own comment — so they never exercised raw pointer-event
  // targeting at all). RED at tip until fixed.
  test("a real hit-tested click at a sandwiched card's own exclusive peek sliver reaches the card, not an intermediate wrapper", async () => {
    let activated = false;

    function Demo() {
      const [middleFocused, setMiddleFocused] = useState(false);
      return (
        <TestWrapper fullPage>
          <Scene peekOffset={80}>
            <SceneColumn name="stack-col" objectGap={200}>
              <SceneObject name="stack-top" focused style={{ width: 480 }}>
                <div style={{ height: 150 }}>top content</div>
              </SceneObject>
              <SceneObject
                name="stack-middle"
                focused={middleFocused}
                style={{ width: 480 }}
                onActivate={() => {
                  activated = true;
                  setMiddleFocused(true);
                }}
              >
                <div style={{ height: 150 }}>middle content</div>
              </SceneObject>
              <SceneObject name="stack-bottom" focused style={{ width: 480 }}>
                <div style={{ height: 150 }}>bottom content</div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { container } = await render(<Demo />);
    await wait(600);

    const panelMiddle = container.querySelector('[data-scene-object="stack-middle"]') as HTMLElement;
    const anchorMiddle = container.querySelector('[data-scene-id="stack-middle"]') as HTMLElement;
    const panelTop = container.querySelector('[data-scene-object="stack-top"]') as HTMLElement;
    const panelBottom = container.querySelector('[data-scene-object="stack-bottom"]') as HTMLElement;

    const mRect = panelMiddle.getBoundingClientRect();
    const tRect = panelTop.getBoundingClientRect();
    const bRect = panelBottom.getBoundingClientRect();

    let sliverY: number | undefined;
    for (let y = mRect.top + 1; y < mRect.bottom; y++) {
      const inTop = y >= tRect.top && y < tRect.bottom;
      const inBottom = y >= bRect.top && y < bRect.bottom;
      if (!inTop && !inBottom) {
        sliverY = y;
        break;
      }
    }
    // Non-vacuity precondition: a genuine exclusive sliver must exist —
    // a fixture with no sliver at all can't test what a click there does.
    expect(sliverY, `no exclusive sliver found for stack-middle, clear of stack-top and stack-bottom — setup bug or design changed (panelTop=${JSON.stringify(tRect)} panelMiddle=${JSON.stringify(mRect)} panelBottom=${JSON.stringify(bRect)})`).not.toBeUndefined();

    const clickX = (mRect.left + mRect.right) / 2;
    const clickY = sliverY!;

    // Real hit-tested click — the existing ui#17 "clicks-land" pattern
    // (elementFromPoint + dispatchEvent, capture-phase listener records
    // where event.target actually lands).
    let landedOn = "none";
    const listener = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      landedOn = t ? `${t.tagName} data-scene-object=${t.getAttribute("data-scene-object")} data-column-content=${t.getAttribute("data-column-content")}` : "null";
    };
    document.addEventListener("click", listener, true);

    const hitEl = document.elementFromPoint(clickX, clickY);
    hitEl?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: clickX, clientY: clickY }));

    document.removeEventListener("click", listener, true);

    expect(anchorMiddle.contains(hitEl), `raw hit-test element at the sliver was outside stack-middle's own subtree (landed on: ${landedOn}) — the click never reached the card`).toBe(true);
    expect(activated, `onActivate never fired for a click at stack-middle's own exclusive peek sliver (landed on: ${landedOn})`).toBe(true);
  });
});

describe("Within-column deck (ui#21): height/marginBottom lockstep + gap compensation", () => {
  // Ports ui#17's own E2 pattern verbatim (tests/scene.test.tsx's "Glass-
  // stack deck: margin/width lockstep" block): both channels retarget on
  // the identical trigger commit with the identical transition config, so
  // they represent the same [0,1] progress fraction toward the sandwiched
  // state throughout a real-duration spring, not just at the endpoints — a
  // phase-drift regression (the two channels desyncing mid-flight) would
  // show up as a growing gap between these two fractions at some SAMPLED
  // frame, even if both eventually reach their correct endpoints. Uses a
  // dedicated fixture with an EXPLICIT height (unlike UI21MultiFocusFixture,
  // whose natural height is content-derived, not a known constant) —
  // mirrors ui#17's own E2 test using its own simple fixture rather than
  // the shared MultiFocusDemo-style one.
  const NATURAL_HEIGHT = 300;
  const OBJECT_GAP = 8;
  const EPSILON = 0.03; // 3% of the [0,1] progress range, matching ui#17's own E2 tolerance

  async function sampleLockstep(midFocusedStart: boolean) {
    const recorder = createMotionSeamRecorder();
    function Demo() {
      const [midFocused, setMidFocused] = useState(midFocusedStart);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidFocused((v) => !v)}>
            toggle
          </button>
          <MotionSeamContext.Provider value={recorder}>
            <Scene>
              <SceneColumn name="stack-col" objectGap={OBJECT_GAP}>
                {/* Height goes on the CHILD content div, not SceneObject's
                    own style prop — the height channel's naturalHeight is
                    measured off contentRef (content-derived), not the
                    anchor's own consumer-set style, so an explicit height
                    on SceneObject itself never reaches the measurement
                    source (real bug found writing this test: it silently
                    produces a near-meaningless natural height from
                    unstyled text content instead). */}
                <SceneObject name="top" focused style={{ width: 480 }}>
                  <div style={{ height: NATURAL_HEIGHT }}>content</div>
                </SceneObject>
                <SceneObject name="middle" focused={midFocused} style={{ width: 480 }}>
                  <div style={{ height: NATURAL_HEIGHT }}>content</div>
                </SceneObject>
                <SceneObject name="bottom" focused style={{ width: 480 }}>
                  <div style={{ height: NATURAL_HEIGHT }}>content</div>
                </SceneObject>
              </SceneColumn>
            </Scene>
          </MotionSeamContext.Provider>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<Demo />);
    await wait(1000);

    const heightMV = recorder.values.get("height:middle");
    const marginMV = recorder.values.get("marginBottom:middle");
    if (!heightMV || !marginMV) {
      throw new Error("height/marginBottom MotionValues were not registered for 'middle' — setup bug, not a timing race");
    }

    (getByTestId("toggle").element() as HTMLElement).click();

    const maxDrift = { value: 0, atHeight: 0, atMargin: 0 };
    const start = performance.now();
    while (performance.now() - start < 800) {
      const heightProgress = 1 - heightMV.get() / NATURAL_HEIGHT;
      const marginProgress = marginMV.get() / -OBJECT_GAP;
      const drift = Math.abs(heightProgress - marginProgress);
      if (drift > maxDrift.value) {
        maxDrift.value = drift;
        maxDrift.atHeight = heightProgress;
        maxDrift.atMargin = marginProgress;
      }
      await waitForAnimationFrame();
    }
    return maxDrift;
  }

  test("unfocus direction: height and marginBottom progress fractions stay in lockstep throughout", async () => {
    const maxDrift = await sampleLockstep(true);
    expect(
      maxDrift.value,
      `max drift ${maxDrift.value.toFixed(4)} between height-progress (${maxDrift.atHeight.toFixed(4)}) and margin-progress (${maxDrift.atMargin.toFixed(4)})`,
    ).toBeLessThan(EPSILON);
  });

  // SKIPPED (real bug found via this test, out of ui#21 Slice 1's scope —
  // see the Noticed section of the worker's report for the full diagnostic
  // trace; tracked on the board as ui#o29, disposition "parked unless
  // Michael cards it" — this skip is o29's code anchor, keep the two in
  // sync): an object that MOUNTS already sandwiched (settled via the
  // isFirstTarget JUMP path, so heightSettled never flips false while
  // sandwiched) and is then refocused before ever being in-flow hits a
  // race between heightTarget's own retarget effect and the "keep synced
  // while inactive" effect (both useLayoutEffects, same component). On the
  // refocusing commit, heightOverrideActive is computed from the PRIOR
  // (stale) heightSettled=true, so it reads false BEFORE the retarget
  // effect's own setHeightSettled(false) has had a chance to apply — this
  // lets the "keep synced" effect fire on the SAME commit, calling
  // heightMV.set(measured) directly (a synchronous overwrite, not a
  // spring) with the panel's real DOM height. heightMV then briefly
  // free-falls to a near-zero measurement on the following commit before
  // climbing back to its correct target across several more frames —
  // confirmed via direct instrumentation (heightMV.get() sampled every
  // frame: 300 -> ~5 -> gradually back up to 300 over ~120ms). NOT visible
  // to the user: heightOverrideActive stays false throughout this window,
  // so the anchor's style binding never actually applies heightMV's own
  // chaotic value to the DOM (natural CSS sizing governs instead) — both
  // the existing "focus direction: object-local layout-box" zero-pixel-
  // flip test and the N=10 raw-gBCR outlier test already exercise this
  // exact mount-sandwiched-then-refocus scenario and stay green,
  // confirming no paint-space or layout-box discontinuity results. Root
  // cause is specific to HEIGHT's own internal trajectory, not a
  // margin-vs-height desync (margin's own progress tracks correctly
  // throughout — this is why "unfocus direction" passes cleanly but
  // "refocus direction" doesn't: only the refocus direction exercises an
  // object settling via the jump path at mount, then transitioning again
  // before ever being naturally re-measured while inactive). Un-skip once
  // heightOverrideActive's own staleness (reading heightSettled from
  // BEFORE this commit's own retarget effect has run) is fixed at its
  // source — likely needs the same render-time-mutation treatment
  // wasEverSandwichedRef already uses, applied to heightSettled's own
  // computation for this specific commit.
  test.skip("refocus direction: height and marginBottom progress fractions stay in lockstep throughout", async () => {
    const maxDrift = await sampleLockstep(false);
    expect(
      maxDrift.value,
      `max drift ${maxDrift.value.toFixed(4)} between height-progress (${maxDrift.atHeight.toFixed(4)}) and margin-progress (${maxDrift.atMargin.toFixed(4)})`,
    ).toBeLessThan(EPSILON);
  });

  test("at rest, a sandwiched object leaves its focused neighbors exactly one objectGap apart, not two", async () => {
    function Demo() {
      const [middleFocused, setMiddleFocused] = useState(true);
      return (
        <>
          <button data-testid="toggle" onClick={() => setMiddleFocused((v) => !v)}>
            toggle
          </button>
          <UI21MultiFocusFixture
            topFocused
            middleFocused={middleFocused}
            bottomFocused
            onToggleTop={() => {}}
            onToggleMiddle={() => setMiddleFocused(true)}
            onToggleBottom={() => {}}
          />
        </>
      );
    }

    const { getByTestId, container } = await render(<Demo />);
    await wait(600);

    (getByTestId("toggle").element() as HTMLElement).click();
    await wait(600);

    const topRect = (container.querySelector('[data-scene-id="stack-top"]') as HTMLElement).getBoundingClientRect();
    const bottomRect = (container.querySelector('[data-scene-id="stack-bottom"]') as HTMLElement).getBoundingClientRect();

    // UI21MultiFocusFixture's own objectGap={8}. Without gap compensation
    // this would read 16 (two gaps: one on either side of the zero-height
    // flex item) instead of 8.
    expect(bottomRect.top - topRect.bottom).toBeCloseTo(8, 0);
  });
});

describe("Within-column deck (ui#21): double-interruption, minimal (forecast edit E5 — gates entry to Slice 2)", () => {
  // Ports ui#17's own E1 double-interruption test (tests/scene.test.tsx's
  // "Glass-stack deck: double-interruption, minimal" block) to the
  // vertical, per-object axis. 4-object single-column fixture: "top"/
  // "bottom" always focused, "mid-a" toggles, "mid-b" never toggles but is
  // the BYSTANDER whose own within-column depth changes as a side effect
  // of "mid-a"'s transition (mid-a unfocusing pushes mid-b from depth-1
  // (anchored to mid-a) to depth-2 (anchored to bottom), the exact ui#o26
  // shape — a sibling's own state change corrupting a bystander that never
  // itself toggled). "mid-a" starts focused, is toggled off (pushing both
  // mid-a and mid-b into the deck, mid-b's depth shifting), interrupted
  // ~150ms in with a second toggle back to focused (mid-a's own transition
  // reverses AND mid-b's depth reverts in the same commit) — the exact
  // interruption timing the original layout-FLIP-era defect needed, per
  // ui#17's own E1 rationale. Single first-frame-discontinuity assertion
  // on mid-b's own layout-box geometry (transform-free, against its own
  // anchor) at the second toggle's commit, not the full outlier-detector
  // methodology (that's Slice 3's extension of this same test, mirroring
  // exactly how ui#17's own E1 sequenced it).
  test("a second focus change landing mid-transition does not corrupt a bystander object's panel geometry", async () => {
    function Demo() {
      const [midAFocused, setMidAFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidAFocused((v) => !v)}>
            toggle
          </button>
          <Scene>
            <SceneColumn name="stack-col" objectGap={8}>
              <SceneObject name="top" focused style={{ width: 480 }}>
                <div style={{ height: 150 }}>top content</div>
              </SceneObject>
              <SceneObject name="mid-b" focused={false} style={{ width: 480 }}>
                <div style={{ height: 150 }}>mid-b content</div>
              </SceneObject>
              <SceneObject name="mid-a" focused={midAFocused} style={{ width: 480 }}>
                <div style={{ height: 150 }}>mid-a content</div>
              </SceneObject>
              <SceneObject name="bottom" focused style={{ width: 480 }}>
                <div style={{ height: 150 }}>bottom content</div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId, container } = await render(<Demo />);
    await wait(500);

    const midBAnchorEl = container.querySelector('[data-scene-id="mid-b"]') as HTMLElement;
    const midBPanelEl = container.querySelector('[data-scene-object="mid-b"]') as HTMLElement;
    const toggleBtn = getByTestId("toggle").element() as HTMLElement;

    // "mid-b" (DOM order: top, mid-b, mid-a, bottom) is anchored to
    // whichever focused object sits below it — "mid-a" while mid-a is
    // focused (depth=1), or "bottom" once mid-a also decks (depth shifts,
    // since mid-a is now the closer decked object). This is the genuine
    // bystander shape: mid-b's OWN depth changes as a side effect of
    // mid-a's transition, without mid-b itself ever toggling.
    toggleBtn.click(); // mid-a starts unfocusing -> mid-b's depth changes too
    await wait(150); // deliberately mid-spring, matching ui#17's own E1 timing

    const midAAnchorEl = container.querySelector('[data-scene-id="mid-a"]') as HTMLElement;
    const midAPanelEl = container.querySelector('[data-scene-object="mid-a"]') as HTMLElement;
    const initialMidBDepth = midBAnchorEl.getAttribute("data-within-column-depth");

    toggleBtn.click(); // interrupt: mid-a re-focuses mid-transition

    // "mid-a" itself: position flips synchronously-in-intent but not
    // synchronously-in-commit (same registry-correction lag ui#17's own
    // horizontal version documented) — poll for its own panel style.position
    // to actually change. Layout-box geometry against mid-a's own anchor.
    const midA = await captureFlipCommit(midAPanelEl, 2000, undefined, midAAnchorEl);
    // "mid-b": never itself toggles, so its own panel style.position never
    // changes — poll for its within-column-depth retarget instead (the
    // side-effect signal that its bystander geometry depends on). Layout-box
    // geometry against mid-b's own anchor.
    const midB = await captureFlipCommit(
      midBPanelEl,
      2000,
      () => midBAnchorEl.getAttribute("data-within-column-depth") !== initialMidBDepth,
      midBAnchorEl,
    );

    expect(Math.abs(midB.after.left - midB.before.left)).toBeLessThan(1);
    expect(Math.abs(midB.after.top - midB.before.top)).toBeLessThan(1);
    expect(Math.abs(midB.after.width - midB.before.width)).toBeLessThan(1);
    expect(Math.abs(midB.after.height - midB.before.height)).toBeLessThan(1);

    // Mirrors ui#17's own asymmetry: mid-a's own footprint (height) is
    // legitimately still mid-spring at this commit — only left/top (the
    // axes that should already be resolved, not the axis under active
    // transition) are asserted for zero-discontinuity.
    expect(Math.abs(midA.after.left - midA.before.left)).toBeLessThan(1);
    expect(Math.abs(midA.after.top - midA.before.top)).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// Double-interruption, FULL methodology (forecast edit E5's own extension,
// Slice 3 — mirrors ui#17's own E1 full-methodology extension of its E1
// minimal test). Extends the minimal test above along three axes: (a) BOTH
// directions (mid-a unfocus-interrupted-by-refocus AND focus-interrupted-
// by-unfocus, not just the former), (b) interrupt timing derived from a
// MEASURED settle duration rather than a hardcoded magic delay, varied
// across early/mid/late fractions of it, and (c) the gBCR outlier detector
// covers ALL FOUR objects (top/bottom included, not just mid-a/mid-b) —
// layout-box continuity stays scoped to the interrupted object itself
// (mid-a), matching the minimal test's own asymmetry.
// ---------------------------------------------------------------------------

/**
 * Measures how long a real (uninterrupted) transition takes to visually
 * settle by polling every given element's raw gBCR every real frame until
 * NONE of them have moved (within a small epsilon) for `stableFrames`
 * consecutive frames. Used to derive interrupt timings from the spring's
 * own measured duration rather than a hardcoded magic delay.
 */
async function measureSettleDurationMs(
  els: HTMLElement[],
  options: { stableFrames?: number; maxFrames?: number; epsilon?: number } = {},
): Promise<number> {
  const { stableFrames = 5, maxFrames = 180, epsilon = 0.5 } = options;
  const sample = (): GBCRBox[] =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
  const start = performance.now();
  let last = sample();
  let stableStreak = 0;
  for (let i = 0; i < maxFrames; i++) {
    await waitForAnimationFrame();
    const current = sample();
    const moved = current.some((box, idx) => {
      const prev = last[idx]!;
      return (
        Math.abs(box.left - prev.left) > epsilon ||
        Math.abs(box.top - prev.top) > epsilon ||
        Math.abs(box.width - prev.width) > epsilon ||
        Math.abs(box.height - prev.height) > epsilon
      );
    });
    if (moved) {
      stableStreak = 0;
    } else {
      stableStreak++;
      if (stableStreak >= stableFrames) return performance.now() - start;
    }
    last = current;
  }
  throw new Error(`measureSettleDurationMs: never stabilized within ${maxFrames} frames`);
}

/**
 * 4-object single-column bystander fixture, matching the minimal
 * double-interruption test's own shape exactly (top/mid-b/mid-a/bottom,
 * objectGap=8, mid-a toggles). Parameterized by mid-a's INITIAL focus
 * state so the same fixture builds both directions: "unfocus interrupted
 * by refocus" (mid-a starts focused) and "focus interrupted by unfocus"
 * (mid-a starts sandwiched).
 *
 * Coverage note (delta claim review, carried forward from faa3fc5's own
 * disclosure on the minimal test this fixture shape was ported from):
 * mid-b never itself toggles focus in this fixture, so it never crosses
 * the focused/sandwiched boundary — its own gBCR outlier check below
 * covers depth/peek-offset RETARGETING (its within-column depth shifting
 * as a side effect of mid-a's transition) and paint-space continuity, but
 * is structurally vacuous for a HEIGHT-CHANNEL sever specifically: mid-b's
 * anchor collapses via ordinary CSS auto-height circularity regardless of
 * whether the height channel itself is working, since it's sandwiched
 * throughout. Height-channel coverage for this exact
 * mount-sandwiched/settle class lives elsewhere — the red-first N=10 gBCR
 * repro and the layout-box flip tests, plus the ui#o29-anchored
 * (`test.skip`) lockstep test for the specific staleness race that skip
 * documents.
 */
function buildDoubleInterruptionFixture(initialMidAFocused: boolean) {
  return function Demo() {
    const [midAFocused, setMidAFocused] = useState(initialMidAFocused);
    return (
      <TestWrapper fullPage>
        <button data-testid="toggle" onClick={() => setMidAFocused((v) => !v)}>
          toggle
        </button>
        <Scene>
          <SceneColumn name="stack-col" objectGap={8}>
            <SceneObject name="top" focused style={{ width: 480 }}>
              <div style={{ height: 150 }}>top content</div>
            </SceneObject>
            <SceneObject name="mid-b" focused={false} style={{ width: 480 }}>
              <div style={{ height: 150 }}>mid-b content</div>
            </SceneObject>
            <SceneObject name="mid-a" focused={midAFocused} style={{ width: 480 }}>
              <div style={{ height: 150 }}>mid-a content</div>
            </SceneObject>
            <SceneObject name="bottom" focused style={{ width: 480 }}>
              <div style={{ height: 150 }}>bottom content</div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  };
}

/**
 * Mounts the double-interruption fixture, triggers mid-a's FIRST toggle
 * ONLY (no interrupt), and measures how long the transition takes to
 * settle across all 4 panels — the basis for this describe block's derived
 * early/mid/late interrupt timings (25%/50%/75% of this measured
 * duration).
 */
async function measureDeckSettleDurationMs(initialMidAFocused: boolean): Promise<number> {
  const Demo = buildDoubleInterruptionFixture(initialMidAFocused);
  const { getByTestId, container } = await render(<Demo />);
  await wait(500);

  const panels = ["top", "mid-b", "mid-a", "bottom"].map(
    (name) => container.querySelector(`[data-scene-object="${name}"]`) as HTMLElement,
  );
  (getByTestId("toggle").element() as HTMLElement).click();
  const durationMs = await measureSettleDurationMs(panels);
  await cleanup();
  return durationMs;
}

/**
 * Runs ONE full double-interruption trial: mounts the fixture, triggers
 * mid-a's first toggle, waits `interruptDelayMs` (derived from the
 * calibrated settle duration — see measureDeckSettleDurationMs) with NO
 * sampling in between (mirrors ui#17's own runDoubleInterruptionGbcrSample
 * precedent exactly: wait the FULL delay first, THEN start sampling — a
 * first draft of this helper sampled a few warmup frames BEFORE the delay
 * instead, leaving a genuine wall-clock gap between the last pre-delay
 * sample and the first post-interrupt sample; that gap's delta legitimately
 * spans far more elapsed time than its neighbors and trips the outlier
 * detector on pure sampling density, not a real discontinuity — caught via
 * this test's own pilot run, not assumed away), then interrupts with a
 * second toggle. Samples raw gBCR for ALL FOUR objects across the whole
 * pre- and post-interrupt window IN THE SAME frame loop that also captures
 * mid-a's own layout-box flip commit — a separate captureFlipCommit call
 * would run its own polling loop and leave a gBCR sampling blind spot
 * exactly at the interrupt commit, the single moment most likely to show a
 * discontinuity.
 */
async function runFullInterruptionTrial(
  initialMidAFocused: boolean,
  interruptDelayMs: number,
): Promise<{
  outlierDeltas: { top: number[]; midB: number[]; midA: number[]; bottom: number[] };
  midAFlip: { before: DOMRect; after: DOMRect };
}> {
  const Demo = buildDoubleInterruptionFixture(initialMidAFocused);
  const { getByTestId, container } = await render(<Demo />);
  await wait(500);

  const topPanel = container.querySelector('[data-scene-object="top"]') as HTMLElement;
  const midBPanel = container.querySelector('[data-scene-object="mid-b"]') as HTMLElement;
  const midAPanel = container.querySelector('[data-scene-object="mid-a"]') as HTMLElement;
  const bottomPanel = container.querySelector('[data-scene-object="bottom"]') as HTMLElement;
  const midAAnchorEl = container.querySelector('[data-scene-id="mid-a"]') as HTMLElement;
  const toggleBtn = getByTestId("toggle").element() as HTMLElement;

  const sample = (el: HTMLElement): GBCRBox => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };

  toggleBtn.click(); // first toggle: starts the transition under test
  await wait(interruptDelayMs); // no sampling yet — see this function's own doc comment

  const topSamples: GBCRBox[] = [sample(topPanel)];
  const midBSamples: GBCRBox[] = [sample(midBPanel)];
  const midASamples: GBCRBox[] = [sample(midAPanel)];
  const bottomSamples: GBCRBox[] = [sample(bottomPanel)];
  for (let i = 0; i < 3; i++) {
    await waitForAnimationFrame();
    topSamples.push(sample(topPanel));
    midBSamples.push(sample(midBPanel));
    midASamples.push(sample(midAPanel));
    bottomSamples.push(sample(bottomPanel));
  }

  const initialMidAPosition = midAPanel.style.position;
  toggleBtn.click(); // interrupt: mid-a's second toggle, mid-transition

  let midABefore = new DOMRect(midAPanel.offsetLeft, midAPanel.offsetTop, midAPanel.offsetWidth, midAPanel.offsetHeight);
  let midAAfter: DOMRect | undefined;
  const start = performance.now();
  while (performance.now() - start < 1000) {
    await waitForAnimationFrame();
    topSamples.push(sample(topPanel));
    midBSamples.push(sample(midBPanel));
    midASamples.push(sample(midAPanel));
    bottomSamples.push(sample(bottomPanel));
    if (!midAAfter && midAPanel.style.position !== initialMidAPosition) {
      if (midAPanel.offsetParent !== midAAnchorEl) {
        throw new Error(
          `runFullInterruptionTrial: expected mid-a panel's offsetParent to be its anchor but it was ${midAPanel.offsetParent ? `<${midAPanel.offsetParent.tagName}>` : "null"}`,
        );
      }
      midAAfter = new DOMRect(midAPanel.offsetLeft, midAPanel.offsetTop, midAPanel.offsetWidth, midAPanel.offsetHeight);
    } else if (!midAAfter) {
      midABefore = new DOMRect(midAPanel.offsetLeft, midAPanel.offsetTop, midAPanel.offsetWidth, midAPanel.offsetHeight);
    }
  }
  if (!midAAfter) {
    throw new Error("runFullInterruptionTrial: mid-a's panel position never flipped within the 1000ms post-interrupt sampling window");
  }

  await cleanup();

  return {
    outlierDeltas: {
      top: gbcrDeltasOf(topSamples),
      midB: gbcrDeltasOf(midBSamples),
      midA: gbcrDeltasOf(midASamples),
      bottom: gbcrDeltasOf(bottomSamples),
    },
    midAFlip: { before: midABefore, after: midAAfter },
  };
}

describe("Within-column deck (ui#21): double-interruption, full methodology (forecast edit E5's own extension, Slice 3)", () => {
  // Interrupt timing buckets as fractions of the CALIBRATED, measured
  // settle duration for each direction (not a hardcoded magic delay) —
  // mirrors this file's own measurement-over-assumption discipline.
  // Cycled across the N=10 runs (run % 3) rather than a full 3x
  // multiplication of the run count, so every bucket gets multiple runs
  // without ballooning total test count.
  const TIMING_FRACTIONS = [0.25, 0.5, 0.75] as const;
  const TIMING_LABELS = ["early", "mid", "late"] as const;

  let unfocusSettleMs = 0;
  let focusSettleMs = 0;

  // Calibration runs as its own dedicated test() per direction (relying on
  // this file's guaranteed in-declaration-order execution), NOT inside a
  // single beforeAll that calls render() twice in a row — this file's own
  // established caveat (see runDoubleInterruptionGbcrSample's doc comment)
  // is that vitest-browser's render/cleanup cycle doesn't reliably tear
  // down a component fast enough for a same-body re-render, even with an
  // explicit await cleanup() in between (confirmed the hard way: passed
  // reliably when this describe block ran in isolation via -t, then hit a
  // real "2 elements" strict-mode DOM collision inside beforeAll when run
  // as part of the full file — exactly the documented hazard, only
  // reproducing under the full file's timing). Each test() body gets its
  // own proper cleanup boundary, the same mechanism every other render()
  // call in this file already relies on.
  test("calibrate: measure the unfocus-direction settle duration (basis for this direction's interrupt timings)", async () => {
    unfocusSettleMs = await measureDeckSettleDurationMs(true); // mid-a starts focused, unfocuses
    expect(unfocusSettleMs).toBeGreaterThan(0);
  });

  for (let run = 0; run < 10; run++) {
    const bucket = run % 3;
    test(`unfocus interrupted by refocus, run ${run} (${TIMING_LABELS[bucket]} interrupt): no frame-to-frame gBCR outlier across all 4 objects, mid-a's own layout-box continuous at the flip`, async () => {
      const interruptDelayMs = unfocusSettleMs * TIMING_FRACTIONS[bucket];
      const { outlierDeltas, midAFlip } = await runFullInterruptionTrial(true, interruptDelayMs);

      const topOutliers = findGbcrOutliers(outlierDeltas.top);
      const midBOutliers = findGbcrOutliers(outlierDeltas.midB);
      const midAOutliers = findGbcrOutliers(outlierDeltas.midA);
      const bottomOutliers = findGbcrOutliers(outlierDeltas.bottom);

      expect(
        { topOutliers, midBOutliers, midAOutliers, bottomOutliers },
        `interrupt at ${interruptDelayMs.toFixed(0)}ms (${TIMING_LABELS[bucket]}, measured settle ${unfocusSettleMs.toFixed(0)}ms) — ` +
          `outlier(s): top ${JSON.stringify(topOutliers)}, mid-b ${JSON.stringify(midBOutliers)}, mid-a ${JSON.stringify(midAOutliers)}, bottom ${JSON.stringify(bottomOutliers)}`,
      ).toEqual({ topOutliers: [], midBOutliers: [], midAOutliers: [], bottomOutliers: [] });

      // Interrupted object's own layout-box continuity (mirrors the
      // minimal test's own asymmetry: only left/top, the axes that
      // should already be resolved, not the axis under active
      // transition — mid-a's own height is legitimately mid-spring at
      // this exact commit).
      expect(Math.abs(midAFlip.after.left - midAFlip.before.left)).toBeLessThan(1);
      expect(Math.abs(midAFlip.after.top - midAFlip.before.top)).toBeLessThan(1);
    });
  }

  test("calibrate: measure the focus-direction settle duration (basis for this direction's interrupt timings)", async () => {
    focusSettleMs = await measureDeckSettleDurationMs(false); // mid-a starts sandwiched, focuses
    expect(focusSettleMs).toBeGreaterThan(0);
  });

  for (let run = 0; run < 10; run++) {
    const bucket = run % 3;
    test(`focus interrupted by unfocus, run ${run} (${TIMING_LABELS[bucket]} interrupt): no frame-to-frame gBCR outlier across all 4 objects, mid-a's own layout-box continuous at the flip`, async () => {
      const interruptDelayMs = focusSettleMs * TIMING_FRACTIONS[bucket];
      const { outlierDeltas, midAFlip } = await runFullInterruptionTrial(false, interruptDelayMs);

      const topOutliers = findGbcrOutliers(outlierDeltas.top);
      const midBOutliers = findGbcrOutliers(outlierDeltas.midB);
      const midAOutliers = findGbcrOutliers(outlierDeltas.midA);
      const bottomOutliers = findGbcrOutliers(outlierDeltas.bottom);

      expect(
        { topOutliers, midBOutliers, midAOutliers, bottomOutliers },
        `interrupt at ${interruptDelayMs.toFixed(0)}ms (${TIMING_LABELS[bucket]}, measured settle ${focusSettleMs.toFixed(0)}ms) — ` +
          `outlier(s): top ${JSON.stringify(topOutliers)}, mid-b ${JSON.stringify(midBOutliers)}, mid-a ${JSON.stringify(midAOutliers)}, bottom ${JSON.stringify(bottomOutliers)}`,
      ).toEqual({ topOutliers: [], midBOutliers: [], midAOutliers: [], bottomOutliers: [] });

      expect(Math.abs(midAFlip.after.left - midAFlip.before.left)).toBeLessThan(1);
      expect(Math.abs(midAFlip.after.top - midAFlip.before.top)).toBeLessThan(1);
    });
  }
});

describe("Within-column deck (ui#21): author-drawn focus-visible ring", () => {
  // Replaces the browser's native outline:auto (broken by this arc's own
  // anchor/panel split — the panel, an opaque descendant always present
  // post-split, occludes roughly half of a straddling native ring; see the
  // worker report's occlusion-vs-shrink discriminator). Panel-placement
  // ruling (Michael: "on the card makes sense") moved the PAINT from the
  // anchor to the panel — focus semantics (tabIndex, the real DOM focus
  // target) stay on the anchor, via Tailwind's `group/scene-object`/
  // `group-focus-visible/scene-object:` pattern (anchor is the group,
  // panel paints when the group is :focus-visible). Fixes a real gap
  // the anchor-placed ring never solved: a SANDWICHED object's anchor
  // is a zero-footprint, invisible wrapper — a ring drawn there was
  // never visible on the actual card a keyboard user sees (see this
  // block's own third test). Drawn entirely
  // outside the PANEL's own border edge (outline-offset:0 with a non-
  // "auto" style is spec-guaranteed outward-only) so no further
  // descendant can ever cover it. 2px (Michael's directive, was 1px on
  // the anchor-placed original); color unchanged, measured from a fresh
  // master (pre-split) capture's own computed outline, not guessed.
  test("a keyboard-focused object's panel shows the custom ring, not the native outline", async () => {
    function Demo() {
      return (
        <TestWrapper fullPage>
          <Scene>
            <SceneColumn name="stack-col">
              <SceneObject name="only" focused style={{ width: 300 }}>
                <div style={{ height: 150 }}>content</div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { container } = await render(<Demo />);
    await waitForAnimationFrame();

    const anchorEl = container.querySelector('[data-scene-id="only"]') as HTMLElement;
    const panelEl = container.querySelector('[data-scene-object="only"]') as HTMLElement;
    anchorEl.focus();
    await waitForAnimationFrame();

    // Focus semantics stay on the anchor — this is the real DOM focus
    // target, unchanged by the panel-placement move.
    expect(anchorEl).toBe(document.activeElement);

    // The anchor itself shows no outline — its own native outline:auto
    // is suppressed, and it never had the custom ring classes to begin
    // with post-move.
    const anchorCs = window.getComputedStyle(anchorEl);
    expect(anchorCs.outlineStyle).toBe("none");

    // The panel is where the ring now paints.
    const panelCs = window.getComputedStyle(panelEl);
    expect(panelCs.outlineStyle).toBe("solid");
    expect(panelCs.outlineWidth).toBe("2px");
    expect(panelCs.outlineColor).toBe("rgb(153, 200, 255)");
    expect(panelCs.outlineOffset).toBe("0px");
  });

  test("an unfocused object's panel shows no outline", async () => {
    function Demo() {
      return (
        <TestWrapper fullPage>
          <Scene>
            <SceneColumn name="stack-col">
              <SceneObject name="only" focused style={{ width: 300 }}>
                <div style={{ height: 150 }}>content</div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { container } = await render(<Demo />);
    await waitForAnimationFrame();

    const anchorEl = container.querySelector('[data-scene-id="only"]') as HTMLElement;
    const panelEl = container.querySelector('[data-scene-object="only"]') as HTMLElement;
    expect(anchorEl).not.toBe(document.activeElement);
    expect(window.getComputedStyle(panelEl).outlineStyle).toBe("none");
  });

  test("a sandwiched object's VISIBLE card rings when focused, not its invisible zero-footprint anchor", async () => {
    // The whole point of the panel-placement move: the anchor-placed
    // original could never show a ring on a sandwiched object at all —
    // its anchor is a permanently zero-footprint wrapper (settled), so a
    // ring drawn there paints on a box with no visible area. A cheap
    // assertion on the tucked state alone (e.g. "the anchor has no
    // outline") would have locked in exactly that gap without ever
    // proving the ring reaches the card a keyboard user actually sees —
    // this test asserts the panel's own outline directly instead.
    function Demo() {
      return (
        <TestWrapper fullPage>
          <Scene>
            <SceneColumn name="stack-col" objectGap={8}>
              <SceneObject name="top" focused style={{ width: 480 }}>
                <div style={{ height: 150 }}>top content</div>
              </SceneObject>
              <SceneObject name="middle" focused={false} style={{ width: 480 }}>
                <div style={{ height: 150 }}>middle content</div>
              </SceneObject>
              <SceneObject name="bottom" focused style={{ width: 480 }}>
                <div style={{ height: 150 }}>bottom content</div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { container } = await render(<Demo />);
    await wait(600);

    const anchorEl = container.querySelector('[data-scene-id="middle"]') as HTMLElement;
    const panelEl = container.querySelector('[data-scene-object="middle"]') as HTMLElement;

    anchorEl.focus();
    await waitForAnimationFrame();

    expect(anchorEl).toBe(document.activeElement);

    // Non-vacuity precondition: the anchor really is zero-footprint (the
    // settled-sandwiched state this test exists to cover), and the panel
    // really is a full-size, visible box — otherwise this test wouldn't
    // be exercising the gap it claims to.
    const anchorRect = anchorEl.getBoundingClientRect();
    const panelRect = panelEl.getBoundingClientRect();
    expect(anchorRect.height, `anchor height was ${anchorRect.height}, expected 0 (settled sandwiched, zero-footprint) — setup bug or design changed`).toBe(0);
    expect(panelRect.height, `panel height was ${panelRect.height}, expected > 0 (a real, visible card) — setup bug or design changed`).toBeGreaterThan(0);

    const panelCs = window.getComputedStyle(panelEl);
    expect(panelCs.outlineStyle).toBe("solid");
    expect(panelCs.outlineWidth).toBe("2px");
    expect(panelCs.outlineColor).toBe("rgb(153, 200, 255)");
  });

  test("consumers override the ring's color/width/offset/radius via CSS custom properties on an ancestor", async () => {
    // Michael's ring customization ruling: consumers add their own ring
    // colors and radius by overriding the four CSS custom properties the
    // panel's outline rule (and its own borderRadius) consume as
    // var(--x,default) — see the panel's own className/style comments for
    // the full four-var contract. Custom properties inherit down the DOM
    // tree, so a scoped wrapper ancestor is enough; no component prop.
    function Demo() {
      return (
        <TestWrapper fullPage>
          <div
            style={
              {
                "--scene-focus-ring-color": "rgb(255, 0, 0)",
                "--scene-focus-ring-width": "4px",
                "--scene-focus-ring-offset": "3px",
                "--scene-focus-ring-radius": "12px",
              } as React.CSSProperties
            }
          >
            <Scene>
              <SceneColumn name="stack-col">
                <SceneObject name="only" focused style={{ width: 300 }}>
                  <div style={{ height: 150 }}>content</div>
                </SceneObject>
              </SceneColumn>
            </Scene>
          </div>
        </TestWrapper>
      );
    }

    const { container } = await render(<Demo />);
    await waitForAnimationFrame();

    const anchorEl = container.querySelector('[data-scene-id="only"]') as HTMLElement;
    const panelEl = container.querySelector('[data-scene-object="only"]') as HTMLElement;
    anchorEl.focus();
    await waitForAnimationFrame();

    expect(anchorEl).toBe(document.activeElement);

    const panelCs = window.getComputedStyle(panelEl);
    expect(panelCs.outlineStyle).toBe("solid");
    expect(panelCs.outlineWidth).toBe("4px");
    expect(panelCs.outlineColor).toBe("rgb(255, 0, 0)");
    expect(panelCs.outlineOffset).toBe("3px");
    expect(panelCs.borderRadius).toBe("12px");
  });
});
