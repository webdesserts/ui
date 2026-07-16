/**
 * Pure/DOM-light unit tests for the S5 input controller
 * (src/components/scene/inputController.ts). DOM-integration pins for the
 * same behaviors (routed through a real rendered Scene) live in
 * tests/scene.test.tsx alongside the existing wheel/keyboard describe blocks.
 */
import { describe, test, expect } from "vitest";
import {
  normalizeWheelDelta,
  decideWheelTargetColumn,
  interiorCanConsume,
  isEditableElement,
  isInteractiveElement,
  mapScrollKeyToCommand,
  selectAnchorObject,
  isAtScrollEnd,
  END_PIN_THRESHOLD_PX,
  findIntraObjectAnchorCandidates,
  selectIntraObjectAnchorIndex,
  findDeepestIntraObjectAnchor,
  findScrollToTarget,
  computeNearestEdgeScrollOffset,
  classifyTouchGestureDirection,
  shouldPreventTouchMove,
  TOUCH_DIRECTION_SLOP_PX,
  computeReleaseVelocity,
  MAX_FLING_VELOCITY,
  TOUCH_VELOCITY_WINDOW_MS,
  TOUCH_VELOCITY_STALE_MS,
  type AnchorCandidate,
  type AnchorGeometry,
  type VelocitySample,
} from "../src/components/scene/inputController";

function makeWheelEvent(init: Partial<WheelEventInit> = {}): WheelEvent {
  return new WheelEvent("wheel", { deltaY: 10, deltaMode: 0, ...init });
}

// ---------------------------------------------------------------------------
// normalizeWheelDelta
// ---------------------------------------------------------------------------

describe("normalizeWheelDelta", () => {
  test("ctrlKey (pinch-zoom) returns null — never routed, never scaled", () => {
    const e = makeWheelEvent({ deltaY: 50, ctrlKey: true });
    expect(normalizeWheelDelta(e, 800)).toBeNull();
  });

  test("DOM_DELTA_PIXEL (0) passes deltaY through unscaled", () => {
    const e = makeWheelEvent({ deltaY: 37, deltaMode: 0 });
    expect(normalizeWheelDelta(e, 800)).toBe(37);
  });

  test("DOM_DELTA_LINE (1) scales deltaY by 16", () => {
    const e = makeWheelEvent({ deltaY: 3, deltaMode: 1 });
    expect(normalizeWheelDelta(e, 800)).toBe(48);
  });

  test("DOM_DELTA_PAGE (2) scales deltaY by the viewport height", () => {
    const e = makeWheelEvent({ deltaY: 2, deltaMode: 2 });
    expect(normalizeWheelDelta(e, 800)).toBe(1600);
  });
});

// ---------------------------------------------------------------------------
// decideWheelTargetColumn
// ---------------------------------------------------------------------------

describe("decideWheelTargetColumn", () => {
  function makeViewport(columnsHtml: string): HTMLElement {
    const viewport = document.createElement("div");
    viewport.innerHTML = columnsHtml;
    document.body.appendChild(viewport);
    return viewport;
  }

  test("A10 fallback: exactly one scrollable focused column anywhere wins unconditionally, regardless of cursor position", () => {
    const viewport = makeViewport(`
      <div data-column="a" data-column-focused="true" data-max-scroll="100"></div>
      <div data-column="b" data-column-focused="true"></div>
    `);
    try {
      // Cursor position far outside either column — the fallback shouldn't
      // even need to hit-test since there's exactly one candidate.
      const result = decideWheelTargetColumn(viewport, -9999, -9999);
      expect(result).toBe(viewport.querySelector("[data-column='a']"));
    } finally {
      viewport.remove();
    }
  });

  test("multiple scrollable focused columns: falls back to hit-testing the element under the cursor", () => {
    const a = document.createElement("div");
    a.setAttribute("data-column", "a");
    a.setAttribute("data-column-focused", "true");
    a.setAttribute("data-max-scroll", "100");
    Object.assign(a.style, { position: "fixed", left: "0px", top: "0px", width: "50px", height: "50px" });

    const b = document.createElement("div");
    b.setAttribute("data-column", "b");
    b.setAttribute("data-column-focused", "true");
    b.setAttribute("data-max-scroll", "100");
    Object.assign(b.style, { position: "fixed", left: "200px", top: "0px", width: "50px", height: "50px" });

    const viewport = document.createElement("div");
    viewport.appendChild(a);
    viewport.appendChild(b);
    document.body.appendChild(viewport);

    try {
      // Cursor over column b's rect.
      const result = decideWheelTargetColumn(viewport, 210, 10);
      expect(result).toBe(b);
    } finally {
      viewport.remove();
    }
  });

  test("zero scrollable focused columns: returns null even if something is under the cursor", () => {
    const notScrollable = document.createElement("div");
    notScrollable.setAttribute("data-column", "a");
    notScrollable.setAttribute("data-column-focused", "true");
    Object.assign(notScrollable.style, { position: "fixed", left: "0px", top: "0px", width: "50px", height: "50px" });

    const viewport = document.createElement("div");
    viewport.appendChild(notScrollable);
    document.body.appendChild(viewport);

    try {
      const result = decideWheelTargetColumn(viewport, 10, 10);
      expect(result).toBeNull();
    } finally {
      viewport.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// interiorCanConsume (F8a)
// ---------------------------------------------------------------------------

describe("interiorCanConsume", () => {
  function makeBoundary(): HTMLElement {
    const boundary = document.createElement("div");
    boundary.setAttribute("data-column", "test");
    document.body.appendChild(boundary);
    return boundary;
  }

  /**
   * A real overflow-y:auto scroll container with genuine overflow (a filler
   * child taller than the container itself), appended under `parent`.
   */
  function makeScrollContainer(
    parent: Element,
    opts: { overscrollBehaviorY?: string } = {},
  ): HTMLElement {
    const container = document.createElement("div");
    container.style.height = "100px";
    container.style.overflowY = "auto";
    if (opts.overscrollBehaviorY) {
      container.style.overscrollBehaviorY = opts.overscrollBehaviorY;
    }
    const filler = document.createElement("div");
    filler.style.height = "300px";
    container.appendChild(filler);
    parent.appendChild(container);
    return container;
  }

  test("consumable mid-scroll: a real overflow-y:auto container that can still move consumes the delta", () => {
    const boundary = makeBoundary();
    const container = makeScrollContainer(boundary);
    container.scrollTop = 50; // maxScroll is 300-100=200 — neither edge
    try {
      expect(interiorCanConsume(container, boundary, "y", 10)).toBe(true);
      expect(interiorCanConsume(container, boundary, "y", -10)).toBe(true);
    } finally {
      boundary.remove();
    }
  });

  test("at the bottom edge with overscroll-behavior-y: auto (default) declines — nothing further to chain to here", () => {
    const boundary = makeBoundary();
    const container = makeScrollContainer(boundary);
    container.scrollTop = container.scrollHeight - container.clientHeight; // bottom edge
    try {
      expect(interiorCanConsume(container, boundary, "y", 10)).toBe(false);
    } finally {
      boundary.remove();
    }
  });

  test("fractional scrollTop settling ~0.5px short of the integer max (subpixel/non-integer devicePixelRatio rounding, MDN-documented) still registers as at-edge — declines and chains outward instead of dead-stopping wheel input", () => {
    const boundary = makeBoundary();
    const container = makeScrollContainer(boundary); // real overflow-y:auto, scrollHeight=300 clientHeight=100 -> maxScrollTop=200
    // Stub scrollTop to the exact fractional value rather than relying on a
    // real browser's actual clamping to reproduce a specific subpixel
    // shortfall deterministically (precedent: scene.test.tsx:2973's
    // clientHeight stub).
    Object.defineProperty(container, "scrollTop", { value: 199.5, configurable: true });
    try {
      expect(interiorCanConsume(container, boundary, "y", 10)).toBe(false);
    } finally {
      boundary.remove();
    }
  });

  test("at the bottom edge with overscroll-behavior-y: contain dead-stops — still consumes so Scene doesn't also react", () => {
    const boundary = makeBoundary();
    const container = makeScrollContainer(boundary, { overscrollBehaviorY: "contain" });
    container.scrollTop = container.scrollHeight - container.clientHeight; // bottom edge
    try {
      expect(interiorCanConsume(container, boundary, "y", 10)).toBe(true);
    } finally {
      boundary.remove();
    }
  });

  test("no scroll container in the path declines — including a [data-column-content]-alike wrapper carrying no overflow CSS (defensive: today's production wrapper never matches by attribute alone)", () => {
    const boundary = makeBoundary();
    const contentWrapperAlike = document.createElement("div");
    contentWrapperAlike.setAttribute("data-column-content", "");
    // No overflow CSS set — mirrors production ([data-column-content] itself
    // carries no overflow declaration today) but give it real overflow
    // (scrollHeight > clientHeight) so this proves overflow-y is the actual
    // gate, not an incidental size coincidence.
    contentWrapperAlike.style.height = "100px";
    boundary.appendChild(contentWrapperAlike);
    const tall = document.createElement("div");
    tall.style.height = "300px";
    contentWrapperAlike.appendChild(tall);
    try {
      expect(interiorCanConsume(tall, boundary, "y", 10)).toBe(false);
    } finally {
      boundary.remove();
    }
  });

  test("nested islands: an inner container at its own edge (auto) declines, and the walk continues outward to find the consumable outer one", () => {
    const boundary = makeBoundary();
    const outer = document.createElement("div");
    outer.style.height = "300px";
    outer.style.overflowY = "auto";
    boundary.appendChild(outer);

    const spacer = document.createElement("div");
    spacer.style.height = "1000px"; // ensures outer itself overflows
    outer.appendChild(spacer);

    const inner = document.createElement("div");
    inner.style.height = "100px";
    inner.style.overflowY = "auto";
    spacer.appendChild(inner); // nested inside outer's own overflowing content

    const innerFiller = document.createElement("div");
    innerFiller.style.height = "300px";
    inner.appendChild(innerFiller);

    outer.scrollTop = 50; // mid-scroll — outer can still move either direction
    inner.scrollTop = 0; // inner is at its own top edge

    try {
      // Scrolling up: inner is at its top edge and declines (default auto),
      // so the walk continues outward and finds the outer container, which
      // can still move.
      expect(interiorCanConsume(inner, boundary, "y", -10)).toBe(true);
    } finally {
      boundary.remove();
    }
  });

  test("target IS the column boundary: declines immediately, nothing to walk", () => {
    const boundary = makeBoundary();
    try {
      expect(interiorCanConsume(boundary, boundary, "y", 10)).toBe(false);
    } finally {
      boundary.remove();
    }
  });

  test("zero delta always declines, even over a mid-scroll container", () => {
    const boundary = makeBoundary();
    const container = makeScrollContainer(boundary);
    container.scrollTop = 50;
    try {
      expect(interiorCanConsume(container, boundary, "y", 0)).toBe(false);
    } finally {
      boundary.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// isEditableElement / isInteractiveElement
// ---------------------------------------------------------------------------

describe("isEditableElement", () => {
  test.each(["INPUT", "TEXTAREA", "SELECT"])("%s is editable", (tag) => {
    const el = document.createElement(tag.toLowerCase());
    expect(isEditableElement(el)).toBe(true);
  });

  test("a plain div is not editable", () => {
    expect(isEditableElement(document.createElement("div"))).toBe(false);
  });

  test("contentEditable element is editable", () => {
    const el = document.createElement("div");
    el.contentEditable = "true";
    document.body.appendChild(el);
    try {
      expect(isEditableElement(el)).toBe(true);
    } finally {
      el.remove();
    }
  });
});

describe("isInteractiveElement", () => {
  test("a button is interactive", () => {
    expect(isInteractiveElement(document.createElement("button"))).toBe(true);
  });

  test("an anchor with href is interactive", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "#");
    expect(isInteractiveElement(a)).toBe(true);
  });

  test("an anchor WITHOUT href is not interactive", () => {
    expect(isInteractiveElement(document.createElement("a"))).toBe(false);
  });

  test.each(["button", "slider", "tab", "checkbox"])("role=%s is interactive", (role) => {
    const el = document.createElement("div");
    el.setAttribute("role", role);
    expect(isInteractiveElement(el)).toBe(true);
  });

  test('role="region" (DELTA-1) does NOT exempt on its own', () => {
    const el = document.createElement("div");
    el.setAttribute("role", "region");
    expect(isInteractiveElement(el)).toBe(false);
  });

  test('role="scrollbar" (DELTA-1) does NOT exempt — the thumb owns its own keyboard path', () => {
    const el = document.createElement("div");
    el.setAttribute("role", "scrollbar");
    expect(isInteractiveElement(el)).toBe(false);
  });

  test("a generic element with a non-negative tabindex is interactive", () => {
    const el = document.createElement("div");
    el.setAttribute("tabindex", "0");
    expect(isInteractiveElement(el)).toBe(true);
  });

  test("a generic element with tabindex=-1 is NOT interactive", () => {
    const el = document.createElement("div");
    el.setAttribute("tabindex", "-1");
    expect(isInteractiveElement(el)).toBe(false);
  });

  test("DELTA-1: an element bearing [data-column-content] with tabindex=0 is NOT interactive (the region wrapper itself)", () => {
    const el = document.createElement("div");
    el.setAttribute("data-column-content", "");
    el.setAttribute("role", "region");
    el.setAttribute("tabindex", "0");
    expect(isInteractiveElement(el)).toBe(false);
  });

  test("fix round: a bare tabindex=0 element NESTED inside [data-column-content] (a consumer widget, not the wrapper itself) IS interactive", () => {
    // The content-wrapper exemption is a SELF-ONLY check — every consumer's
    // actual content lives inside [data-column-content] by construction, so
    // an ancestor-inclusive closest() check here would wrongly exempt every
    // nested focusable widget (a roving-tabindex list item, a focusable
    // message bubble) from the generic tabindex rule too, hijacking its own
    // arrow/Space keys for column scroll.
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-column-content", "");
    const widget = document.createElement("div");
    widget.setAttribute("tabindex", "0");
    wrapper.appendChild(widget);
    document.body.appendChild(wrapper);
    try {
      expect(isInteractiveElement(widget)).toBe(true);
    } finally {
      wrapper.remove();
    }
  });

  test("DELTA-1: an element NESTED under [data-scrollbar] with tabindex=0 is NOT interactive (the scrollbar thumb)", () => {
    const track = document.createElement("div");
    track.setAttribute("data-scrollbar", "");
    const thumb = document.createElement("div");
    thumb.setAttribute("role", "scrollbar");
    thumb.setAttribute("tabindex", "0");
    track.appendChild(thumb);
    document.body.appendChild(track);
    try {
      expect(isInteractiveElement(thumb)).toBe(false);
    } finally {
      track.remove();
    }
  });

  test("editable elements are interactive (isInteractiveElement composes isEditableElement)", () => {
    expect(isInteractiveElement(document.createElement("textarea"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mapScrollKeyToCommand
// ---------------------------------------------------------------------------

describe("mapScrollKeyToCommand", () => {
  test("ArrowDown -> scrollBy +40", () => {
    expect(mapScrollKeyToCommand("ArrowDown", false, 800)).toEqual({ type: "scrollBy", delta: 40 });
  });

  test("ArrowUp -> scrollBy -40", () => {
    expect(mapScrollKeyToCommand("ArrowUp", false, 800)).toEqual({ type: "scrollBy", delta: -40 });
  });

  test("PageDown -> page +pageSize", () => {
    expect(mapScrollKeyToCommand("PageDown", false, 800)).toEqual({ type: "page", delta: 800 });
  });

  test("PageUp -> page -pageSize", () => {
    expect(mapScrollKeyToCommand("PageUp", false, 800)).toEqual({ type: "page", delta: -800 });
  });

  test("Space -> page +pageSize", () => {
    expect(mapScrollKeyToCommand(" ", false, 800)).toEqual({ type: "page", delta: 800 });
  });

  test("Shift+Space -> page -pageSize (reverse)", () => {
    expect(mapScrollKeyToCommand(" ", true, 800)).toEqual({ type: "page", delta: -800 });
  });

  test("Home -> toTop", () => {
    expect(mapScrollKeyToCommand("Home", false, 800)).toEqual({ type: "toTop" });
  });

  test("End -> toBottom", () => {
    expect(mapScrollKeyToCommand("End", false, 800)).toEqual({ type: "toBottom" });
  });

  test("an unrelated key returns null", () => {
    expect(mapScrollKeyToCommand("a", false, 800)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// selectAnchorObject (F9)
// ---------------------------------------------------------------------------

describe("selectAnchorObject", () => {
  function geom(map: Record<string, AnchorGeometry>): Map<string, AnchorGeometry> {
    return new Map(Object.entries(map));
  }

  test("single focused object always anchors, regardless of scroll position", () => {
    const objectStates: AnchorCandidate[] = [{ name: "a", focused: true }];
    const geometryStore = geom({ a: { offsetTop: 0, height: 2000 } });
    expect(selectAnchorObject(objectStates, geometryStore, 0, 800)).toBe("a");
    expect(selectAnchorObject(objectStates, geometryStore, 500, 800)).toBe("a");
    expect(selectAnchorObject(objectStates, geometryStore, 1200, 800)).toBe("a");
  });

  test("multi-focus stacking: picks the topmost object intersecting the visible window", () => {
    // a: [0, 300), b: [300, 900), c: [900, 1400) — window [400, 1200) at
    // scrollOffset=400, viewportHeight=800 intersects b first (topmost).
    const objectStates: AnchorCandidate[] = [
      { name: "a", focused: true },
      { name: "b", focused: true },
      { name: "c", focused: true },
    ];
    const geometryStore = geom({
      a: { offsetTop: 0, height: 300 },
      b: { offsetTop: 300, height: 600 },
      c: { offsetTop: 900, height: 500 },
    });
    expect(selectAnchorObject(objectStates, geometryStore, 400, 800)).toBe("b");
  });

  test("scrolled to the very top: anchors the first (topmost) object", () => {
    const objectStates: AnchorCandidate[] = [
      { name: "a", focused: true },
      { name: "b", focused: true },
    ];
    const geometryStore = geom({
      a: { offsetTop: 0, height: 300 },
      b: { offsetTop: 300, height: 600 },
    });
    expect(selectAnchorObject(objectStates, geometryStore, 0, 800)).toBe("a");
  });

  test("unfocused objects are never selected as the anchor, even if their geometry intersects the window", () => {
    const objectStates: AnchorCandidate[] = [
      { name: "a", focused: false },
      { name: "b", focused: true },
    ];
    const geometryStore = geom({
      a: { offsetTop: 0, height: 300 },
      b: { offsetTop: 300, height: 600 },
    });
    // Window [0, 800) technically overlaps "a"'s [0, 300) range too, but "a"
    // is unfocused (a within-column depth card, not scrollable content).
    expect(selectAnchorObject(objectStates, geometryStore, 0, 800)).toBe("b");
  });

  test("an object flush against the window's edge (touching, not overlapping) does not count", () => {
    const objectStates: AnchorCandidate[] = [
      { name: "a", focused: true },
      { name: "b", focused: true },
    ];
    const geometryStore = geom({
      a: { offsetTop: 0, height: 300 },
      b: { offsetTop: 300, height: 600 },
    });
    // Window [300, 1100) starts exactly where "a" ends — "a" does not
    // intersect, "b" does.
    expect(selectAnchorObject(objectStates, geometryStore, 300, 800)).toBe("b");
  });

  test("null-safety (forecast Finding 2): no focused object has a geometry entry -> returns null, not NaN", () => {
    const objectStates: AnchorCandidate[] = [{ name: "a", focused: true }];
    const geometryStore = geom({}); // "a" registered as focused but not yet measured
    expect(selectAnchorObject(objectStates, geometryStore, 0, 800)).toBeNull();
  });

  test("null-safety: no objects are focused at all -> returns null", () => {
    const objectStates: AnchorCandidate[] = [{ name: "a", focused: false }];
    const geometryStore = geom({ a: { offsetTop: 0, height: 300 } });
    expect(selectAnchorObject(objectStates, geometryStore, 0, 800)).toBeNull();
  });

  test("null-safety: a focused object exists but its measured range never intersects the window -> returns null", () => {
    const objectStates: AnchorCandidate[] = [{ name: "a", focused: true }];
    const geometryStore = geom({ a: { offsetTop: 0, height: 300 } });
    // Window [1000, 1800) is entirely past "a"'s [0, 300) range — a
    // transient state (e.g. mid-swap-commit against stale geometry), not
    // an error.
    expect(selectAnchorObject(objectStates, geometryStore, 1000, 800)).toBeNull();
  });

  test("mid-swap-commit shape: DOM order determines the walk, independent of Map insertion order", () => {
    const objectStates: AnchorCandidate[] = [
      { name: "second", focused: true },
      { name: "first", focused: true },
    ];
    // geometryStore populated in a different order than objectStates —
    // the walk must follow objectStates (DOM order), not Map iteration order.
    const geometryStore = geom({
      first: { offsetTop: 300, height: 600 },
      second: { offsetTop: 0, height: 300 },
    });
    expect(selectAnchorObject(objectStates, geometryStore, 0, 800)).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// isAtScrollEnd (F9 commit 2)
// ---------------------------------------------------------------------------

describe("isAtScrollEnd", () => {
  test("offset exactly at maxScroll is at the end", () => {
    expect(isAtScrollEnd(500, 500)).toBe(true);
  });

  test("offset within the threshold below maxScroll is at the end", () => {
    expect(isAtScrollEnd(500 - END_PIN_THRESHOLD_PX, 500)).toBe(true);
  });

  test("offset just beyond the threshold below maxScroll is NOT at the end", () => {
    expect(isAtScrollEnd(500 - END_PIN_THRESHOLD_PX - 0.01, 500)).toBe(false);
  });

  test("offset far from maxScroll is NOT at the end", () => {
    expect(isAtScrollEnd(0, 500)).toBe(false);
  });

  test("maxScroll of 0 (content fits, nothing to scroll): offset 0 counts as at the end", () => {
    expect(isAtScrollEnd(0, 0)).toBe(true);
  });

  test("probe-motivated case: a real fractional wheel tick 1.3px short of maxScroll counts as at the end", () => {
    expect(isAtScrollEnd(499.7, 501)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findIntraObjectAnchorCandidates (F10)
// ---------------------------------------------------------------------------

describe("findIntraObjectAnchorCandidates", () => {
  test("descends through SceneObject's own inert-wrapper single-child layer to find the consumer's real rows", () => {
    const objectEl = document.createElement("div"); // the registered outer element
    const inertWrapper = document.createElement("div"); // SceneObject's <div inert> wrapper
    objectEl.appendChild(inertWrapper);
    const rowA = document.createElement("div");
    const rowB = document.createElement("div");
    const rowC = document.createElement("div");
    inertWrapper.append(rowA, rowB, rowC);

    expect(findIntraObjectAnchorCandidates(objectEl)).toEqual([rowA, rowB, rowC]);
  });

  test("descends through an ADDITIONAL consumer-added single-child wrapper (e.g. a list component's own root) with no hardcoded depth", () => {
    const objectEl = document.createElement("div");
    const inertWrapper = document.createElement("div");
    const listRoot = document.createElement("ul"); // consumer's own extra wrapper
    objectEl.appendChild(inertWrapper);
    inertWrapper.appendChild(listRoot);
    const item1 = document.createElement("li");
    const item2 = document.createElement("li");
    listRoot.append(item1, item2);

    expect(findIntraObjectAnchorCandidates(objectEl)).toEqual([item1, item2]);
  });

  test("a single-item/non-list object body (no level ever branches) returns an empty array", () => {
    const objectEl = document.createElement("div");
    const inertWrapper = document.createElement("div");
    const onlyChild = document.createElement("div"); // no siblings, ever
    objectEl.appendChild(inertWrapper);
    inertWrapper.appendChild(onlyChild);

    expect(findIntraObjectAnchorCandidates(objectEl)).toEqual([]);
  });

  test("an object element with zero children returns an empty array", () => {
    const objectEl = document.createElement("div");
    expect(findIntraObjectAnchorCandidates(objectEl)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectIntraObjectAnchorIndex (F10)
// ---------------------------------------------------------------------------

describe("selectIntraObjectAnchorIndex", () => {
  test("single candidate spanning the whole window always anchors, regardless of scroll position", () => {
    const candidates: AnchorGeometry[] = [{ offsetTop: 0, height: 2000 }];
    expect(selectIntraObjectAnchorIndex(candidates, 0, 800)).toBe(0);
    expect(selectIntraObjectAnchorIndex(candidates, 500, 800)).toBe(0);
    expect(selectIntraObjectAnchorIndex(candidates, 1200, 800)).toBe(0);
  });

  test("picks the topmost candidate intersecting the visible window, in DOM order", () => {
    // rows: [0,70) [70,140) [140,210) ... window [350, 1150) at
    // scrollOffset=350, viewportHeight=800 intersects the row starting at
    // 280? No — intersects the row at [350,420)? Row boundaries are every
    // 70px; window starts exactly at a row boundary (350 = 5*70), so the
    // row at index 5 ([350,420)) is the first intersecting one.
    const candidates: AnchorGeometry[] = Array.from({ length: 10 }, (_, i) => ({
      offsetTop: i * 70,
      height: 70,
    }));
    expect(selectIntraObjectAnchorIndex(candidates, 350, 800)).toBe(5);
  });

  test("scrolled to the very top: anchors the first (topmost) candidate", () => {
    const candidates: AnchorGeometry[] = [
      { offsetTop: 0, height: 70 },
      { offsetTop: 70, height: 70 },
    ];
    expect(selectIntraObjectAnchorIndex(candidates, 0, 800)).toBe(0);
  });

  test("a candidate flush against the window's edge (touching, not overlapping) does not count", () => {
    const candidates: AnchorGeometry[] = [
      { offsetTop: 0, height: 300 },
      { offsetTop: 300, height: 600 },
    ];
    // Window [300, 1100) starts exactly where the first candidate ends —
    // the first does not intersect, the second does.
    expect(selectIntraObjectAnchorIndex(candidates, 300, 800)).toBe(1);
  });

  test("null-safety: an empty candidates array returns null, not NaN", () => {
    expect(selectIntraObjectAnchorIndex([], 0, 800)).toBeNull();
  });

  test("null-safety: no candidate's measured range ever intersects the window -> returns null", () => {
    const candidates: AnchorGeometry[] = [{ offsetTop: 0, height: 300 }];
    // Window [1000, 1800) is entirely past the only candidate's [0, 300) range.
    expect(selectIntraObjectAnchorIndex(candidates, 1000, 800)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findDeepestIntraObjectAnchor (F10b)
// ---------------------------------------------------------------------------

describe("findDeepestIntraObjectAnchor", () => {
  /** A real, flow-laid-out block element of the given height, appended to `parent`. */
  function block(parent: Element, height: number, opts: { position?: string } = {}): HTMLElement {
    const el = document.createElement("div");
    el.style.height = `${height}px`;
    el.style.display = "block";
    if (opts.position) el.style.position = opts.position;
    parent.appendChild(el);
    return el;
  }

  function makeWrapper(): HTMLElement {
    const wrapper = document.createElement("div");
    document.body.appendChild(wrapper);
    return wrapper;
  }

  test("recursively descends through 2 levels of REAL branching to select the actual row, not the identity-stable intermediate wrapper it's nested in", () => {
    // objectEl's single child is midLevel, which branches into TWO real
    // siblings [decoy(0-height, never intersects), rowsContainer] — the
    // level F10's own one-level descent would have stopped at, selecting
    // rowsContainer itself. rowsContainer ITSELF branches further into the
    // actual rows — reaching them requires the OUTER loop to iterate a
    // SECOND time (descending into the level-1 selection), not just
    // findIntraObjectAnchorCandidates' own single-child-skip (which fully
    // resolves within one call and wouldn't exercise this).
    const wrapper = makeWrapper();
    try {
      const objectEl = block(wrapper, 0); // height irrelevant — its own box isn't a candidate
      const midLevel = document.createElement("div"); // objectEl's sole child (single-child-skipped)
      objectEl.appendChild(midLevel);
      const decoy = block(midLevel, 0); // 0-height — never intersects any window
      const rowsContainer = document.createElement("div"); // mirrors MessageList's root — the level F10 stopped at
      midLevel.appendChild(rowsContainer);
      const row0 = block(rowsContainer, 100);
      const row1 = block(rowsContainer, 100);
      const row2 = block(rowsContainer, 100);

      const wrapperRect = wrapper.getBoundingClientRect();
      // rowsContainer spans [0, 300) (decoy consumes no space) — row1 spans
      // [100, 200) within it — window [150, 250) intersects row1.
      const match = findDeepestIntraObjectAnchor(objectEl, wrapperRect, 150, 100);

      expect(match?.el).toBe(row1);
      void decoy;
      void row0;
      void row2;
    } finally {
      wrapper.remove();
    }
  });

  test("a depth-3 nesting (one further level of REAL branching) generalizes with no hardcoded depth", () => {
    const wrapper = makeWrapper();
    try {
      const objectEl = block(wrapper, 0);
      const outerLevel = document.createElement("div"); // objectEl's sole child
      objectEl.appendChild(outerLevel);
      const outerDecoy = block(outerLevel, 0);
      const midLevel = document.createElement("div"); // outerLevel's 2nd child — real branching #1
      outerLevel.appendChild(midLevel);
      const midDecoy = block(midLevel, 0);
      const rowsContainer = document.createElement("div"); // midLevel's 2nd child — real branching #2
      midLevel.appendChild(rowsContainer);
      const row0 = block(rowsContainer, 100);
      const row1 = block(rowsContainer, 100);

      const wrapperRect = wrapper.getBoundingClientRect();
      // row0 spans [0, 100) — window [0, 50) intersects it. Reaching it
      // requires THREE outer-loop iterations (objectEl -> midLevel ->
      // rowsContainer -> row0), each through a genuine branching level.
      const match = findDeepestIntraObjectAnchor(objectEl, wrapperRect, 0, 50);

      expect(match?.el).toBe(row0);
      void outerDecoy;
      void midDecoy;
      void row1;
    } finally {
      wrapper.remove();
    }
  });

  test("terminates at a genuine leaf row (no text/inline content mistaken for further candidates)", () => {
    const wrapper = makeWrapper();
    try {
      const objectEl = block(wrapper, 0);
      const rowsContainer = document.createElement("div");
      objectEl.appendChild(rowsContainer);
      // Two rows — a lone single row would collapse into a pass-through
      // wrapper by findIntraObjectAnchorCandidates' own single-child rule
      // (correctly: a container with exactly one item isn't list-like), so
      // a real branching level needs at least two siblings here.
      const row0 = block(rowsContainer, 100);
      row0.textContent = "hello world"; // a leaf row's real content is text, not more elements
      const row1 = block(rowsContainer, 100);

      const wrapperRect = wrapper.getBoundingClientRect();
      // row0 spans [0, 100) — window [0, 50) intersects it.
      const match = findDeepestIntraObjectAnchor(objectEl, wrapperRect, 0, 50);

      expect(match?.el).toBe(row0);
      void row1;
    } finally {
      wrapper.remove();
    }
  });

  test("sticky sibling exclusion: a sticky element at the anchor line is never selected, even when it would otherwise be topmost-intersecting", () => {
    const wrapper = makeWrapper();
    try {
      const objectEl = block(wrapper, 0);
      const flexStack = document.createElement("div");
      objectEl.appendChild(flexStack);
      const stickyComposer = block(flexStack, 60, { position: "sticky" }); // [0, 60) — DOM-first, would win topmost-in-order
      const rowsContainer = document.createElement("div");
      flexStack.appendChild(rowsContainer);
      const row0 = block(rowsContainer, 100); // global [60, 160)
      const row1 = block(rowsContainer, 100); // global [160, 260) — a 2nd row so rowsContainer is a real branching level

      const wrapperRect = wrapper.getBoundingClientRect();
      // Window [0, 200) intersects BOTH stickyComposer ([0,60)) and rowsContainer
      // ([60,260), which contains row0/row1) — the sticky one is DOM-first
      // (would win a naive topmost-in-order pick) but must be excluded.
      const match = findDeepestIntraObjectAnchor(objectEl, wrapperRect, 0, 200);

      expect(match?.el).toBe(row0);
      void stickyComposer;
      void row1;
    } finally {
      wrapper.remove();
    }
  });

  test("a fixed-position sibling is also excluded", () => {
    const wrapper = makeWrapper();
    try {
      const objectEl = block(wrapper, 0);
      const flexStack = document.createElement("div");
      objectEl.appendChild(flexStack);
      const fixedBanner = block(flexStack, 40, { position: "fixed" });
      const rowsContainer = document.createElement("div");
      flexStack.appendChild(rowsContainer);
      const row0 = block(rowsContainer, 100);
      const row1 = block(rowsContainer, 100);

      const wrapperRect = wrapper.getBoundingClientRect();
      const match = findDeepestIntraObjectAnchor(objectEl, wrapperRect, 0, 200);

      expect(match?.el).toBe(row0);
      void fixedBanner;
      void row1;
    } finally {
      wrapper.remove();
    }
  });

  test("null-safety: nothing intersects at the first level -> returns null", () => {
    const wrapper = makeWrapper();
    try {
      const objectEl = block(wrapper, 0);
      const rowsContainer = document.createElement("div");
      objectEl.appendChild(rowsContainer);
      block(rowsContainer, 100); // [0, 100)
      block(rowsContainer, 100); // [100, 200)

      const wrapperRect = wrapper.getBoundingClientRect();
      // Window [1000, 1800) is entirely past both rows.
      const match = findDeepestIntraObjectAnchor(objectEl, wrapperRect, 1000, 800);

      expect(match).toBeNull();
    } finally {
      wrapper.remove();
    }
  });

  test("a single-item object body (no branching at any level) returns null — same shape F10's own null-safety covers", () => {
    const wrapper = makeWrapper();
    try {
      const objectEl = block(wrapper, 0);
      const onlyChild = document.createElement("div");
      objectEl.appendChild(onlyChild);
      block(onlyChild, 500); // one lone item, never branches

      const wrapperRect = wrapper.getBoundingClientRect();
      const match = findDeepestIntraObjectAnchor(objectEl, wrapperRect, 0, 200);

      expect(match).toBeNull();
    } finally {
      wrapper.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// findScrollToTarget (F11 commit 2)
// ---------------------------------------------------------------------------

describe("findScrollToTarget", () => {
  test("finds a descendant element with a matching id", () => {
    const root = document.createElement("div");
    const target = document.createElement("div");
    target.id = "message-42";
    root.appendChild(target);

    expect(findScrollToTarget(root, "message-42")).toBe(target);
  });

  test("returns null for an unknown id", () => {
    const root = document.createElement("div");
    root.appendChild(document.createElement("div"));

    expect(findScrollToTarget(root, "does-not-exist")).toBeNull();
  });

  test("scoped to root — an element with a matching id OUTSIDE root is never found", () => {
    const outsideMatch = document.createElement("div");
    outsideMatch.id = "shared-id";
    document.body.appendChild(outsideMatch);
    const root = document.createElement("div"); // no matching descendant
    document.body.appendChild(root);

    try {
      expect(findScrollToTarget(root, "shared-id")).toBeNull();
    } finally {
      outsideMatch.remove();
      root.remove();
    }
  });

  test("an id containing characters that would break a naive selector string still resolves (CSS.escape)", () => {
    const root = document.createElement("div");
    const target = document.createElement("div");
    target.id = "message:42.5"; // colon + period — both need escaping in a CSS selector
    root.appendChild(target);

    expect(findScrollToTarget(root, "message:42.5")).toBe(target);
  });
});

// ---------------------------------------------------------------------------
// computeNearestEdgeScrollOffset (F11 commit 2)
// ---------------------------------------------------------------------------

describe("computeNearestEdgeScrollOffset", () => {
  test("target already fully visible — no movement", () => {
    // window [500, 1300) — target [600, 700) is fully contained.
    expect(computeNearestEdgeScrollOffset(500, 800, 600, 100, 5000)).toBe(500);
  });

  test("target entirely above the window — aligns target's top with the viewport's top", () => {
    // window [1000, 1800) — target [200, 300) is entirely above it.
    expect(computeNearestEdgeScrollOffset(1000, 800, 200, 100, 5000)).toBe(200);
  });

  test("target entirely below the window — aligns target's bottom with the viewport's bottom", () => {
    // window [0, 800) — target [1200, 1300) is entirely below it.
    // Aligning the bottom: offset = targetEnd - viewportHeight = 1300 - 800 = 500.
    expect(computeNearestEdgeScrollOffset(0, 800, 1200, 100, 5000)).toBe(500);
  });

  test("target straddling the top edge (starts above, ends within the window) — aligns to the top", () => {
    // window [500, 1300) — target [400, 600) starts above, ends inside.
    expect(computeNearestEdgeScrollOffset(500, 800, 400, 200, 5000)).toBe(400);
  });

  test("target straddling the bottom edge (starts within, ends below the window) — aligns to the bottom", () => {
    // window [0, 800) — target [700, 900) starts inside, ends below.
    // Aligning the bottom: offset = 900 - 800 = 100.
    expect(computeNearestEdgeScrollOffset(0, 800, 700, 200, 5000)).toBe(100);
  });

  test("a target taller than the viewport (visible on neither edge cleanly) aligns to its top", () => {
    // window [500, 1300) — target [200, 2000) (height 1800) spans past
    // both edges. A positive, non-clamp-boundary offset so this
    // discriminates "aligns to top" from an unrelated clamp side effect.
    expect(computeNearestEdgeScrollOffset(500, 800, 200, 1800, 5000)).toBe(200);
  });

  test("clamps the result to [0, maxScroll]", () => {
    // A target near the very top would naturally compute a negative-ish
    // or out-of-bounds offset absent clamping.
    expect(computeNearestEdgeScrollOffset(1000, 800, -50, 100, 5000)).toBe(0);
    // A target past maxScroll clamps down to it.
    expect(computeNearestEdgeScrollOffset(0, 800, 9000, 100, 5000)).toBe(5000);
  });

  test("target flush against the window's edges (touching, not overlapping) still counts as visible — no movement", () => {
    // window [0, 800) — target [0, 800) exactly fills it.
    expect(computeNearestEdgeScrollOffset(0, 800, 0, 800, 5000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// classifyTouchGestureDirection / shouldPreventTouchMove (F13 commit 1)
// ---------------------------------------------------------------------------

describe("classifyTouchGestureDirection", () => {
  test("movement under the slop on both axes is undecided", () => {
    expect(classifyTouchGestureDirection(0, 0)).toBe("undecided");
    expect(classifyTouchGestureDirection(TOUCH_DIRECTION_SLOP_PX - 1, TOUCH_DIRECTION_SLOP_PX - 1)).toBe(
      "undecided",
    );
  });

  test("predominantly vertical movement past the slop claims vertical", () => {
    expect(classifyTouchGestureDirection(2, 50)).toBe("vertical");
    expect(classifyTouchGestureDirection(-2, -50)).toBe("vertical");
  });

  test("predominantly horizontal movement past the slop releases to horizontal", () => {
    expect(classifyTouchGestureDirection(50, 2)).toBe("horizontal");
    expect(classifyTouchGestureDirection(-50, -2)).toBe("horizontal");
  });

  test("exactly at the slop on one axis, zero on the other decides by magnitude", () => {
    expect(classifyTouchGestureDirection(0, TOUCH_DIRECTION_SLOP_PX)).toBe("vertical");
    expect(classifyTouchGestureDirection(TOUCH_DIRECTION_SLOP_PX, 0)).toBe("horizontal");
  });

  test("an exact tie between axes decides horizontal (decline-to-claim default)", () => {
    expect(classifyTouchGestureDirection(30, 30)).toBe("horizontal");
    expect(classifyTouchGestureDirection(-30, 30)).toBe("horizontal");
  });

  test("decision is based on cumulative movement from the fixed start point, not axis sign", () => {
    // A gesture that's drifted mostly down-and-slightly-right is still vertical.
    expect(classifyTouchGestureDirection(15, 200)).toBe("vertical");
  });
});

describe("shouldPreventTouchMove", () => {
  test("a single-touch vertical claim is prevented", () => {
    expect(shouldPreventTouchMove("vertical", 1)).toBe(true);
  });

  test("a single-touch horizontal release is never prevented", () => {
    expect(shouldPreventTouchMove("horizontal", 1)).toBe(false);
  });

  test("an undecided single-touch gesture is never prevented", () => {
    expect(shouldPreventTouchMove("undecided", 1)).toBe(false);
  });

  test("multi-touch (pinch) is never prevented, even mid-vertical-claim", () => {
    // A single finger can decide "vertical" before a second finger joins —
    // the moment the gesture becomes multi-touch, native pinch-zoom must
    // proceed unobstructed regardless of the earlier single-finger decision.
    expect(shouldPreventTouchMove("vertical", 2)).toBe(false);
    expect(shouldPreventTouchMove("horizontal", 2)).toBe(false);
    expect(shouldPreventTouchMove("undecided", 2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeReleaseVelocity (F13 commit 2)
// ---------------------------------------------------------------------------

describe("computeReleaseVelocity", () => {
  function sample(t: number, offset: number): VelocitySample {
    return { t, offset };
  }

  test("fewer than 2 samples in the window is zero velocity", () => {
    expect(computeReleaseVelocity([], 1000)).toBe(0);
    expect(computeReleaseVelocity([sample(990, 40)], 1000)).toBe(0);
  });

  test("computes average velocity (px/s) across the sample window, sign matching offset direction", () => {
    // offset increases 0 -> 100 over 50ms => 100/0.05s = 2000 px/s.
    const samples = [sample(950, 0), sample(1000, 100)];
    expect(computeReleaseVelocity(samples, 1000)).toBeCloseTo(2000, 0);
  });

  test("negative offset movement produces negative velocity", () => {
    const samples = [sample(950, 100), sample(1000, 0)];
    expect(computeReleaseVelocity(samples, 1000)).toBeCloseTo(-2000, 0);
  });

  test("samples older than the window are excluded from the calculation", () => {
    const samples = [
      sample(500, 9999), // ancient, outside the window — must not skew the result
      sample(950, 0),
      sample(1000, 100),
    ];
    expect(computeReleaseVelocity(samples, 1000)).toBeCloseTo(2000, 0);
  });

  test("a sample exactly at the window boundary is included", () => {
    const boundaryT = 1000 - TOUCH_VELOCITY_WINDOW_MS;
    const samples = [sample(boundaryT, 0), sample(1000, 50)];
    expect(computeReleaseVelocity(samples, 1000)).toBeGreaterThan(0);
  });

  test("a sample just outside the window is excluded", () => {
    const justOutsideT = 1000 - TOUCH_VELOCITY_WINDOW_MS - 1;
    const samples = [sample(justOutsideT, 0), sample(999, 1)]; // <2 remaining once excluded
    expect(computeReleaseVelocity(samples, 1000)).toBe(0);
  });

  test("a stale newest sample (finger already stopped before release) is zero velocity", () => {
    const samples = [sample(1000 - TOUCH_VELOCITY_STALE_MS - 5, 0), sample(1000 - TOUCH_VELOCITY_STALE_MS - 1, 40)];
    expect(computeReleaseVelocity(samples, 1000)).toBe(0);
  });

  test("a newest sample just within the staleness threshold still counts", () => {
    const samples = [sample(1000 - TOUCH_VELOCITY_STALE_MS - 10, 0), sample(1000 - TOUCH_VELOCITY_STALE_MS, 40)];
    expect(computeReleaseVelocity(samples, 1000)).toBeGreaterThan(0);
  });

  test("clamps to MAX_FLING_VELOCITY on an implausibly large delta/dt ratio", () => {
    const samples = [sample(999, 0), sample(1000, 100000)];
    expect(computeReleaseVelocity(samples, 1000)).toBe(MAX_FLING_VELOCITY);
  });

  test("clamps to -MAX_FLING_VELOCITY symmetrically", () => {
    const samples = [sample(999, 100000), sample(1000, 0)];
    expect(computeReleaseVelocity(samples, 1000)).toBe(-MAX_FLING_VELOCITY);
  });

  test("zero net movement across the window is zero velocity", () => {
    const samples = [sample(950, 50), sample(975, 80), sample(1000, 50)];
    expect(computeReleaseVelocity(samples, 1000)).toBe(0);
  });

  test("averages across the full window rather than just the last two samples", () => {
    // A fast early burst followed by a slower tail — the oldest-to-newest
    // average (2200 px/s) differs clearly from just the last two samples'
    // own instantaneous rate (400 px/s), proving the whole window is used.
    const samples = [sample(900, 0), sample(950, 200), sample(1000, 220)];
    expect(computeReleaseVelocity(samples, 1000)).toBeCloseTo(2200, 0);
  });
});
