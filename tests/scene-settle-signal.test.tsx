import { describe, test, expect } from "vitest";
import { userEvent } from "vitest/browser";
import { useState } from "react";
import { render } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { TestWrapper } from "./test-wrapper";
import {
  waitForAnimationFrame,
  waitForAnimationsToSettle,
  wait,
  waitForSceneSettled,
  settleThenClick,
} from "./utils/animation";

// ---------------------------------------------------------------------------
// data-ui-scene-settled (criterion 1)
// ---------------------------------------------------------------------------

describe("data-ui-scene-settled", () => {
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
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("true");
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
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("true");

    getByTestId("focus-right").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForAnimationFrame();
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("false");

    await wait(1000);
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("true");
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

  test("does not fire for a non-focus-driven settle (a content-resize settle), while data-ui-scene-settled still behaves correctly (required discriminator, addendum v1 decision 5)", async () => {
    const fired: unknown[] = [];

    function Harness() {
      const [contentWidth, setContentWidth] = useState(200);
      return (
        <Scene onTransitionEnd={(arrangement) => fired.push(arrangement)}>
          <SceneColumn name="col">
            <SceneObject name="obj" focused>
              <div data-testid="content" style={{ width: contentWidth, height: 200 }}>
                content
              </div>
            </SceneObject>
          </SceneColumn>
          <button data-testid="grow" onClick={() => setContentWidth(600)}>
            grow
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
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("true");

    // Content-resize settle: no `focused` prop anywhere ever changes.
    getByTestId("grow").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForAnimationFrame();
    // data-ui-scene-settled still behaves (criterion 1 is mechanism-broad —
    // it flips false for ANY owned-channel claim, focus-driven or not).
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("false");

    await wait(1000);
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("true");
    // onTransitionEnd (criterion 8, focus-transition-narrow) must NOT have
    // fired — the settle was real, but never focus-driven.
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

  test("within-column swap (never-sandwiched siblings) fires exactly once with the correct settled arrangement — the scenario the object-level fingerprint fork exists for", async () => {
    const fired: Array<Array<{ name: string; focused: boolean }>> = [];

    function Harness() {
      const [focused, setFocused] = useState<"a" | "b">("a");
      return (
        <Scene onTransitionEnd={(arrangement) => fired.push(arrangement)}>
          <SceneColumn name="col">
            <SceneObject name="a-obj" focused={focused === "a"}>
              <div style={{ width: 300, height: 200 }}>a</div>
            </SceneObject>
            <SceneObject name="b-obj" focused={focused === "b"}>
              <div style={{ width: 300, height: 200 }}>b</div>
            </SceneObject>
          </SceneColumn>
          <button data-testid="swap" onClick={() => setFocused("b")}>
            swap
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
    await waitForSceneSettled(scene, { timeoutMs: 2000 });
    expect(fired.length).toBe(0);

    // Deliberately a within-column swap between two never-sandwiched
    // siblings with matching declared width (mirrors the "flips false"
    // test's own discovery above: neither object's own height channel nor
    // the column's own width channel ever engages for this shape — see
    // that test's comment). The column's own aggregate `focused` stays
    // true throughout the whole swap, so a COLUMN-level fingerprint (the
    // plan body's own literal recommendation, reusing
    // columnStatesFingerprintRef as-is) would silently never detect this
    // as a focus-arrangement change at all — this is exactly the scenario
    // the object-level fingerprint fork (RegisteredColumn.objectStates)
    // exists to catch, and it's ui#21's whole within-column-swap feature.
    getByTestId("swap").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Anchored on the fire itself, not a fixed wait: this swap may settle
    // synchronously (nothing ever claims for this never-sandwiched,
    // matching-geometry pair — the same "counter never rises" shape the
    // duration=0 unified-fire-rule test above exercises) or take a real
    // frame or two, and a too-short fixed wait can false-fail before the
    // fire is observable.
    const fireDeadline = performance.now() + 2000;
    while (fired.length === 0 && performance.now() < fireDeadline) {
      await waitForAnimationFrame();
    }

    expect(fired.length).toBe(1);
    const arrangement = fired[0]!;
    expect(arrangement.find((o) => o.name === "a-obj")?.focused).toBe(false);
    expect(arrangement.find((o) => o.name === "b-obj")?.focused).toBe(true);
  });

  test("duration={0} focus change fires exactly once, synchronously, with the correct payload (F3 unified fire rule)", async () => {
    const fired: Array<Array<{ name: string; focused: boolean }>> = [];

    function Harness() {
      const [focused, setFocused] = useState<"left" | "right">("left");
      return (
        <Scene duration={0} onTransitionEnd={(arrangement) => fired.push(arrangement)}>
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
    expect(fired.length).toBe(0);

    getByTestId("focus-right").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // duration=0 never claims (jump() only) — the settle counter never
    // rises above 0, so the fire is synchronous, before this awaited frame
    // even resolves.
    await waitForAnimationFrame();

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

describe("inertness gating: settled-unfocused objects (see 'double interruption' for the mid-transition case)", () => {
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
    const objectA = getByTestId("content-a").element().closest("[data-ui-scene-id]") as HTMLElement;

    // b is settled-unfocused: its content stays inert.
    const bInnerWrapper = contentB.parentElement as HTMLElement;
    expect(bInnerWrapper.hasAttribute("inert")).toBe(true);

    // a is already focused — clicking it is a no-op path (onClick is undefined
    // once focused, per the existing `!focused ? onActivate : undefined` gate).
    objectA.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForAnimationFrame();
    expect(activateCount).toBe(0);
  });

  test("mid-transition real click on the unfocused object fires no onActivate; post-settle click fires onActivate and never reaches its own content (criteria 3/9)", async () => {
    let leftActivateCount = 0;
    let leftContentClicks = 0;

    function Harness() {
      const [focused, setFocused] = useState<"left" | "right">("left");
      return (
        <Scene>
          <SceneColumn name="left">
            <SceneObject
              name="left-obj"
              focused={focused === "left"}
              onActivate={() => {
                leftActivateCount++;
                setFocused("left");
              }}
            >
              <div data-testid="content-left" style={{ width: 300, height: 200 }}>
                <button data-testid="left-btn" onClick={() => leftContentClicks++}>
                  left button
                </button>
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

    const leftObject = getByTestId("content-left").element().closest("[data-ui-scene-id]") as HTMLElement;
    const leftRect = leftObject.getBoundingClientRect();
    const leftX = leftRect.x + leftRect.width / 2;
    const leftY = leftRect.y + leftRect.height / 2;

    // Trigger the transition: focus "right", making "left" the transitioning
    // object (settled-focused -> in-transition -> settled-unfocused).
    getByTestId("focus-right").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForAnimationFrame();
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("false");

    // Mid-transition: a real hit-tested click at "left"'s own position must
    // have NO effect — the whole scene is inert while ANY focus transition
    // is pending (Michael's ruled contract), including "left" itself, which
    // is neither settled-focused nor settled-unfocused right now.
    const hitEl = document.elementFromPoint(leftX, leftY);
    hitEl?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: leftX, clientY: leftY }));
    await waitForAnimationFrame();
    expect(leftActivateCount).toBe(0);
    expect(leftContentClicks).toBe(0);

    // Post-settle: "left" is now settled-unfocused. A real hit-tested click
    // at its (current) position must fire onActivate, and — since its
    // content wrapper is still inert at the moment of the click (inert
    // clears only once THIS object becomes focused AND its own settle edge
    // is reached) — the click must never reach the inner button.
    // settleThenClick (criterion 5's own primitive): the click target is a
    // deferred hit-test, not a fixed reference, because the camera pans to
    // center "right" while settling — "left"'s pre-transition coordinates
    // (captured above) no longer point at it once settled, so the hit-test
    // itself must run AFTER the wait resolves, not before.
    await settleThenClick(
      scene,
      {
        click: () => {
          const postSettleRect = leftObject.getBoundingClientRect();
          const postSettleX = postSettleRect.x + postSettleRect.width / 2;
          const postSettleY = postSettleRect.y + postSettleRect.height / 2;
          const postSettleHitEl = document.elementFromPoint(postSettleX, postSettleY);
          postSettleHitEl?.dispatchEvent(
            new MouseEvent("click", { bubbles: true, clientX: postSettleX, clientY: postSettleY }),
          );
        },
      },
      { timeoutMs: 2000 },
    );
    await waitForAnimationFrame();
    expect(leftActivateCount).toBe(1);
    expect(leftContentClicks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Two-phase focus (F2)
// ---------------------------------------------------------------------------

describe("two-phase focus", () => {
  test("non-zero-duration focus-gain: DOM focus lands on the anchor mid-transition, moves to the first focusable descendant post-settle", async () => {
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
                <button data-testid="right-btn">right button</button>
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

    const rightAnchor = getByTestId("content-right").element().closest("[data-ui-scene-id]") as HTMLElement;
    const rightBtn = getByTestId("right-btn").element() as HTMLElement;

    getByTestId("focus-right").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForAnimationFrame();
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("false");
    // Phase 1: mid-transition, DOM focus is on the anchor — the content
    // wrapper (and the button inside it) is still inert, so the anchor
    // (outside the inert wrapper) is the only valid focus target.
    expect(document.activeElement).toBe(rightAnchor);

    await waitForSceneSettled(scene, { timeoutMs: 2000 });
    // Phase 2: post-settle, DOM focus has moved to the first focusable
    // descendant.
    expect(document.activeElement).toBe(rightBtn);
  });
});

// ---------------------------------------------------------------------------
// Double-interruption semantics (F4 REVISION v3)
// ---------------------------------------------------------------------------

describe("double interruption", () => {
  test("ambient claim in flight, focus change lands mid-flight: transitionPending holds to the true global 0-crossing, exactly-once fire, untouched focused object's content stays interactive throughout", async () => {
    const fired: Array<Array<{ name: string; focused: boolean }>> = [];

    function Harness() {
      const [growerWidth, setGrowerWidth] = useState(200);
      const [targetFocused, setTargetFocused] = useState(false);
      return (
        <Scene onTransitionEnd={(arrangement) => fired.push(arrangement)}>
          <SceneColumn name="anchor">
            <SceneObject name="anchor-obj" focused style={{ width: 200, height: 150 }}>
              <button data-testid="anchor-btn">anchor button</button>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="grower">
            <SceneObject name="grower-obj" focused>
              <div style={{ width: growerWidth, height: 150 }}>grower</div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="target">
            <SceneObject name="target-obj" focused={targetFocused}>
              <div style={{ width: 200, height: 150 }}>target</div>
            </SceneObject>
          </SceneColumn>
          <button data-testid="grow" onClick={() => setGrowerWidth(600)}>
            grow
          </button>
          <button data-testid="focus-target" onClick={() => setTargetFocused(true)}>
            focus target
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

    const anchorBtn = getByTestId("anchor-btn").element() as HTMLElement;
    const anchorInnerWrapper = anchorBtn.parentElement as HTMLElement;
    expect(anchorInnerWrapper.hasAttribute("inert")).toBe(false);

    // Start the ambient claim: "grower" grows — a real owned-channel claim
    // with NO focus-arrangement change anywhere (both anchor and grower
    // stay focused throughout). F4's own consequence (a): ambient
    // animations inert NOBODY — transitionPending only arms on a genuine
    // focus-arrangement change, so "anchor" stays fully interactive
    // through the ambient-only phase, even though the scene is not
    // data-ui-scene-settled.
    getByTestId("grow").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForAnimationFrame();
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("false");
    expect(anchorInnerWrapper.hasAttribute("inert")).toBe(false);

    // Land a genuine focus change mid-flight of the ambient claim —
    // transitionPending still arms (it still drives `activatable` and the
    // two-phase focus-delivery timing), but under Option A it no longer
    // touches content inertness. "anchor" never toggled its own `focused`
    // prop, so its content stays interactive throughout — this is "inert
    // follows focus intent" holding at the scene-wide level, not just the
    // per-object level.
    getByTestId("focus-target").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait(200);
    expect(anchorInnerWrapper.hasAttribute("inert")).toBe(false);

    await waitForSceneSettled(scene, { timeoutMs: 3000 });

    // Exactly-once fire, at the TRUE global 0-crossing.
    expect(fired.length).toBe(1);
    const arrangement = fired[0]!;
    expect(arrangement.find((o) => o.name === "anchor-obj")?.focused).toBe(true);
    expect(arrangement.find((o) => o.name === "grower-obj")?.focused).toBe(true);
    expect(arrangement.find((o) => o.name === "target-obj")?.focused).toBe(true);

    // The untouched focused object's content stayed interactive throughout
    // — it was never inerted in the first place, so there's nothing to
    // re-enable at this edge.
    expect(anchorInnerWrapper.hasAttribute("inert")).toBe(false);
  });

  // SKIPPED — real, pre-existing, universal architectural gap discovered
  // while writing this required test (addendum v2 F3, adopted from the
  // delta review's margins), reported as a blocker rather than shipped as
  // a fake pass or silently dropped. Filed on the board as ui#o42 (records
  // this exact repro). Root cause (probe-confirmed, isolated
  // from ui#20's own code): EVERY owned MotionValue channel in the Scene
  // family (Scene.tsx's cameraX/left, SceneObject.tsx's height/
  // marginBottom, SceneColumn.tsx's width/marginRight/z/columnWidth/top —
  // grep `duration === 0 ?` across all three files, zero exceptions) binds
  // its style prop as `duration === 0 ? <plain number> : <MotionValue>`.
  // When `duration` flips from non-zero to 0 WHILE that specific channel
  // has a real animate() call in flight, the rendered style stops
  // referencing the MotionValue — and the in-flight animation's own value
  // FREEZES (confirmed via direct instrumentation: cameraX.get() and a
  // height channel's own MotionValue both stopped progressing entirely,
  // never reaching their target, `onComplete` never firing, even after a
  // 10-15s wait) rather than either completing or being explicitly
  // stopped. This is universal (every channel exhibits it, tested two
  // independently: cameraX via a cross-column focus swap, and a
  // SceneObject height channel via a within-column sandwiched swap
  // specifically chosen to avoid touching cameraX at all — both froze
  // identically) and predates ui#20 entirely: no code this ticket touches
  // (Scene's own settle-tracking effect, TransitionPendingContext,
  // SceneObject's activatable/inert gating) is involved in the freeze —
  // it happens purely in the pre-existing `duration === 0 ? ... : ...`
  // style-binding switch, which no consumer had ever exercised with a
  // LIVE mid-flight flip before (existing usage is always a static prop).
  // Fixing it would mean decoupling every channel's duration===0 "plain
  // number" optimization from its own animation lifecycle — a
  // cross-cutting production change spanning all three files, well beyond
  // this ticket's settle-signal/inertness scope. ui#20's OWN mechanism
  // (transitionPending/onTransitionEnd, built on top of whatever the
  // claim/retire seam reports) is not implicated: it correctly reflects
  // "counter never reaches zero" for exactly as long as the frozen
  // channel never retires — the counter/signal layer is accurately
  // reporting a real, un-settled channel, not misreporting a settled one.
  test("mixed-duration double interruption: an animated focus transition interrupted by a live duration->0 flip fires onTransitionEnd exactly once with the correct terminal state", async () => {
    const fired: Array<Array<{ name: string; focused: boolean }>> = [];

    // Within-column swap (a<->b, c always focused), NOT a cross-column
    // focus move: deliberately avoids engaging the camera-pan channel
    // (cameraX) at all — a single column that stays focused throughout
    // has a stable horizontal position, so this exercises the settle-
    // signal layer's OWN interruption handling in isolation from a
    // separate, pre-existing interaction this ticket does not own (a live
    // `duration` prop flip while cameraX specifically is mid-flight was
    // probe-confirmed, out of scope, to leave Motion's own animation
    // stuck — the stage's `style.left` binding switches from the cameraX
    // MotionValue to the plain `stageLeft` number when duration flips to
    // 0, and the in-flight camera animation's value freezes rather than
    // completing; unrelated to ui#20's own settle/inertness code, which
    // never touches driveCameraX or the stage's style binding). "b" is
    // sandwiched at mount (a and c focused around it), so its own height
    // channel is already armed (wasEverSandwichedRef) before the swap.
    function Harness() {
      const [swapped, setSwapped] = useState(false);
      const [duration, setDuration] = useState<number | undefined>(undefined);
      return (
        <Scene duration={duration} onTransitionEnd={(arrangement) => fired.push(arrangement)}>
          <SceneColumn name="col">
            <SceneObject name="a-obj" focused={!swapped}>
              <div style={{ width: 300, height: 150 }}>a</div>
            </SceneObject>
            <SceneObject name="b-obj" focused={swapped}>
              <div style={{ width: 300, height: 150 }}>b</div>
            </SceneObject>
            <SceneObject name="c-obj" focused>
              <div style={{ width: 300, height: 150 }}>c</div>
            </SceneObject>
          </SceneColumn>
          <button data-testid="swap" onClick={() => setSwapped(true)}>
            swap
          </button>
          <button data-testid="reduce-motion" onClick={() => setDuration(0)}>
            simulate reduced-motion mid-flight
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

    getByTestId("swap").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForAnimationFrame();
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("false");

    // Interrupt mid-transition with a live duration->0 flip (simulating
    // prefers-reduced-motion toggling mid-transition).
    getByTestId("reduce-motion").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForSceneSettled(scene, { timeoutMs: 3000 });

    expect(fired.length).toBe(1);
    const arrangement = fired[0]!;
    expect(arrangement.find((o) => o.name === "a-obj")?.focused).toBe(false);
    expect(arrangement.find((o) => o.name === "b-obj")?.focused).toBe(true);
    expect(arrangement.find((o) => o.name === "c-obj")?.focused).toBe(true);
  });

  // Cross-column companion to "mixed-duration double interruption" above —
  // the second freeze variant the ui#o42 citation's own prose describes but
  // deliberately doesn't exercise (that test explicitly stays within one
  // column to avoid engaging cameraX at all). A cross-column focus swap
  // moves the FOCUSED span, engaging Scene's own camera-recentering effect
  // (driveCameraX) — "presumably covered by the same per-channel fix" is
  // the exact reasoning gap that produced the original bug: cameraX has no
  // per-channel target-changed guard to extend the way the other 7 owned
  // channels do (see ownedAnimation.ts's own doc comment), so it needed its
  // own carve-out fix and its own dedicated test.
  test("cameraX cross-column live flip: a focus-driven camera pan interrupted by a live duration->0 flip fires onTransitionEnd exactly once and settles", async () => {
    const fired: Array<Array<{ name: string; focused: boolean }>> = [];

    function Harness() {
      const [focusedCol, setFocusedCol] = useState<"a" | "b">("a");
      const [duration, setDuration] = useState<number | undefined>(undefined);
      return (
        <Scene duration={duration} onTransitionEnd={(arrangement) => fired.push(arrangement)}>
          <SceneColumn name="col-a">
            <SceneObject name="a-obj" focused={focusedCol === "a"}>
              <div style={{ width: 300, height: 150 }}>a</div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-b">
            <SceneObject name="b-obj" focused={focusedCol === "b"}>
              <div style={{ width: 300, height: 150 }}>b</div>
            </SceneObject>
          </SceneColumn>
          <button data-testid="swap-column" onClick={() => setFocusedCol("b")}>
            swap column
          </button>
          <button data-testid="reduce-motion" onClick={() => setDuration(0)}>
            simulate reduced-motion mid-flight
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

    getByTestId("swap-column").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForAnimationFrame();
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("false");

    // Interrupt mid-transition with a live duration->0 flip (simulating
    // prefers-reduced-motion toggling mid-flight while the camera is
    // actively panning to the newly-focused column).
    getByTestId("reduce-motion").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForSceneSettled(scene, { timeoutMs: 3000 });

    expect(fired.length).toBe(1);
    const arrangement = fired[0]!;
    expect(arrangement.find((o) => o.name === "a-obj")?.focused).toBe(false);
    expect(arrangement.find((o) => o.name === "b-obj")?.focused).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Consumer contract: real-input writes mid-transition land immediately (ui#31)
// ---------------------------------------------------------------------------

describe("consumer contract: settle-gated real input", () => {
  // Incident report: a consumer (agent-task) suite failed deterministically
  // after ui#20 shipped — a real Playwright `.fill()` into a newly-focused
  // object's textarea, dispatched immediately after the triggering click
  // with no settle wait, silently wrote nothing. React state stayed "",
  // the consumer's own submit button (enablement derived from the typed
  // state) stayed permanently disabled, and the deadlock outlived the
  // transition entirely — a transient inert window became a permanent
  // latch. Root cause (ui#p23): Scene's settle signal and
  // `transitionPending` clear correctly on schedule; the runner
  // (Playwright) is structurally blind to `inert` (source-verified: zero
  // references to "inert" in playwright-core's actionability code) and
  // neither waits for nor retries past it — under motion-timed inertness,
  // `.fill()` would return successfully having written nothing.
  //
  // This test pins Option A's ruled contract (ui#31, feed #2395/#2396):
  // content inertness follows focus INTENT, not motion completion, so a
  // newly-focused object's content is interactive from the moment its
  // `focused` prop flips true. The mid-transition write below lands,
  // closing the incident's root cause at the source rather than requiring
  // every consumer to poll `data-ui-scene-settled` before driving real
  // input — that helper remains correct for anything that's genuinely
  // motion-dependent (autofocus-after-settle, layout measurement), just no
  // longer required for input to land.
  test("mid-transition real-input write to a newly-focused object lands immediately; value survives settle", async () => {
    function Harness() {
      const [focused, setFocused] = useState<"a" | "b">("a");
      const [value, setValue] = useState("");
      return (
        <Scene>
          <SceneColumn name="a">
            <SceneObject name="a-obj" focused={focused === "a"}>
              <div data-testid="content-a" style={{ width: 300, height: 200 }}>
                a
              </div>
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="b">
            <SceneObject name="b-obj" focused={focused === "b"} onActivate={() => setFocused("b")}>
              <div data-testid="content-b" style={{ width: 300, height: 200 }}>
                <textarea data-testid="b-textarea" value={value} onChange={(e) => setValue(e.target.value)} />
                <button data-testid="b-submit" disabled={value === ""}>
                  submit
                </button>
              </div>
            </SceneObject>
          </SceneColumn>
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

    // Genuine focus-arrangement change: click b's own content, bubbling up
    // to the outer wrapper's onActivate handler. `dispatchEvent()` bypasses
    // the browser's native hit-testing/inert suppression entirely (b's
    // content is still inert at the moment of this click, being
    // settled-unfocused) — the same scripted-dispatch technique every other
    // click trigger in this file already uses (e.g. lines 78, 244, 418),
    // not a new risk.
    getByTestId("content-b").element().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Non-vacuity precondition — the write below must land inside a real
    // in-transition window, not after an already-settled scene.
    await waitForAnimationFrame();
    expect(scene.getAttribute("data-ui-scene-settled")).toBe("false");

    const textarea = getByTestId("b-textarea").element() as HTMLTextAreaElement;
    const submitBtn = getByTestId("b-submit").element() as HTMLButtonElement;
    const contentBWrapper = getByTestId("content-b").element().parentElement as HTMLElement;

    // Mid-transition write: b's content wrapper is already interactive —
    // it's the newly-focused object, and under Option A content inertness
    // is gated on `!focused` alone, not on `transitionPending`. The write
    // lands immediately, same as it would post-settle.
    expect(contentBWrapper.inert).toBe(false);
    await userEvent.fill(textarea, "hello");
    expect(textarea.value).toBe("hello");
    expect(submitBtn.disabled).toBe(false);

    await waitForSceneSettled(scene, { timeoutMs: 2000 });

    // Post-settle: the value survives settle — nothing about the settle
    // transition reverts what already landed mid-flight.
    expect(textarea.value).toBe("hello");
    expect(submitBtn.disabled).toBe(false);
  });
});
