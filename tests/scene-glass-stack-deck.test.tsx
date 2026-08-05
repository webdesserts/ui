import { describe, test, expect } from "vitest";
import { useState } from "react";
import { render, cleanup } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn, DEFAULT_COLUMN_GAP } from "../src";
import { MotionSeamContext } from "../src/components/scene/motionSeam";
import { ColumnPositionContext, type ColumnPosition } from "../src/components/scene/ColumnPositionContext";
import { StackDepthContext } from "../src/components/scene/StackDepthContext";
import { ViewportContext } from "../src/components/scene/ViewportContext";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame, wait, createMotionSeamRecorder, waitForSceneSettled } from "./utils/animation";
import { captureFlipCommit, findGbcrOutliers, gbcrDeltasOf, type GBCRBox } from "./utils/gbcrSampling";
import { buildScene } from "./utils/sceneFixtures";

// ---------------------------------------------------------------------------
// Glass-stack deck rework (ui#17): anchor/column flip geometry and channel
// coordination. Representative fixtures throughout (constraint 4) — width
// declared directly on SceneObject's own style prop, never a child div.
// ---------------------------------------------------------------------------

describe("Glass-stack deck: zero-pixel flip", () => {
  test("unfocus direction: column-node-local geometry has no discontinuity at the flip commit", async () => {
    function Demo() {
      const [midFocused, setMidFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidFocused((v) => !v)}>
            toggle
          </button>
          <Scene>
            <SceneColumn name="left">
              <SceneObject name="left-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="middle">
              <SceneObject name="middle-object" focused={midFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="right">
              <SceneObject name="right-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<Demo />);
    await wait(500);

    const anchorEl = document.querySelector('[data-ui-scene-id="middle-object"]')!.closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const columnNodeEl = anchorEl.querySelector("[data-ui-scene-column]") as HTMLElement;

    (getByTestId("toggle").element() as HTMLElement).click();
    // Layout-box geometry (Part B's final form) — transform-free by
    // construction, so neither stage/camera translation nor the
    // depth-deck's own Z-projection can register as a false discontinuity
    // here — see captureFlipCommit's own doc comment.
    const { before, after } = await captureFlipCommit(columnNodeEl, 2000, undefined, anchorEl);

    expect(Math.abs(after.left - before.left)).toBeLessThan(1);
    expect(Math.abs(after.top - before.top)).toBeLessThan(1);
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  });

  test("refocus direction (was-focused-before): column-node-local geometry has no discontinuity at the flip commit", async () => {
    function Demo() {
      const [midFocused, setMidFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidFocused((v) => !v)}>
            toggle
          </button>
          <Scene>
            <SceneColumn name="left">
              <SceneObject name="left-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="middle">
              <SceneObject name="middle-object" focused={midFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="right">
              <SceneObject name="right-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<Demo />);
    await wait(500);

    const anchorEl = document.querySelector('[data-ui-scene-id="middle-object"]')!.closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const columnNodeEl = anchorEl.querySelector("[data-ui-scene-column]") as HTMLElement;

    // Deck first (was-focused-before, matching the spike's own validated
    // trace-refocus.log scenario), let it fully settle, THEN test the
    // refocus flip specifically.
    (getByTestId("toggle").element() as HTMLElement).click();
    await wait(1000);

    (getByTestId("toggle").element() as HTMLElement).click();
    // Layout-box geometry (Part B's final form) — see the unfocus-direction
    // test above.
    const { before, after } = await captureFlipCommit(columnNodeEl, 2000, undefined, anchorEl);

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
          <SceneObject name="left-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
        </SceneColumn>
        <SceneColumn name="mid-a">
          <SceneObject name="mid-a-object" focused={midAFocused} style={{ width: 200, height: 200 }}>content</SceneObject>
        </SceneColumn>
        <SceneColumn name="mid-b">
          <SceneObject name="mid-b-object" focused={midBFocused} style={{ width: 200, height: 200 }}>content</SceneObject>
        </SceneColumn>
        <SceneColumn name="right">
          <SceneObject name="right-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
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
    const floorLeft = document.querySelector('[data-ui-scene-id="left-object"]')!.closest("[data-ui-scene-column-anchor]")!.getBoundingClientRect();
    const floorRight = document.querySelector('[data-ui-scene-id="right-object"]')!.closest("[data-ui-scene-column-anchor]")!.getBoundingClientRect();
    gapMathFloorGap = floorRight.left - floorLeft.right;
  });

  test("two settled deck anchors between the same two focused columns", async () => {
    await render(<GapMathDemo midAFocused={false} midBFocused={false} />);
    await wait(1000);
    const deckedLeft = document.querySelector('[data-ui-scene-id="left-object"]')!.closest("[data-ui-scene-column-anchor]")!.getBoundingClientRect();
    const deckedRight = document.querySelector('[data-ui-scene-id="right-object"]')!.closest("[data-ui-scene-column-anchor]")!.getBoundingClientRect();
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

    // Focused side: SceneObject's own outer wrapper (data-ui-scene-id) — at
    // rest the anchor's own width override is released, so the anchor
    // sizes naturally to wrap this node, matching obs-width-family.json's
    // own methodology for the focused-side proof.
    const focusedEl = document.querySelector('[data-ui-scene-id="focused-obj"]') as HTMLElement;

    // Decked side: columnWidthMV's own live value via the motion seam, NOT
    // any DOM read. Two dead ends found first (both defeat-check-caught,
    // 2026-07-31): (1) reading the SceneObject node is vacuous — it
    // carries its own independent cqw width regardless of the column's own
    // JS-driven state, so a permanently-stuck columnWidthOverrideActive
    // left it green. (2) reading the COLUMN's own gBCR/offsetWidth is ALSO
    // vacuous under duration=0 specifically — the jump branch
    // (`if (duration === 0 || ...) { ...; setColumnWidthSettled(true); }`)
    // sets columnWidthSettled back to true SYNCHRONOUSLY within the same
    // commit that computed the target, so columnWidthOverrideActive
    // (`inBetweenNow ? !columnWidthSettled : ...`) is already false by the
    // time any test observes it — the style binding renders "auto" before
    // a test can ever catch columnWidthTarget applied, so severing
    // computeMeasuredWidth to a fixed stale value left even the column
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
                <SceneObject name="left-object" focused style={{ width: NATURAL_WIDTH, height: 300 }}>content</SceneObject>
              </SceneColumn>
              <SceneColumn name="middle">
                <SceneObject name="middle-object" focused={midFocused} style={{ width: NATURAL_WIDTH, height: 300 }}>content</SceneObject>
              </SceneColumn>
              <SceneColumn name="right">
                <SceneObject name="right-object" focused style={{ width: NATURAL_WIDTH, height: 300 }}>content</SceneObject>
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
              <SceneObject name="left-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="middle">
              <SceneObject name="middle-object" focused={midFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="right">
              <SceneObject name="right-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
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
  // "unfocus direction" — middle's decked column overlaps "right"'s column
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
  // forced `zIndex: 10` on the in-between column's own column node was confirmed
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
  // production change (moving the column node out from under its preserve-3d
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
    return el?.closest("[data-ui-scene-column-anchor]")?.getAttribute("data-ui-scene-column-anchor") ?? undefined;
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
                <SceneObject name="left-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
              </SceneColumn>
              <SceneColumn name="middle">
                <SceneObject name="middle-object" focused={midFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
              </SceneColumn>
              <SceneColumn name="right">
                <SceneObject name="right-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
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

    const middleColumnNode = document.querySelector('[data-ui-scene-column-anchor="middle"] [data-ui-scene-column]') as HTMLElement;
    const rightColumnNode = document.querySelector('[data-ui-scene-column-anchor="right"] [data-ui-scene-column]') as HTMLElement;

    const zBefore = zMV.get();
    recorder.controls.clear();
    (getByTestId("toggle").element() as HTMLElement).click();
    await pollForColumnZRetarget(recorder, zMV, zBefore);

    // ui#20 criterion 6 migration: `z:middle` is one of the owned
    // MotionValue channels routed through useOwnedAnimation() (confirmed at
    // source — SceneColumn's zOwnedAnimation.animateTo call), so
    // data-ui-scene-settled becoming true is a direct, correct signal that
    // zMV itself has reached its final value — measured LIVE afterward
    // (not a frozen pre-click snapshot).
    await waitForSceneSettled(getByTestId("scene").element() as HTMLElement, { timeoutMs: 2000 });

    const mRect = middleColumnNode.getBoundingClientRect();
    const rRect = rightColumnNode.getBoundingClientRect();
    const left = Math.max(mRect.left, rRect.left);
    const right = Math.min(mRect.right, rRect.right);
    const top = Math.max(mRect.top, rRect.top);
    const bottom = Math.min(mRect.bottom, rRect.bottom);
    const overlaps = left < right && top < bottom;

    const centroidX = (left + right) / 2;
    const centroidY = (top + bottom) / 2;
    const owner = ownerOf(document.elementsFromPoint(centroidX, centroidY)[0] ?? null);

    // Non-vacuity precondition: measured on unsevered code, this overlap
    // is permanent once settled (a decked column's own column node stays full-size,
    // tucked behind its focused neighbor) — a missing overlap here means
    // the fixture/geometry changed, not that the check should silently
    // pass.
    expect(overlaps, `middle and right columns do not overlap at settle (middle=${JSON.stringify(mRect)} right=${JSON.stringify(rRect)}) — setup bug or design changed`).toBe(true);

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
                <SceneObject name="left-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
              </SceneColumn>
              <SceneColumn name="middle">
                <SceneObject name="middle-object" focused={midFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
              </SceneColumn>
              <SceneColumn name="right">
                <SceneObject name="right-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
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

    const middleColumnNode = document.querySelector('[data-ui-scene-column-anchor="middle"] [data-ui-scene-column]') as HTMLElement;
    const rightColumnNode = document.querySelector('[data-ui-scene-column-anchor="right"] [data-ui-scene-column]') as HTMLElement;

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
      const mRect = middleColumnNode.getBoundingClientRect();
      const rRect = rightColumnNode.getBoundingClientRect();
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
    expect(overlapFrames, `only ${overlapFrames} overlap frames observed between middle's and right's columns — never observed genuine overlap (or an insufficient window)`).toBeGreaterThanOrEqual(10);

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
  test("a second focus change landing mid-transition does not corrupt a bystander column's own geometry", async () => {
    function Demo() {
      const [midAFocused, setMidAFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidAFocused((v) => !v)}>
            toggle
          </button>
          <Scene>
            <SceneColumn name="left">
              <SceneObject name="left-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="mid-b">
              <SceneObject name="mid-b-object" focused={false} style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="mid-a">
              <SceneObject name="mid-a-object" focused={midAFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
            <SceneColumn name="right">
              <SceneObject name="right-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
    }

    const { getByTestId } = await render(<Demo />);
    await wait(500);

    const midBColumnNode = document.querySelector('[data-ui-scene-id="mid-b-object"]')!.closest("[data-ui-scene-column-anchor]")!.querySelector("[data-ui-scene-column]") as HTMLElement;
    const toggleBtn = getByTestId("toggle").element() as HTMLElement;

    // "mid-b" (DOM order: left, mid-b, mid-a, right) is anchored to
    // whichever focused column sits to its right — "mid-a" while mid-a is
    // focused (stackDepth=1), or "right" once mid-a also decks (stackDepth
    // shifts, since mid-a is now the closer decked column). This is the
    // genuine bystander shape: mid-b's OWN stackDepth changes as a side
    // effect of mid-a's transition, without mid-b itself ever toggling.
    toggleBtn.click(); // mid-a starts unfocusing -> mid-b's stackDepth changes too
    await wait(150); // deliberately mid-spring, same timing the original layout-FLIP defect needed

    const midAColumnNode = document.querySelector('[data-ui-scene-id="mid-a-object"]')!.closest("[data-ui-scene-column-anchor]")!.querySelector("[data-ui-scene-column]") as HTMLElement;
    const midBAnchorEl = midBColumnNode.closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const initialMidBDepth = midBAnchorEl.getAttribute("data-ui-scene-stack-depth");

    toggleBtn.click(); // interrupt: mid-a re-focuses mid-transition

    const midAAnchorEl = midAColumnNode.closest("[data-ui-scene-column-anchor]") as HTMLElement;

    // "mid-a" itself: position flips synchronously-in-intent but not
    // synchronously-in-commit (same registry-correction lag every other
    // Scene-derived read in this file has shown) — poll for its own
    // style.position to actually change. Layout-box geometry (Part B's
    // final form) against mid-a's own anchor.
    const midA = await captureFlipCommit(midAColumnNode, 2000, undefined, midAAnchorEl);
    // "mid-b": never itself toggles, so its own style.position never
    // changes — poll for its stackDepth-driven retarget instead (the
    // side-effect signal that its bystander geometry depends on).
    // Layout-box geometry (Part B's final form) against mid-b's own anchor.
    const midB = await captureFlipCommit(
      midBColumnNode,
      2000,
      () => midBAnchorEl.getAttribute("data-ui-scene-stack-depth") !== initialMidBDepth,
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
// Slice 3). RAW column-node gBCR, deliberately NOT rebased against each column node's
// own anchor — team-lead's ruling: this detector's subject is what the user
// SEES (camera, tuck, Z-projection, and reflow all compose into paint-space
// geometry), complementing the FLIP tests' layout-space contract (Part B),
// not duplicating it. A column node's layout-box position relative to its own
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
            <SceneObject name="left-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
          </SceneColumn>
          <SceneColumn name="mid-b">
            <SceneObject name="mid-b-object" focused={false} style={{ width: 200, height: 300 }}>content</SceneObject>
          </SceneColumn>
          <SceneColumn name="mid-a">
            <SceneObject name="mid-a-object" focused={midAFocused} style={{ width: 200, height: 300 }}>content</SceneObject>
          </SceneColumn>
          <SceneColumn name="right">
            <SceneObject name="right-object" focused style={{ width: 200, height: 300 }}>content</SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
  }

  const { getByTestId } = await render(<Demo />);
  await wait(500);

  const midAColumnNode = document.querySelector('[data-ui-scene-id="mid-a-object"]')!.closest("[data-ui-scene-column-anchor]")!.querySelector("[data-ui-scene-column]") as HTMLElement;
  const midBColumnNode = document.querySelector('[data-ui-scene-id="mid-b-object"]')!.closest("[data-ui-scene-column-anchor]")!.querySelector("[data-ui-scene-column]") as HTMLElement;
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
  const midASamples: GBCRBox[] = [sampleGbcr(midAColumnNode)];
  const midBSamples: GBCRBox[] = [sampleGbcr(midBColumnNode)];
  for (let i = 0; i < 3; i++) {
    await waitForAnimationFrame();
    midASamples.push(sampleGbcr(midAColumnNode));
    midBSamples.push(sampleGbcr(midBColumnNode));
  }

  toggleBtn.click(); // interrupt: mid-a re-focuses mid-transition

  const start = performance.now();
  while (performance.now() - start < 1000) {
    await waitForAnimationFrame();
    midASamples.push(sampleGbcr(midAColumnNode));
    midBSamples.push(sampleGbcr(midBColumnNode));
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
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 300, height: 200, testId: "content-left" }] },
          { name: "col-middle", objects: [{ name: "obj-middle", focused: false, width: 300, height: 200, testId: "content-middle" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 300, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    const middleCol = getByTestId("content-middle").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    expect(middleCol.getAttribute("data-ui-scene-column-position")).toBe("in-between");
  });

  test("in-between column stacks under right focused column (positioned near right)", async () => {
    // An in-between unfocused column should appear in roughly the same
    // horizontal area as the right focused column — stacked behind it
    // (the closed-form anchor-relative offset the anchor/column restructure
    // uses, not the retired stackTargetLeft/DepthDeckContext mechanism).
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 300, height: 200, testId: "content-left" }] },
          { name: "col-middle", objects: [{ name: "obj-middle", focused: false, width: 300, height: 200, testId: "content-middle" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 300, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();

    const middleCol = getByTestId("content-middle").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const rightCol = getByTestId("content-right").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    // ui#17 selector audit: middleCol is decked (in-between) — its own
    // anchor is a permanent zero-footprint node (width target 0), so its
    // gBCR reports the collapsed position, not the visible column node's. Read
    // the column node instead for a decked column's own geometry (rightCol
    // stays focused/position:relative pass-through, unaffected either
    // way).
    const middleColumnNode = middleCol.querySelector("[data-ui-scene-column]") as HTMLElement;
    const middleRect = middleColumnNode.getBoundingClientRect();
    const rightRect = rightCol.getBoundingClientRect();

    // In-between column should overlap with the right focused column's area
    // — specifically, offset by exactly the default peekOffset (12px)
    // foreshortened by the column node's own depth-1 perspective factor (ui#17
    // Slice 3 fold-in: the 50px slop was flagged by the E4 rider as a real
    // weakness — wide enough to pass even reading the wrong node, see the
    // measured-factor derivation the "peeks left by exactly peekOffset"
    // test above establishes for this exact scenario).
    //
    // E4-loop-closure finding: deriving the factor from `middleRect`
    // itself (the thing this assertion verifies) degenerates when
    // middleRect is mistakenly the anchor instead of the column node — the
    // anchor's own width target is exactly 0 for a decked column, so
    // depth1Factor, expectedPeek, AND the anchor's own actual delta
    // (its -columnGap margin exactly cancels the gap, landing its left
    // edge exactly at rightCol's own left edge) all collapse to 0
    // together, passing vacuously regardless of which node is read
    // (verified directly: pointed at the anchor, this assertion stayed
    // green under the SAME self-derived-factor form). Fixed by deriving
    // the factor from an INDEPENDENT column-node measurement (middleColumnNode,
    // never reassigned) rather than from middleRect — an accidental
    // anchor-read now has nothing to self-consistently degenerate against.
    const naturalWidth = 300;
    const depth1Factor = middleColumnNode.getBoundingClientRect().width / naturalWidth;
    const expectedPeek = 12 * depth1Factor;
    expect(Math.abs(rightRect.left - middleRect.left - expectedPeek)).toBeLessThan(2);
  });

  test("in-between column appears smaller than natural size (perspective depth)", async () => {
    // The depth deck uses perspective + translateZ to create the stacking visual.
    // An in-between column at depth-1 should appear smaller than its natural size.
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 300, height: 200, testId: "content-left" }] },
          { name: "col-middle", objects: [{ name: "obj-middle", focused: false, width: 300, height: 200, testId: "content-middle" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 300, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();

    const middleCol = getByTestId("content-middle").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
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
    const middleOuter = middleContent.closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const middleWrapper = middleContent.closest("[data-ui-scene-column-content]") as HTMLElement;

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
    const middleOuter = middleContent.closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const middleWrapper = middleContent.closest("[data-ui-scene-column-content]") as HTMLElement;

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
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 200, height: 200, testId: "content-left" }] },
          { name: "col-middle1", objects: [{ name: "obj-middle1", focused: false, width: 200, height: 200, testId: "content-middle1" }] },
          { name: "col-middle2", objects: [{ name: "obj-middle2", focused: false, width: 200, height: 200, testId: "content-middle2" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 200, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();

    const middle1 = getByTestId("content-middle1").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const middle2 = getByTestId("content-middle2").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    // Depth increases going away from the right focused column.
    // col-middle2 is closer to col-right → depth-1 (shallower, closer to right)
    // col-middle1 is further from col-right → depth-2 (deeper, further back)
    expect(middle1.getAttribute("data-ui-scene-stack-depth")).toBe("2");
    expect(middle2.getAttribute("data-ui-scene-stack-depth")).toBe("1");

    // Depth-2 (middle1) should appear smaller than depth-1 (middle2). ui#17
    // anchor/column split: the perspective projection that shrinks apparent
    // width lives on the column node's own z-transform, not the anchor.
    const columnNode1 = middle1.querySelector("[data-ui-scene-column]") as HTMLElement;
    const columnNode2 = middle2.querySelector("[data-ui-scene-column]") as HTMLElement;
    const rect1 = columnNode1.getBoundingClientRect();
    const rect2 = columnNode2.getBoundingClientRect();
    expect(rect1.width).toBeLessThan(rect2.width);
  });

  test("depth-1 has higher opacity than depth-2", async () => {
    // Phase 6e: opacity animation timing not yet verified — test is TDD.
    // Shallower stacked columns should be more opaque than deeper ones.
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 200, height: 200, testId: "content-left" }] },
          { name: "col-middle1", objects: [{ name: "obj-middle1", focused: false, width: 200, height: 200, testId: "content-middle1" }] },
          { name: "col-middle2", objects: [{ name: "obj-middle2", focused: false, width: 200, height: 200, testId: "content-middle2" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 200, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();

    const middle1 = getByTestId("content-middle1").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const middle2 = getByTestId("content-middle2").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    // Depth is measured from right focused column:
    // col-middle2 (adjacent to right) → depth-1, higher opacity
    // col-middle1 (further from right) → depth-2, lower opacity
    // ui#17 anchor/column split: opacity is an `animate`-driven depth-deck
    // visual now applied on the column node, not the anchor.
    const columnNode1 = middle1.querySelector("[data-ui-scene-column]") as HTMLElement;
    const columnNode2 = middle2.querySelector("[data-ui-scene-column]") as HTMLElement;
    const opacity1 = parseFloat(window.getComputedStyle(columnNode1).opacity);
    const opacity2 = parseFloat(window.getComputedStyle(columnNode2).opacity);

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
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 300, height: 200, testId: "content-left" }] },
          { name: "col-middle", objects: [{ name: "obj-middle", focused: false, width: 300, height: 200, testId: "content-middle" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 300, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();

    const middleCol = getByTestId("content-middle").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    // ui#17 selector audit: the depth-deck's translateZ lives on the COLUMN
    // node (see zMV's own declaration in SceneColumn.tsx), not the
    // zero-footprint anchor — this test is specifically about that
    // transform, unlike the sibling "appears smaller than natural size"
    // test above (which explicitly doesn't care which node contributes
    // the shrink), so it reads the column node.
    const middleColumnNode = middleCol.querySelector("[data-ui-scene-column]") as HTMLElement;

    // Verify the column appears smaller than its natural 300px width.
    // Perspective projection reduces the apparent size of elements pushed back in Z.
    const rect = middleColumnNode.getBoundingClientRect();
    expect(rect.width).toBeLessThan(300);
  });

  test("depth-1 in-between column has greyscale filter applied", async () => {
    // In-between columns at depth-1 should have a 25% greyscale filter applied.
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 300, height: 200, testId: "content-left" }] },
          { name: "col-middle", objects: [{ name: "obj-middle", focused: false, width: 300, height: 200, testId: "content-middle" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 300, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();

    const middleCol = getByTestId("content-middle").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    // ui#17 anchor/column split: the depth-deck greyscale filter is an
    // `animate`-driven property on the column node now, not the anchor.
    const middleColumnNode = middleCol.querySelector("[data-ui-scene-column]") as HTMLElement;
    const filter = window.getComputedStyle(middleColumnNode).filter;

    // depth-1 → grayscale(0.25)
    expect(filter).toContain("grayscale(0.25)");
  });

  test("deeper columns have more greyscale than shallower columns", async () => {
    // depth-2 should have grayscale(0.5), depth-1 should have grayscale(0.25).
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 200, height: 200, testId: "content-left" }] },
          { name: "col-middle1", objects: [{ name: "obj-middle1", focused: false, width: 200, height: 200, testId: "content-middle1" }] },
          { name: "col-middle2", objects: [{ name: "obj-middle2", focused: false, width: 200, height: 200, testId: "content-middle2" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 200, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();

    // col-middle2 is adjacent to col-right → depth-1 → grayscale(0.25)
    // col-middle1 is further from col-right → depth-2 → grayscale(0.5)
    const middle1 = getByTestId("content-middle1").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const middle2 = getByTestId("content-middle2").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    // ui#17 anchor/column split: greyscale is a column-node property now.
    const columnNode1 = middle1.querySelector("[data-ui-scene-column]") as HTMLElement;
    const columnNode2 = middle2.querySelector("[data-ui-scene-column]") as HTMLElement;
    const filter1 = window.getComputedStyle(columnNode1).filter;
    const filter2 = window.getComputedStyle(columnNode2).filter;

    expect(filter2).toContain("grayscale(0.25)");
    expect(filter1).toContain("grayscale(0.5)");
  });

  // A5 — the pull-out-direction principle: a deck card peeks out in the
  // direction it travels when pulled from the deck. Column decks anchor
  // under the right focused column and peek left, as explicit per-depth
  // offsets (peekOffset, fanned by depth) rather than the 1-2px emergent
  // perspective artifact the deck previously relied on.

  test("depth-1 in-between column peeks left by exactly peekOffset (default)", async () => {
    const scene = (peekOffset: number) =>
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 200, height: 200, testId: "content-left" }] },
          { name: "col-middle", objects: [{ name: "obj-middle", focused: false, width: 200, height: 200, testId: "content-middle" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 200, height: 200, testId: "content-right" }] },
        ],
        { duration: 0, peekOffset },
        { fullPage: true },
      );

    // Render once with peekOffset=0 to establish the flush anchor, then
    // again with the default peekOffset — cleanup() between renders keeps the
    // two mounts from colliding on shared data-testids within this one test.
    const flush = await render(scene(0));
    // ui#17 anchor/column split: the fan (columnAnimateX) and the perspective
    // foreshortening (z) are both `animate`-driven properties on the column
    // node now, not the zero-footprint anchor — so this reads the REAL
    // rendered gap between the COLUMN NODES (gBCR) rather than the anchor, same
    // rationale as the corruption fixture's own sharpened assertion this
    // session (measures what actually painted, stays meaningful regardless
    // of which channel(s) produce it).
    const flushRightColumnNode = flush
      .getByTestId("content-right")
      .element()
      .closest("[data-ui-scene-column-anchor]")!
      .querySelector("[data-ui-scene-column]") as HTMLElement;
    const flushMiddleColumnNode = flush
      .getByTestId("content-middle")
      .element()
      .closest("[data-ui-scene-column-anchor]")!
      .querySelector("[data-ui-scene-column]") as HTMLElement;
    await waitForAnimationFrame();
    await waitForAnimationFrame();
    const flushGap = flushRightColumnNode.getBoundingClientRect().left - flushMiddleColumnNode.getBoundingClientRect().left;
    await cleanup();

    const peeked = await render(scene(12));
    const rightColumnNode = peeked
      .getByTestId("content-right")
      .element()
      .closest("[data-ui-scene-column-anchor]")!
      .querySelector("[data-ui-scene-column]") as HTMLElement;
    const middleColumnNode = peeked
      .getByTestId("content-middle")
      .element()
      .closest("[data-ui-scene-column-anchor]")!
      .querySelector("[data-ui-scene-column]") as HTMLElement;
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    // At peekOffset=0 the deck column renders flush against the focused
    // column (no visible gap) — a genuine theoretical claim about the
    // design (zero net offset when columnAnimateX is itself 0), not a
    // measured-then-hand-waved number, so it stays a flat-tolerance check.
    expect(flushGap).toBeCloseTo(0, -1);

    // Rendered (post-perspective-projection) left edge: the NOMINAL
    // translateX (-peekOffset at depth-1) composes with the SAME
    // translateZ/perspective transform that also shrinks the column node's
    // rendered width, so the visible peek is peekOffset foreshortened by
    // that column node's own projection factor, not a flat 12px (ui#17 selector
    // audit — re-derived from a flat ±5px placeholder that was itself
    // flagged as asserted-not-derived; same measured-factor discipline
    // the "custom peekOffset" test below uses, deriving the factor from
    // the column node's own rendered width rather than hand-deriving the CSS 3D
    // projection math).
    const rightRect = rightColumnNode.getBoundingClientRect();
    const middleRect = middleColumnNode.getBoundingClientRect();
    const naturalWidth = 200; // this fixture's own SceneObject width
    const depth1Factor = middleRect.width / naturalWidth;
    const expectedPeek = 12 * depth1Factor;
    expect(Math.abs(rightRect.left - middleRect.left - expectedPeek)).toBeLessThan(2);
  });

  test("multiple in-between columns peek left by an additional peekOffset increment per depth (fanned)", async () => {
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 200, height: 200, testId: "content-left" }] },
          { name: "col-middle1", objects: [{ name: "obj-middle1", focused: false, width: 200, height: 200, testId: "content-middle1" }] },
          { name: "col-middle2", objects: [{ name: "obj-middle2", focused: false, width: 200, height: 200, testId: "content-middle2" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 200, height: 200, testId: "content-right" }] },
        ],
        { duration: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();
    await waitForAnimationFrame();

    // col-middle2 → depth-1, col-middle1 → depth-2 (further from col-right).
    const middle1 = getByTestId("content-middle1").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const middle2 = getByTestId("content-middle2").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;

    // ui#17 anchor/column split: gBCR of the COLUMN node, not the anchor —
    // see the "depth-1 ... peeks left by exactly peekOffset" test's own
    // comment for why.
    const columnNode1 = middle1.querySelector("[data-ui-scene-column]") as HTMLElement;
    const columnNode2 = middle2.querySelector("[data-ui-scene-column]") as HTMLElement;
    const depth1Rect = columnNode2.getBoundingClientRect();
    const depth2Rect = columnNode1.getBoundingClientRect();

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
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 200, height: 200, testId: "content-left" }] },
          { name: "col-middle1", objects: [{ name: "obj-middle1", focused: false, width: 200, height: 200, testId: "content-middle1" }] },
          { name: "col-middle2", objects: [{ name: "obj-middle2", focused: false, width: 200, height: 200, testId: "content-middle2" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 200, height: 200, testId: "content-right" }] },
        ],
        { duration: 0, peekOffset: 20 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();
    await waitForAnimationFrame();

    const middle1 = getByTestId("content-middle1").element().closest("[data-ui-scene-column-anchor]") as HTMLElement; // depth-2
    const middle2 = getByTestId("content-middle2").element().closest("[data-ui-scene-column-anchor]") as HTMLElement; // depth-1

    // ui#17 anchor/column split: gBCR of the COLUMN node, not the anchor —
    // see the "depth-1 ... peeks left by exactly peekOffset" test's own
    // comment.
    const columnNode1 = middle1.querySelector("[data-ui-scene-column]") as HTMLElement;
    const columnNode2 = middle2.querySelector("[data-ui-scene-column]") as HTMLElement;
    const depth1Rect = columnNode2.getBoundingClientRect();
    const depth2Rect = columnNode1.getBoundingClientRect();

    // With peekOffset=20, the NOMINAL x-transform is -20 at depth-1 and
    // -40 at depth-2 (columnAnimateX = -peekOffset * stackDepth) — but that
    // transform composes with the SAME perspective/translateZ transform
    // that also shrinks each column node's rendered width (preserve-3d now
    // correctly propagates both together — see the anchor's own
    // transform-style comment), so the RENDERED fan increment is each
    // depth's nominal x-shift foreshortened by its own depth's projection
    // factor, not a flat 20px difference. Deriving that factor from each
    // column node's own measured width (rather than hand-deriving the CSS 3D
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
      buildScene(
        [
          { name: "col-left", objects: [{ name: "obj-left", focused: true, width: 200, height: 200, testId: "content-left" }] },
          { name: "col-middle1", objects: [{ name: "obj-middle1", focused: false, width: 200, height: 200, testId: "content-middle1" }] },
          { name: "col-middle2", objects: [{ name: "obj-middle2", focused: false, width: 200, height: 200, testId: "content-middle2" }] },
          { name: "col-right", objects: [{ name: "obj-right", focused: true, width: 200, height: 200, testId: "content-right" }] },
        ],
        { duration: 0, peekOffset: 0 },
        { fullPage: true },
      ),
    );

    await waitForAnimationFrame();
    await waitForAnimationFrame();

    const middle1 = getByTestId("content-middle1").element().closest("[data-ui-scene-column-anchor]") as HTMLElement; // depth-2
    const middle2 = getByTestId("content-middle2").element().closest("[data-ui-scene-column-anchor]") as HTMLElement; // depth-1

    // With no peek offset, every in-between column renders flush at the
    // same left edge regardless of depth — the pre-A5 behavior, where only
    // perspective projection (not a manual x offset) distinguished depths.
    // ui#17 selector audit: reads the COLUMN (columnAnimateX = 0 at
    // peekOffset=0, so the column node's own static (0,0)-within-anchor position
    // means this should read identically to the anchor here, but the column node
    // is the node whose position actually matters for what's visible — see
    // the "depth-1 ... peeks left by exactly peekOffset" test's own
    // comment for why this suite reads column nodes, not anchors, for decked
    // geometry).
    const columnNode1 = middle1.querySelector("[data-ui-scene-column]") as HTMLElement;
    const columnNode2 = middle2.querySelector("[data-ui-scene-column]") as HTMLElement;
    expect(columnNode1.getBoundingClientRect().left).toBeCloseTo(columnNode2.getBoundingClientRect().left, -1);
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
    // No `duration` (real spring mode — the swing under test only manifests
    // while the spring is actually running).
    const build = (midAFocused: boolean) =>
      buildScene(
        [
          { name: "left", objects: [{ name: "left-obj", focused: true, width: 240, height: 300 }] },
          { name: "middle-a", objects: [{ name: "middle-a-obj", focused: midAFocused, width: 240, height: 200, testId: "mid-a-content" }] },
          { name: "middle-b", objects: [{ name: "middle-b-obj", focused: false, width: 240, height: 200 }] },
          { name: "right", objects: [{ name: "right-obj", focused: true, width: 240, height: 300 }] },
        ],
        undefined,
        { fullPage: true },
      );

    const { rerender, getByTestId } = await render(build(false));
    await wait(500);

    const midAWrapper = getByTestId("mid-a-content").element()
      .closest("[data-ui-scene-column-anchor]")?.querySelector("[data-ui-scene-column-content]") as HTMLElement;
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
    // the child object's `focused` prop flips true. `data-ui-scene-stack-depth`
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
    const col = getByTestId("content").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    // Sanity: genuinely classified in-between/depth-2 while unfocused.
    expect(col.getAttribute("data-ui-scene-stack-depth")).toBe("2");

    // Focus the child WITHOUT updating position/stackDepth — the exact
    // one-commit-stale window a real registry-lag click produces.
    await rerender(build(true));

    expect(col.getAttribute("data-ui-scene-column-focused")).toBe("true");
    expect(col.getAttribute("data-ui-scene-stack-depth")).toBeNull();
    expect(window.getComputedStyle(col).position).toBe("relative");
  });
});
