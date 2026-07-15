/**
 * Touch pan + inertia tests (S3 commit 2).
 *
 * Covers the touch scenarios in specs/scene-scroll.feature: 1:1 finger drag
 * (C3), release inertia + boundary clamp (C4, defeat-checked at C5), focus
 * change during an active fling (C6), touch-action CSS + thumb hit target
 * (C7), and the scrollbar thumb's own touch-drag (C11 — its first test
 * coverage in this suite; the thumb's drag logic predates S3).
 *
 * PointerEvents are dispatched directly via element.dispatchEvent() — this
 * repo runs vitest-browser tests in real Chromium (not jsdom), so
 * synthetically-constructed PointerEvents with pointerType/pointerId flow
 * through the real setPointerCapture()/pointer-capture machinery exactly as
 * genuine input would (probe-confirmed at S3 commit-2 pickup).
 */

import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneColumn, SceneObject } from "../src";
import { TestWrapper } from "./test-wrapper";
import { wait, waitForAnimationFrame } from "./utils/animation";

/** Dispatches a synthetic touch PointerEvent on `el`. */
function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  clientY: number,
  pointerId = 1,
) {
  el.dispatchEvent(
    new PointerEvent(type, {
      pointerId,
      pointerType: "touch",
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
    }),
  );
}

// ---------------------------------------------------------------------------
// C3: 1:1 finger drag
// ---------------------------------------------------------------------------

describe("Scene touch — 1:1 finger drag", () => {
  test("dragging the finger up tracks the scroll offset 1:1 (instant mode)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const rect = contentWrapper.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + 50;

    firePointer(contentWrapper, "pointerdown", startX, startY);
    await waitForAnimationFrame();

    // Finger moves up 150px — content should track 1:1 (offset increases by
    // exactly 150, per the "content follows the finger" convention).
    firePointer(contentWrapper, "pointermove", startX, startY - 150);
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("150");
    expect(parseFloat(contentWrapper.style.top || "0")).toBe(-150);

    // Continue dragging further up — still 1:1 from the ORIGINAL start point.
    firePointer(contentWrapper, "pointermove", startX, startY - 300);
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("300");

    firePointer(contentWrapper, "pointerup", startX, startY - 300);
    await waitForAnimationFrame();
    // Release settles (no inertia in instant mode) at the clamped release position.
    expect(column.getAttribute("data-scroll-offset")).toBe("300");
  });

  test("drag is clamped to [0, maxScroll]", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 1000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const maxScroll = parseFloat(column.getAttribute("data-max-scroll") ?? "0");
    expect(maxScroll).toBeGreaterThan(0);

    const rect = contentWrapper.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + 50;

    firePointer(contentWrapper, "pointerdown", startX, startY);
    await waitForAnimationFrame();
    // Drag WAY past maxScroll — should clamp, not overshoot.
    firePointer(contentWrapper, "pointermove", startX, startY - (maxScroll + 5000));
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe(String(maxScroll));

    // Drag back past 0 — should clamp at 0, not go negative.
    firePointer(contentWrapper, "pointermove", startX, startY + 5000);
    await waitForAnimationFrame();
    expect(column.getAttribute("data-scroll-offset")).toBe("0");

    firePointer(contentWrapper, "pointerup", startX, startY + 5000);
  });

  test("mouse pointerType does not trigger content drag (native selection preserved)", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const rect = contentWrapper.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + 50;

    contentWrapper.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: startX,
        clientY: startY,
        bubbles: true,
        cancelable: true,
      }),
    );
    contentWrapper.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: startX,
        clientY: startY - 150,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForAnimationFrame();

    // A mouse drag must NOT move the scroll offset — mouse stays native.
    expect(column.getAttribute("data-scroll-offset")).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// C4/C5: Release inertia + boundary clamp (real mode — inertia has no
// instant-mode equivalent, forecast-gate plan §2)
// ---------------------------------------------------------------------------

describe("Scene touch — release inertia", () => {
  test("releasing with velocity continues scrolling past the release position, then settles clamped at maxScroll", async () => {
    const { getByTestId, rerender } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    // Switch to real (non-instant) mode for the drag/release — inertia has
    // no instant-mode equivalent (forecast-gate plan §2), and the initial
    // duration=0 render above only established layout instantly.
    await rerender(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const maxScroll = parseFloat(column.getAttribute("data-max-scroll") ?? "0");
    const rect = contentWrapper.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + 50;

    firePointer(contentWrapper, "pointerdown", startX, startY);
    await waitForAnimationFrame();
    // A fast upward flick: several pointermoves in quick succession to build
    // real velocity (useVelocity samples frame-spaced .set() calls).
    for (let i = 1; i <= 5; i++) {
      firePointer(contentWrapper, "pointermove", startX, startY - i * 40);
      await new Promise((r) => requestAnimationFrame(r));
    }
    const releaseY = startY - 5 * 40;
    firePointer(contentWrapper, "pointerup", startX, releaseY);
    const releaseOffset = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    expect(releaseOffset).toBeGreaterThan(0);

    // Shortly after release, inertia should have carried it further —
    // proves the fling continues past the release position rather than
    // stopping dead (this is C5's defeat-check target: severing the
    // animate() call collapses this to "still at releaseOffset").
    await wait(150);
    const midFlight = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    expect(midFlight).toBeGreaterThan(releaseOffset);

    // Settle: after the friction phase overshoots (a legitimate transient —
    // inertia's boundary catch only starts pulling back once it detects
    // out-of-bounds, so a moment mid-decay can exceed maxScroll; that's the
    // "clamped rubber-band" physics, not a bug), the boundary spring must
    // converge the FINAL rest value back to maxScroll.
    await wait(2500);
    const settled = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    expect(Math.abs(settled - maxScroll)).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// C6: Focus change during an active fling
// ---------------------------------------------------------------------------

describe("Scene touch — focus change during active scroll", () => {
  test("a within-column swap while a fling is in flight cleanly interrupts it and resets the new object's scroll", async () => {
    const { rerender, getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused>
              <div data-testid="content-a" style={{ width: 400, height: 2000 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused={false}>
              <div data-testid="content-b" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await waitForAnimationFrame();

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const contentWrapper = column.querySelector("[data-column-content]") as HTMLElement;
    const rect = contentWrapper.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + 50;

    firePointer(contentWrapper, "pointerdown", startX, startY);
    await waitForAnimationFrame();
    for (let i = 1; i <= 5; i++) {
      firePointer(contentWrapper, "pointermove", startX, startY - i * 40);
      await new Promise((r) => requestAnimationFrame(r));
    }
    firePointer(contentWrapper, "pointerup", startX, startY - 5 * 40);

    // Fling is now coasting. Before it settles, swap focus within the column.
    await wait(30);
    await rerender(
      <TestWrapper fullPage>
        <Scene>
          <SceneColumn name="col">
            <SceneObject name="obj-a" focused={false}>
              <div data-testid="content-a" style={{ width: 400, height: 2000 }} />
            </SceneObject>
            <SceneObject name="obj-b" focused>
              <div data-testid="content-b" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    // Give the swap-reset spring time to fully settle. Diagnostic-confirmed
    // (a clean 500->0 swap with no prior velocity converges to exactly 0 by
    // ~1800ms with these spring constants): this scenario's spring legitimately
    // inherits SOME residual velocity from the just-interrupted fling
    // (animateMotionValue defaults a retargeted animation's initial velocity
    // to the MotionValue's current velocity unless overridden — the same
    // "spring chase" mechanism that makes wheel/keyboard chase feel
    // continuous), so it's allowed a bit longer than the velocity-free
    // baseline. If the old fling were NOT cleanly interrupted (still
    // independently driving scrollY), this would never converge at all —
    // that's the property this test proves.
    await wait(2500);
    const settledOffset = parseFloat(column.getAttribute("data-scroll-offset") ?? "-1");
    expect(settledOffset).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// C7: touch-action CSS + thumb hit target
// ---------------------------------------------------------------------------

describe("Scene touch — touch-action CSS and thumb hit target", () => {
  test("the Camera viewport allows horizontal pan + pinch-zoom but not vertical pan", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 300 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    expect(getComputedStyle(scene).touchAction).toBe("pan-x pinch-zoom");
  });

  test("the scrollbar thumb hit target is touch-action:none and at least 24px wide", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement;
    expect(thumb).not.toBeNull();
    expect(getComputedStyle(thumb).touchAction).toBe("none");
    const width = thumb.getBoundingClientRect().width;
    expect(width).toBeGreaterThanOrEqual(24);
  });
});

// ---------------------------------------------------------------------------
// C11: Scrollbar thumb touch-drag (first test coverage — pre-existing logic)
// ---------------------------------------------------------------------------

describe("Scene touch — scrollbar thumb drag", () => {
  test("dragging the thumb with a finger scrolls the column to match the dragged position", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="col">
            <SceneObject name="panel" focused>
              <div data-testid="content" style={{ width: 400, height: 2000 }} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    const column = scene.querySelector("[data-column]") as HTMLElement;
    const thumb = scene.querySelector("[role='scrollbar']") as HTMLElement;
    const maxScroll = parseFloat(column.getAttribute("data-max-scroll") ?? "0");
    expect(maxScroll).toBeGreaterThan(0);

    const thumbRect = thumb.getBoundingClientRect();
    const startX = thumbRect.left + thumbRect.width / 2;
    const startY = thumbRect.top + thumbRect.height / 2;

    // pointerId 1: synthetic PointerEvent dispatch only satisfies Chromium's
    // setPointerCapture "active pointer" check for id 1 (aliases the
    // primary mouse pointer) — any other id throws NotFoundError (probe-
    // confirmed; a test-environment quirk, not a production concern, since
    // real touch input always has a genuinely active pointer session).
    firePointer(thumb, "pointerdown", startX, startY, 1);
    await waitForAnimationFrame();
    // Drag the thumb down 100px — should scroll the column DOWN (thumb
    // position correlates directly with scroll offset, unlike content drag).
    firePointer(thumb, "pointermove", startX, startY + 100, 1);
    await waitForAnimationFrame();

    const offset = parseFloat(column.getAttribute("data-scroll-offset") ?? "0");
    expect(offset).toBeGreaterThan(0);
    expect(thumb.getAttribute("aria-valuenow")).toBe(String(offset));

    firePointer(thumb, "pointerup", startX, startY + 100, 1);
  });
});
