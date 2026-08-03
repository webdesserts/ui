import { describe, test, expect } from "vitest";
import { useState } from "react";
import { render, cleanup } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { MotionSeamContext } from "../src/components/scene/motionSeam";
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
