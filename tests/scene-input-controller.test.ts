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
