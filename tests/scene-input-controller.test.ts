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
