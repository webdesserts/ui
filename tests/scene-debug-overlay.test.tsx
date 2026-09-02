import { describe, test, expect, vi } from "vitest";
import { render, cleanup } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { MotionSeamContext } from "../src/components/scene/motionSeam";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame, wait, createMotionSeamRecorder } from "./utils/animation";
import { buildScene } from "./utils/sceneFixtures";

// ---------------------------------------------------------------------------
// Phase 1: Debug mode
// ---------------------------------------------------------------------------

describe("Scene debug mode", () => {
  test("debug disabled — no overlays present", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element();
    // No debug overlay should be present when debug is not enabled
    expect(scene.querySelector("[data-ui-scene-debug-overlay]")).toBeNull();
  });

  test("debug does not affect layout", async () => {
    // Enabling debug should not change the column's computed position or flex
    const { getByTestId: withDebug } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div data-testid="debug-content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const colDebug = withDebug("debug-content").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
    const styleDebug = window.getComputedStyle(colDebug);
    expect(styleDebug.position).toBe("relative");
    expect(styleDebug.flexGrow).toBe("0");
  });

  test("debug enabled — viewport has cyan outline", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const style = window.getComputedStyle(scene);
    // Debug mode adds a cyan outline to the viewport.
    // Browsers may resolve "cyan" to rgb(0, 255, 255) in computed style.
    const outline = style.outline + style.outlineColor;
    expect(outline).toMatch(/cyan|rgb\(0,\s*255,\s*255\)/);
  });

  test("debug enabled — overlay panel lists object names and focus state", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="my-object" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element();
    const overlay = scene.querySelector("[data-ui-scene-debug-overlay]");
    expect(overlay).not.toBeNull();
    // Overlay should mention the object name and focused state
    expect(overlay?.textContent).toContain("my-object");
    expect(overlay?.textContent).toContain("focused");
  });
});

// ---------------------------------------------------------------------------
// F4: Debug — observational purity (spec: scene-debug.feature "Debug does not
// affect layout"). The existing "debug does not affect layout" test above
// only checks one column's computed position/flexGrow — it doesn't catch a
// debug-only DOM node actually widening the scene's scroll extent (the
// CameraDebug-incident class documented on warnStrayChild, above). These
// pins compare the FULL scroll/layout footprint (scrollWidth/Height,
// clientWidth/Height, per-column rects) between debug on and off for the
// same underlying content, across three representative layouts.
//
// The discriminating fixtures below deliberately give one SceneObject a long,
// hyphen/space-free (unbreakable) name and position it near the viewport's
// right edge. This isn't a contrived edge case: SceneObjectOutlines' name
// label is a `position: absolute` <span> anchored at its outline box's
// top-left with no width constraint — an unbreakable name wider than the
// object's own box overflows the outline box unclipped, and (absent
// containment) that overflow is real, positive-direction (rightward) content
// that widens the viewport's scrollable overflow area — this reproduces even
// though the outline box ITSELF (an exact-rect duplicate of the real
// object's box) never does, since browsers still report the larger
// scrollWidth for overflow:hidden content, they just don't render a
// scrollbar for it (verified directly: a plain overflow:hidden div with an
// absolutely-positioned overflowing child reports the wider scrollWidth).
// ---------------------------------------------------------------------------

describe("Scene debug — layout purity (scrollWidth/scrollHeight identical on/off)", () => {
  const UNBREAKABLE_LONG_NAME = "reallylongsceneobjectnamewithnobreaksatallwhatsoever";

  /** scrollWidth/scrollHeight/clientWidth/clientHeight for the scene element. */
  function measureScrollMetrics(scene: HTMLElement) {
    return {
      scrollWidth: scene.scrollWidth,
      scrollHeight: scene.scrollHeight,
      clientWidth: scene.clientWidth,
      clientHeight: scene.clientHeight,
    };
  }

  test("fits-and-centered: identical scroll metrics with debug on vs off", async () => {
    // A single narrow focused SceneObject with a long unbreakable name,
    // centered in a viewport just wide enough to fit it. No native overflow
    // exists without debug; the debug label's overflow (if unclipped) would
    // create overflow that doesn't exist without debug.
    const build = (debug: boolean) => (
      <TestWrapper fullPage width={100} height={200}>
        <Scene duration={0} debug={debug}>
          <SceneColumn name="col">
            <SceneObject name={UNBREAKABLE_LONG_NAME} focused>
              <div data-testid="content" style={{ width: 20, height: 20 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const off = await render(build(false));
    await waitForAnimationFrame();
    const metricsOff = measureScrollMetrics(off.getByTestId("scene").element() as HTMLElement);
    await cleanup();

    const on = await render(build(true));
    await waitForAnimationFrame();
    const metricsOn = measureScrollMetrics(on.getByTestId("scene").element() as HTMLElement);
    await cleanup();

    expect(metricsOn).toEqual(metricsOff);
  });

  test("horizontal-overflow with parked columns: identical scroll metrics with debug on vs off", async () => {
    // Two 800px focused columns already overflow a 1280px viewport
    // natively. A third column (long unbreakable name) is focused at mount
    // (to freeze its size), then unfocused so it parks just past the two
    // focused columns — exercising a parked/offscreen-classified column
    // alongside existing native overflow.
    async function build(debug: boolean) {
      const mountJsx = (farRightFocused: boolean) => (
        <TestWrapper fullPage>
          <Scene duration={0} debug={debug}>
            <SceneColumn name="col-a">
              <SceneObject name="obj-a" focused>
                <div data-testid="content-a" style={{ width: 800, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-b">
              <SceneObject name="obj-b" focused>
                <div data-testid="content-b" style={{ width: 800, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-c">
              <SceneObject name={UNBREAKABLE_LONG_NAME} focused={farRightFocused}>
                <div data-testid="content-c" style={{ width: 20, height: 100 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
      const { rerender, getByTestId } = await render(mountJsx(true));
      await rerender(mountJsx(false));
      await waitForAnimationFrame();
      return measureScrollMetrics(getByTestId("scene").element() as HTMLElement);
    }

    const metricsOff = await build(false);
    await cleanup();
    const metricsOn = await build(true);
    await cleanup();

    expect(metricsOn).toEqual(metricsOff);
  });

  test("depth-deck layout: identical scroll metrics with debug on vs off", async () => {
    // Left/right focused columns (450px each) fit the 1280px viewport with
    // an in-between (depth-deck) unfocused column between them, plus a
    // fourth column (long unbreakable name) that starts focused (to freeze
    // its size) then unfocuses, parking just inside the viewport's right
    // edge with generous headroom for an unclipped label to overflow into.
    async function build(debug: boolean) {
      const mountJsx = (farRightFocused: boolean) => (
        <TestWrapper fullPage>
          <Scene duration={0} debug={debug}>
            <SceneColumn name="col-left">
              <SceneObject name="obj-left" focused>
                <div data-testid="content-left" style={{ width: 450, height: 200 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-middle">
              <SceneObject name="obj-middle" focused={false}>
                <div data-testid="content-middle" style={{ width: 300, height: 200 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-right">
              <SceneObject name="obj-right" focused>
                <div data-testid="content-right" style={{ width: 450, height: 200 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-far-right">
              <SceneObject name={UNBREAKABLE_LONG_NAME} focused={farRightFocused}>
                <div data-testid="content-far-right" style={{ width: 20, height: 200 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>
      );
      const { rerender, getByTestId } = await render(mountJsx(true));
      await rerender(mountJsx(false));
      await waitForAnimationFrame();
      const midCol = getByTestId("content-middle").element().closest("[data-ui-scene-column-anchor]") as HTMLElement;
      // Sanity-check the fixture actually exercises the depth-deck
      // classification this test claims to cover.
      expect(midCol.getAttribute("data-ui-scene-column-position")).toBe("in-between");
      return measureScrollMetrics(getByTestId("scene").element() as HTMLElement);
    }

    const metricsOff = await build(false);
    await cleanup();
    const metricsOn = await build(true);
    await cleanup();

    expect(metricsOn).toEqual(metricsOff);
  });
});

// ---------------------------------------------------------------------------
// F4 commit 2 feature (a): active-springs debug panel
// ---------------------------------------------------------------------------

describe("Scene debug — active springs panel", () => {
  test("shows a registered key with a live value while a real camera-pan transition is in flight", async () => {
    // Real (non-zero) duration, toggling which of two columns is focused —
    // triggers a real cameraX spring (see SceneViewport's stageLeft effect).
    const mountJsx = (leftFocused: boolean) => (
      <TestWrapper fullPage>
        <Scene debug>
          <SceneColumn name="col-left">
            <SceneObject name="obj-left" focused={leftFocused}>
              <div style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="col-right">
            <SceneObject name="obj-right" focused={!leftFocused}>
              <div style={{ width: 400, height: 200 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
    const { rerender, getByTestId } = await render(mountJsx(true));
    await wait(50);
    await rerender(mountJsx(false));

    const scene = getByTestId("scene").element();
    const cameraRow = scene.querySelector("[data-ui-scene-debug-spring='cameraX']");
    expect(cameraRow).not.toBeNull();
    const valueEl = cameraRow?.querySelector("[data-ui-scene-debug-spring-value]");
    const targetEl = cameraRow?.querySelector("[data-ui-scene-debug-spring-target]");
    const velocityEl = cameraRow?.querySelector("[data-ui-scene-debug-spring-velocity]");
    // A real animate() call registered a target — unlike the inertia/fling
    // case, this should never read the "—" placeholder.
    expect(valueEl?.textContent).toMatch(/^-?\d+\.\d$/);
    expect(targetEl?.textContent).toMatch(/^-?\d+\.\d$/);
    expect(velocityEl?.textContent).toMatch(/^-?\d+\.\d$/);

    await wait(1000); // let the spring settle before unmounting mid-flight
    await cleanup();
  });

  test("a spring entry disappears once its owning object unmounts (no key leak)", async () => {
    // Mirrors the fixture in "Scene debug overlay object-list staleness"
    // above — registerMotionValue's unregister cleanup (F4) must run on the
    // same unmount that test pins for the object list itself.
    const build = (showSecond: boolean) => (
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="first" focused>
              <div style={{ width: 100, height: 100 }} />
            </SceneObject>
            {showSecond && (
              <SceneObject name="second" focused={false}>
                <div style={{ width: 100, height: 100 }} />
              </SceneObject>
            )}
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );
    const { rerender, getByTestId } = await render(build(true));
    const scene = getByTestId("scene").element();
    await waitForAnimationFrame();
    // ui/t:21 anchor/object split: the object-level spring key registered
    // unconditionally (every SceneObject, regardless of sandwiched state)
    // is now `height:${name}` (the height channel), not the retired
    // `withinColumnTop:${name}` MotionValue.
    expect(scene.querySelector("[data-ui-scene-debug-spring='height:second']")).not.toBeNull();

    await rerender(build(false));
    await waitForAnimationFrame();
    expect(scene.querySelector("[data-ui-scene-debug-spring='height:second']")).toBeNull();
  });

  test("no springs section when nothing has registered (debug on, duration=0, no motion in flight)", async () => {
    // duration=0 never calls animate(), so nothing exercises the registration
    // effects' animate-branch — but registerMotionValue itself is
    // unconditional, so keys DO appear (at rest). This just pins that the
    // section renders without throwing and lists the always-registered keys.
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 200, height: 100 }] }],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );
    const scene = getByTestId("scene").element();
    await waitForAnimationFrame();
    const cameraRow = scene.querySelector("[data-ui-scene-debug-spring='cameraX']");
    expect(cameraRow).not.toBeNull();
    expect(cameraRow?.querySelector("[data-ui-scene-debug-spring-target]")?.textContent).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// F4 commit 2 feature (b): stage-bounds + stray-child debug visualization
// ---------------------------------------------------------------------------

describe("Scene debug — stage bounds outline", () => {
  test("appears when frozen/parked outer columns make the stage wider than the focused span", async () => {
    // Mirrors the "Camera stage-left centers focused region when outer
    // columns extend the stage" fixture (Phase 4 above): 900px outer
    // columns, previously focused to freeze their size, then unfocused —
    // the stage (2016px including gaps) is far wider than the 200px
    // focused span, but overflowsX stays false (native scroll doesn't
    // reflect it) — exactly the invisible-unless-you-look shape this
    // outline exists to surface. The 1656px scrollWidth this produces is
    // real, PRE-EXISTING content overflow (the frozen columns themselves,
    // clipped by overflow:hidden — see F4 commit 1's "PARKED" probe), not
    // something this outline adds — asserted below by comparing debug on
    // vs off for the identical layout, matching the commit-1 purity pins.
    async function build(debug: boolean) {
      const { rerender, getByTestId } = await render(
        <TestWrapper fullPage>
          <Scene duration={0} debug={debug}>
            <SceneColumn name="col-left">
              <SceneObject name="obj-left" focused>
                <div style={{ width: 900, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-focused">
              <SceneObject name="obj-focused" focused>
                <div style={{ width: 200, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-right">
              <SceneObject name="obj-right" focused>
                <div style={{ width: 900, height: 100 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );
      await rerender(
        <TestWrapper fullPage>
          <Scene duration={0} debug={debug}>
            <SceneColumn name="col-left">
              <SceneObject name="obj-left" focused={false}>
                <div style={{ width: 900, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-focused">
              <SceneObject name="obj-focused" focused>
                <div style={{ width: 200, height: 100 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-right">
              <SceneObject name="obj-right" focused={false}>
                <div style={{ width: 900, height: 100 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );
      // Pre-existing rect-measurement-family settle race (reproduces
      // identically with debug entirely absent — not a purity regression):
      // the size-freeze + stageLeft repositioning effects can need one more
      // frame to settle after rerender() resolves before scrollWidth reads
      // consistently. Matches this suite's established convention of a
      // settle wait after a rerender that changes frozen-size geometry.
      await waitForAnimationFrame();
      const scene = getByTestId("scene").element();
      return { scrollWidth: scene.scrollWidth, clientWidth: scene.clientWidth, outline: scene.querySelector("[data-ui-scene-debug-stage-bounds]") };
    }

    const off = await build(false);
    expect(off.outline).toBeNull();
    await cleanup();

    const on = await build(true);
    expect(on.outline).not.toBeNull();
    expect(on.outline?.textContent).toContain("focused 200px");
    expect(on.scrollWidth).toBe(off.scrollWidth);
    expect(on.clientWidth).toBe(off.clientWidth);
  });

  test("does not appear when the stage matches the focused span (no hidden content)", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 200, height: 100 }] }],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );
    const scene = getByTestId("scene").element();
    expect(scene.querySelector("[data-ui-scene-debug-stage-bounds]")).toBeNull();
  });
});

describe("Scene debug — stray child flags", () => {
  test("flags a stray direct child of Scene (neither SceneColumn nor SceneObject)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div style={{ width: 200, height: 100 }} />
            </SceneObject>
          </SceneColumn>
          <p data-testid="stray">a stray debug readout</p>
        </Scene>
      </TestWrapper>,
    );
    const scene = getByTestId("scene").element();
    const flag = scene.querySelector("[data-ui-scene-debug-stray-child='p']");
    expect(flag).not.toBeNull();
    expect(flag?.textContent).toContain("stray <p>");
    warnSpy.mockRestore();
  });

  test("does not flag a legitimate SceneColumn", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 200, height: 100 }] }],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );
    const scene = getByTestId("scene").element();
    expect(scene.querySelectorAll("[data-ui-scene-debug-stray-child]").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F4 commit 2 feature (d): paint-order badges
// ---------------------------------------------------------------------------

describe("Scene debug — paint-order badges", () => {
  test("column-level: an in-between column gets a badge with its depth-1 translateZ", async () => {
    // Same fixture shape as "Scene debug — stacking depth" above: left/right
    // focused, middle unfocused (in-between, depth 1 -> translateZ -100).
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "left", objects: [{ name: "left-obj", focused: true, width: 200, height: 200, testId: "left-content" }] },
          { name: "middle", objects: [{ name: "middle-obj", focused: false, width: 200, height: 200, testId: "middle-content" }] },
          { name: "right", objects: [{ name: "right-obj", focused: true, width: 200, height: 200, testId: "right-content" }] },
        ],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("left-content").element().closest("[data-testid='scene']") as HTMLElement;
    await waitForAnimationFrame();
    const badge = scene.querySelector("[data-ui-scene-debug-paint-badge='column:middle']");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("z:-100");

    // Focused columns are not deck cards — no badge for either.
    expect(scene.querySelector("[data-ui-scene-debug-paint-badge='column:left']")).toBeNull();
    expect(scene.querySelector("[data-ui-scene-debug-paint-badge='column:right']")).toBeNull();
  });

  test("within-column: an object sandwiched between two focused siblings gets a badge", async () => {
    const { getByTestId } = await render(
      buildScene(
        [
          {
            name: "col",
            objects: [
              { name: "obj-a", focused: true, width: 300, height: 200, testId: "content-a" },
              { name: "obj-b", focused: false, width: 300, height: 200, testId: "content-b" },
              { name: "obj-c", focused: true, width: 300, height: 200, testId: "content-c" },
            ],
          },
        ],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("content-a").element().closest("[data-testid='scene']") as HTMLElement;
    await waitForAnimationFrame();
    const badge = scene.querySelector("[data-ui-scene-debug-paint-badge='object:obj-b']");
    expect(badge).not.toBeNull();
    // ui/t:21 z-index paint-order channel amendment: object-level depth cards
    // no longer carry translateZ at all — the badge now reads the object's
    // discrete zIndex write (depth-1 sandwiched -> -1), not a translateZ
    // pixel value.
    expect(badge?.textContent).toBe("z:-1");

    // Focused objects are not deck cards.
    expect(scene.querySelector("[data-ui-scene-debug-paint-badge='object:obj-a']")).toBeNull();
    expect(scene.querySelector("[data-ui-scene-debug-paint-badge='object:obj-c']")).toBeNull();
  });

  test("no badges when nothing is in the depth deck", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 200, height: 100 }] }],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );
    const scene = getByTestId("scene").element();
    expect(scene.querySelectorAll("[data-ui-scene-debug-paint-badge]").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F4 commit 2 feature (c): geometry-store inspector
// ---------------------------------------------------------------------------

describe("Scene debug — geometry store inspector", () => {
  test("overlay lists each registered object's offsetTop/height, grouped by column", async () => {
    const { getByTestId } = await render(
      buildScene(
        [
          {
            name: "col",
            objects: [
              { name: "obj-a", focused: true, width: 300, height: 150, testId: "content-a" },
              { name: "obj-b", focused: false, width: 300, height: 80, testId: "content-b" },
            ],
          },
        ],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("content-a").element().closest("[data-testid='scene']") as HTMLElement;
    const overlay = scene.querySelector("[data-ui-scene-debug-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("Geometry store");

    const columnSection = scene.querySelector("[data-ui-scene-debug-geometry-column='col']");
    expect(columnSection).not.toBeNull();

    // obj-a is focused, so its offsetTop should be 0 (it's the visible
    // top of the content wrapper) and its height should match the 150px
    // content.
    const objA = scene.querySelector("[data-ui-scene-debug-geometry-object='obj-a']");
    expect(objA?.textContent).toContain("top=0");
    expect(objA?.textContent).toContain("h=150");

    // obj-b is unfocused (not a depth card here — nothing focused after
    // it), still registered and measured — the geometry store tracks every
    // registered object, not just focused ones.
    const objB = scene.querySelector("[data-ui-scene-debug-geometry-object='obj-b']");
    expect(objB).not.toBeNull();
    expect(objB?.textContent).toContain("h=80");
  });

  test("no geometry-store section when nothing is registered yet (e.g. no columns)", async () => {
    // A Scene with no children still renders (edge case) — no geometry
    // section should appear, and the overlay must not throw.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <></>
        </Scene>
      </TestWrapper>,
    );
    const scene = getByTestId("scene").element();
    expect(scene.querySelector("[data-ui-scene-debug-overlay]")).not.toBeNull();
    expect(scene.querySelectorAll("[data-ui-scene-debug-geometry-column]").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F4 commit 2 feature (e): live slowMo toggle
// ---------------------------------------------------------------------------

describe("Scene debug — live slowMo toggle", () => {
  test("checkbox reflects the slowMo prop and toggling changes the NEXT transition's spring physics", async () => {
    // Test-provided motion seam recorder (tests/utils/animation.ts) so the
    // real AnimationPlaybackControls Motion computes for each cameraX
    // animate() call is directly readable — .duration is Motion's own
    // computed spring settle time, a precise, non-flaky way to tell fast
    // (stiffness 300/damping 30) and slowMo (stiffness 30/damping 8) apart
    // without racing real wall-clock animation timing.
    const recorder = createMotionSeamRecorder();
    const mountJsx = (leftFocused: boolean) => (
      <TestWrapper fullPage>
        <MotionSeamContext.Provider value={recorder}>
          <Scene debug>
            <SceneColumn name="col-left">
              <SceneObject name="obj-left" focused={leftFocused}>
                <div style={{ width: 400, height: 200 }} />
              </SceneObject>
            </SceneColumn>
            <SceneColumn name="col-right">
              <SceneObject name="obj-right" focused={!leftFocused}>
                <div style={{ width: 400, height: 200 }} />
              </SceneObject>
            </SceneColumn>
          </Scene>
        </MotionSeamContext.Provider>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(mountJsx(true));
    const scene = getByTestId("scene").element();

    const checkbox = scene.querySelector("[data-ui-scene-debug-slowmo-toggle] input") as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false); // slowMo prop defaults to false

    // Real (fast) transition — record its computed duration.
    await wait(50);
    await rerender(mountJsx(false));
    await waitForAnimationFrame();
    const fastDuration = recorder.controls.get("cameraX")?.duration;
    expect(fastDuration).toBeGreaterThan(0);

    // Toggle slowMo on via the overlay checkbox — a real click, not a
    // synthetic prop change, matching how a developer would actually use it.
    checkbox.click();
    await waitForAnimationFrame();
    expect(checkbox.checked).toBe(true);

    // Let the fast transition fully settle before starting a new one — the
    // in-flight one from before the toggle is NOT retargeted (no code path
    // does that), only a transition STARTED after the toggle picks up the
    // new physics.
    await wait(1000);
    await rerender(mountJsx(true));
    await waitForAnimationFrame();
    const slowDuration = recorder.controls.get("cameraX")?.duration;
    expect(slowDuration).toBeGreaterThan(0);
    expect(slowDuration!).toBeGreaterThan(fastDuration! * 1.5);
  });

  test("does not affect layout/scroll metrics — pointer-events change is scoped to the overlay panel only", async () => {
    // The overlay panel itself becomes pointerEvents:"auto" (F4 feature e's
    // documented tradeoff) — but every OTHER debug element stays
    // pointerEvents:"none", and none of this touches scrollWidth/clientWidth
    // (the F4 commit-1 purity bar, unaffected by pointer-events either way).
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "object", focused: true, width: 200, height: 100 }] }],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );
    const scene = getByTestId("scene").element() as HTMLElement;
    const overlay = scene.querySelector("[data-ui-scene-debug-overlay]") as HTMLElement;
    expect(window.getComputedStyle(overlay).pointerEvents).toBe("auto");

    const outline = scene.querySelector("[data-ui-scene-debug-object-outline]") as HTMLElement;
    expect(window.getComputedStyle(outline).pointerEvents).toBe("none");

    expect(scene.scrollWidth).toBe(scene.clientWidth);
  });
});

// ---------------------------------------------------------------------------
// Phase 10a: Debug — remaining overlay features
// ---------------------------------------------------------------------------

describe("Scene debug — stacking depth", () => {
  test("overlay shows position classification for unfocused columns", async () => {
    // Three columns: left focused, middle unfocused (in-between), right focused.
    // The overlay should indicate the middle column's classification.
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "left", objects: [{ name: "left-obj", focused: true, width: 200, height: 200, testId: "left-content" }] },
          { name: "middle", objects: [{ name: "middle-obj", focused: false, width: 200, height: 200, testId: "middle-content" }] },
          { name: "right", objects: [{ name: "right-obj", focused: true, width: 200, height: 200, testId: "right-content" }] },
        ],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("left-content").element().closest("[data-testid='scene']") as HTMLElement;
    const overlay = scene.querySelector("[data-ui-scene-debug-overlay]");
    expect(overlay).not.toBeNull();
    // Overlay should list the middle column with its classification and depth.
    expect(overlay?.textContent).toContain("middle");
    expect(overlay?.textContent).toContain("in-between");
  });

  test("overlay shows depth index for in-between columns", async () => {
    // Three columns focused on left and right: middle is depth 1 (adjacent to right focused).
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "left", objects: [{ name: "left-obj", focused: true, width: 200, height: 200, testId: "left-content" }] },
          { name: "mid1", objects: [{ name: "mid1-obj", focused: false, width: 200, height: 200, testId: "mid1-content" }] },
          { name: "mid2", objects: [{ name: "mid2-obj", focused: false, width: 200, height: 200, testId: "mid2-content" }] },
          { name: "right", objects: [{ name: "right-obj", focused: true, width: 200, height: 200, testId: "right-content" }] },
        ],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("left-content").element().closest("[data-testid='scene']") as HTMLElement;
    const overlay = scene.querySelector("[data-ui-scene-debug-overlay]");
    expect(overlay).not.toBeNull();
    // Both in-between columns should appear with depth info.
    expect(overlay?.textContent).toContain("mid1");
    expect(overlay?.textContent).toContain("mid2");
    // The overlay should mention at least one depth number.
    expect(overlay?.textContent).toMatch(/depth\s*[12]/i);
  });

  test("overlay shows outer-left and outer-right classification", async () => {
    // Three columns: middle focused, left and right unfocused.
    const { getByTestId } = await render(
      buildScene(
        [
          { name: "outer-left-col", objects: [{ name: "left-obj", focused: false, width: 200, height: 200, testId: "left-content" }] },
          { name: "mid-col", objects: [{ name: "mid-obj", focused: true, width: 200, height: 200, testId: "mid-content" }] },
          { name: "outer-right-col", objects: [{ name: "right-obj", focused: false, width: 200, height: 200, testId: "right-content" }] },
        ],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("left-content").element().closest("[data-testid='scene']") as HTMLElement;
    const overlay = scene.querySelector("[data-ui-scene-debug-overlay]");
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("outer-left");
    expect(overlay?.textContent).toContain("outer-right");
  });
});

describe("Scene debug — offsetParent warning", () => {
  test("overlay warns when a SceneObject has a positioned ancestor between it and the scene", async () => {
    // Wrapping a SceneObject in a positioned div breaks relative positioning
    // (the column's offsetParent becomes the wrapper, not the scene stage).
    // The debug overlay should detect and warn about this.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          {/* Positioned wrapper breaks offsetParent chain */}
          <div data-testid="positioned-wrapper" style={{ position: "relative" }}>
            <SceneColumn name="col">
              <SceneObject name="wrapped-obj" focused>
                <div data-testid="content" style={{ width: 200, height: 200 }} />
              </SceneObject>
            </SceneColumn>
          </div>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("content").element().closest("[data-testid='scene']") as HTMLElement;
    const overlay = scene.querySelector("[data-ui-scene-debug-overlay]");
    expect(overlay).not.toBeNull();
    // The overlay should show a warning about the offsetParent issue.
    expect(overlay?.textContent).toMatch(/warn|offsetParent|positioned ancestor/i);
  });
});

describe("Scene debug — toggle", () => {
  test("enabling debug adds overlay; disabling removes all debug DOM", async () => {
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element();

    // Debug on: overlay should be present
    expect(scene.querySelector("[data-ui-scene-debug-overlay]")).not.toBeNull();

    // Disable debug
    await rerender(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Debug off: overlay removed and no debug outlines
    expect(scene.querySelector("[data-ui-scene-debug-overlay]")).toBeNull();
    const style = window.getComputedStyle(scene);
    // Outline should be gone or transparent when debug is off.
    const outline = style.outline + style.outlineColor;
    expect(outline).not.toMatch(/cyan|rgb\(0,\s*255,\s*255\)/);
  });
});

// ---------------------------------------------------------------------------
// Debug — remaining overlay features (spec: scene-debug.feature)
// ---------------------------------------------------------------------------

describe("Scene debug — stage outline", () => {
  test("Debug — stage has magenta outline", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement;
    expect(stage).not.toBeNull();
    const style = window.getComputedStyle(stage);
    // Debug mode adds a magenta outline to the stage.
    const outline = style.outline + style.outlineColor;
    expect(outline).toMatch(/magenta|rgb\(255,\s*0,\s*255\)/);
  });

  test("Debug — stage outline is absent when debug is off", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const stage = scene.querySelector("[data-ui-scene-stage]") as HTMLElement;
    const style = window.getComputedStyle(stage);
    const outline = style.outline + style.outlineColor;
    expect(outline).not.toMatch(/magenta|rgb\(255,\s*0,\s*255\)/);
  });
});

describe("Scene debug — SceneObject outlines", () => {
  test("Debug — focused objects have green outline with name", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "my-object", focused: true, width: 200, height: 200, testId: "content" }] }],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    // Focused object overlay should be present
    const focusedOverlay = scene.querySelector("[data-ui-scene-debug-object-outline='my-object']") as HTMLElement;
    expect(focusedOverlay).not.toBeNull();
    // Should have green color
    const style = window.getComputedStyle(focusedOverlay);
    const borderColor = style.borderColor + style.outlineColor + style.border;
    expect(borderColor).toMatch(/green|rgb\(0,\s*128,\s*0\)|rgb\(0,\s*255,\s*0\)|#0f0/i);
    // Should display the name
    expect(focusedOverlay.textContent).toContain("my-object");
  });

  test("Debug — unfocused objects have gray outline with name", async () => {
    const { getByTestId } = await render(
      buildScene(
        [{ name: "col", objects: [{ name: "unfocused-object", focused: false, width: 200, height: 200, testId: "content" }] }],
        { duration: 0, debug: true },
        { fullPage: true },
      ),
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const unfocusedOverlay = scene.querySelector("[data-ui-scene-debug-object-outline='unfocused-object']") as HTMLElement;
    expect(unfocusedOverlay).not.toBeNull();
    // Unfocused overlay should have gray color
    const style = window.getComputedStyle(unfocusedOverlay);
    const borderColor = style.borderColor + style.outlineColor + style.border;
    expect(borderColor).toMatch(/gray|grey|rgb\(1(28|58|88),/i);
    // Should display the name
    expect(unfocusedOverlay.textContent).toContain("unfocused-object");
  });

  test("Debug — SceneObject outlines are not present when debug is off", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="my-object" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const outlines = scene.querySelectorAll("[data-ui-scene-debug-object-outline]");
    expect(outlines.length).toBe(0);
  });

  test("Debug — object outline's rAF re-measure loop runs continuously while mounted, not gated on declarative animation activity (F6 item 1)", async () => {
    // Root cause (probe-confirmed on the dev app's Debug mode demo): the
    // outline's rAF re-measure loop used to be gated on an `animatingRef`
    // counter fed only by onAnimationStart/onLayoutAnimationStart callbacks
    // wired to DECLARATIVE `animate`-prop transitions. A within-column
    // swap's `top` offset (topOffsetMV) is driven entirely by the S3+
    // imperative motion pipeline (`animate(topOffsetMV, ...)`, no
    // onAnimationStart-wired prop) — nothing ever incremented the counter,
    // so the outline froze at its pre-swap position for the whole
    // transition and never caught up even after the real object settled
    // (probe measured a max delta of 72px, persisting the entire ~330ms
    // transition on the real dev app).
    //
    // This asserts the fix's actual, direct claim — the rAF loop runs
    // unconditionally while `debug` is enabled, not "does some declarative
    // transition happen to also cover it" — rather than reproducing a
    // specific transition. That's deliberate: probe-verified during
    // development that a rect-comparison test built around a real
    // topOffsetMV-driven swap could NOT reliably discriminate fixed from
    // unfixed code in this test harness, because a same-column swap's
    // `layout` FLIP prop (still correctly wired to onLayoutAnimationStart)
    // tends to also fire for incidental sub-pixel shifts during the swap,
    // masking the topOffsetMV-specific gap even on the pre-fix code. The
    // rAF-call-rate signature below is immune to that: it holds the scene
    // completely static (nothing ever transitions, declaratively or
    // imperatively) after the initial settle, so `animatingRef` genuinely
    // never leaves 0 — any rAF loop still firing every frame in that
    // window must be a continuous one, not one gated on real animation
    // activity. Counts window.requestAnimationFrame call *rate* (not
    // component-internal state) — a debug-only signal, no production code
    // instrumentation needed.
    let rafCount = 0;
    const originalRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCount++;
      return originalRaf(cb);
    };

    try {
      await render(
        <TestWrapper fullPage>
          <Scene duration={0} debug>
            <SceneColumn name="col">
              <SceneObject name="obj-a" focused>
                <div data-testid="content-a" style={{ width: 300, height: 200 }}>A</div>
              </SceneObject>
            </SceneColumn>
          </Scene>
        </TestWrapper>,
      );

      // Let mount-time renders settle before establishing a baseline.
      await waitForAnimationFrame();
      await waitForAnimationFrame();
      await waitForAnimationFrame();

      rafCount = 0;
      const framesToSample = 5;
      for (let i = 0; i < framesToSample; i++) {
        await waitForAnimationFrame();
      }

      // this test's own waitForAnimationFrame() calls contribute exactly
      // `framesToSample` — anything beyond that came from continuous debug
      // loops (ActiveSpringsSection, PaintOrderBadges, and — with the fix —
      // SceneObjectOutlines/StageBoundsOutline/StrayChildFlags).
      const continuousLoopCallsPerFrame = rafCount / framesToSample - 1;

      // Before the fix: only ActiveSpringsSection + PaintOrderBadges run
      // continuously (2). After: + SceneObjectOutlines + StageBoundsOutline
      // + StrayChildFlags (5 total) — a clear, non-adjacent threshold.
      expect(continuousLoopCallsPerFrame).toBeGreaterThanOrEqual(5);
    } finally {
      window.requestAnimationFrame = originalRaf;
    }
  });
});

describe("Scene debug — overlay computed bounds", () => {
  test("Debug — overlay shows computed bounds per object", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="my-object" focused style={{ width: 300, height: 200 }}>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const overlay = scene.querySelector("[data-ui-scene-debug-overlay]");
    expect(overlay).not.toBeNull();
    // Overlay should show dimensions (width × height) for the object
    expect(overlay?.textContent).toMatch(/\d+\s*[×x]\s*\d+/);
  });
});

describe("Scene debug — Camera state in overlay", () => {
  test("Debug — overlay shows Camera target bounds and viewport dimensions", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="object" focused style={{ width: 300, height: 200 }}>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const overlay = scene.querySelector("[data-ui-scene-debug-overlay]");
    expect(overlay).not.toBeNull();
    // Should show a "Camera" or "viewport" section
    expect(overlay?.textContent).toMatch(/camera|viewport/i);
    // Should contain numbers that represent viewport dimensions
    expect(overlay?.textContent).toMatch(/\d+/);
  });

  test("Debug — overlay has a section labeled for Camera", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="object" focused>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const cameraSection = scene.querySelector("[data-ui-scene-debug-camera]");
    expect(cameraSection).not.toBeNull();
  });
});

describe("Scene debug — per-column scroll state in overlay", () => {
  test("Debug — overlay shows per-column vertical scroll state", async () => {
    // A tall SceneObject that makes its column scrollable
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="scrollable-col">
            <SceneObject name="tall-object" focused style={{ width: 300, height: 2000 }}>
              <div data-testid="content" />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const overlay = scene.querySelector("[data-ui-scene-debug-overlay]");
    expect(overlay).not.toBeNull();
    // The overlay should show scroll state for the scrollable column
    const scrollSection = scene.querySelector("[data-ui-scene-debug-scroll-column='scrollable-col']");
    expect(scrollSection).not.toBeNull();
  });
});

describe("Scene debug overlay object-list staleness (S6 gate fix)", () => {
  test("overlay object list reflects a mount/unmount in the SAME commit, with no other re-render trigger", async () => {
    // Single column, single always-focused object — deliberately avoids the
    // S6 registry correction re-render (a SECOND column classified
    // outer-left/right would trigger Scene's own correction effect, masking
    // this component's own staleness). The overlay's object-list query
    // (queryDebugObjects, during render) reads the DOM as of the END of the
    // PREVIOUS commit — unlike SceneObjectOutlines (which self-corrects via
    // its own layout-effect-triggered pre-paint re-render), the overlay had
    // no correction mechanism, so nothing else in this minimal tree ever
    // gives it a chance to see the mutation.
    const build = (showSecond: boolean) => (
      <TestWrapper fullPage>
        <Scene duration={0} debug>
          <SceneColumn name="col">
            <SceneObject name="first" focused>
              <div data-testid="first-content" style={{ width: 100, height: 100 }} />
            </SceneObject>
            {showSecond && (
              <SceneObject name="second" focused={false}>
                <div data-testid="second-content" style={{ width: 100, height: 100 }} />
              </SceneObject>
            )}
          </SceneColumn>
        </Scene>
      </TestWrapper>
    );

    const { rerender, getByTestId } = await render(build(false));
    const scene = getByTestId("scene").element();

    let overlay = scene.querySelector("[data-ui-scene-debug-overlay]");
    expect(overlay?.textContent).not.toContain("second");

    // Mount — no waitForAnimationFrame()/extra tick between this and the
    // assertion, matching the bug's own condition ("no other re-render
    // trigger"): if this needs an extra frame to settle, the bug is still
    // present in a milder form.
    await rerender(build(true));
    overlay = scene.querySelector("[data-ui-scene-debug-overlay]");
    expect(overlay?.textContent).toContain("second");

    // Unmount.
    await rerender(build(false));
    overlay = scene.querySelector("[data-ui-scene-debug-overlay]");
    expect(overlay?.textContent).not.toContain("second");
  });
});
