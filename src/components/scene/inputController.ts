/**
 * The Scene input controller — pure/DOM-light functions that turn raw wheel
 * and keyboard events into plain scroll commands. NOT exported from either
 * barrel: this is not public API. Scene.tsx and SceneColumn.tsx consume it
 * directly by relative import (mirrors motionSeam.ts's internal-only pattern).
 *
 * Command APPLICATION (writing the resulting offset, driving the motion
 * pipeline, running touch-release inertia) stays in SceneColumn — this
 * module only decides WHAT should happen, never performs the write itself.
 */

// ---------------------------------------------------------------------------
// Wheel
// ---------------------------------------------------------------------------

/**
 * Scales a wheel event's deltaY into a pixel delta, or `null` when the event
 * is a pinch-zoom gesture (ctrlKey set — trackpad pinch is delivered as a
 * ctrl+wheel event in every major browser). `null` means "do not route, do
 * not preventDefault" — the browser's native pinch-zoom must pass through
 * untouched.
 *
 * Non-pinch events are scaled by `deltaMode`: LINE (1) multiplies by an
 * approximate line height (16px); PAGE (2) multiplies by the viewport
 * height; PIXEL (0, the common case) passes through unscaled.
 */
export function normalizeWheelDelta(e: WheelEvent, viewportHeight: number): number | null {
  if (e.ctrlKey) return null;

  switch (e.deltaMode) {
    case 1: // DOM_DELTA_LINE
      return e.deltaY * 16;
    case 2: // DOM_DELTA_PAGE
      return e.deltaY * viewportHeight;
    default: // DOM_DELTA_PIXEL
      return e.deltaY;
  }
}

/**
 * Decides which column element a wheel event should scroll.
 *
 * A10 fallback: if exactly one focused column in the viewport is scrollable
 * (`[data-column-focused='true'][data-max-scroll]`), it wins unconditionally
 * — wheel input anywhere in the viewport scrolls it, so there are no dead
 * margins when only one column can possibly respond. With zero or multiple
 * scrollable focused columns, falls back to hit-testing the element under
 * the cursor (today's behavior) and requires it to be a focused, scrollable
 * column.
 */
export function decideWheelTargetColumn(
  viewport: Element,
  clientX: number,
  clientY: number,
): Element | null {
  const scrollableFocused = viewport.querySelectorAll(
    "[data-column-focused='true'][data-max-scroll]",
  );
  if (scrollableFocused.length === 1) {
    return scrollableFocused[0]!;
  }

  const target = document.elementFromPoint(clientX, clientY);
  const column = target?.closest("[data-column]") ?? null;
  if (!column) return null;
  if (column.getAttribute("data-column-focused") !== "true") return null;
  if (!column.hasAttribute("data-max-scroll")) return null;
  return column;
}

// ---------------------------------------------------------------------------
// Interior scroll claim gate (F8a)
// ---------------------------------------------------------------------------

/**
 * A real, currently-overflowing vertical scroll container:
 * `overflow-y: auto|scroll` (opting in to browser-managed scrolling) AND
 * `scrollHeight > clientHeight` (there's actually something to scroll — an
 * `overflow-y: auto` element with fitting content never matches).
 * `[data-column-content]` itself carries no `overflow` CSS today (confirmed
 * by reading its style block), so it never accidentally matches here — this
 * is intentionally NOT special-cased by attribute; a defensive test covers
 * the case in case a future edit adds `overflow` there.
 */
function isVerticalScrollContainer(el: Element): boolean {
  const overflowY = getComputedStyle(el).overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll") return false;
  return el.scrollHeight > el.clientHeight;
}

/**
 * Effective `overscroll-behavior-y` for `el`, falling back to the shorthand
 * `overscroll-behavior` when the Y-specific longhand isn't declared. Both
 * resolve to the initial value `"auto"` when neither is set.
 */
function effectiveOverscrollBehaviorY(el: Element): string {
  const style = getComputedStyle(el);
  const longhand = style.getPropertyValue("overscroll-behavior-y").trim();
  if (longhand) return longhand;
  return style.getPropertyValue("overscroll-behavior").trim() || "auto";
}

/**
 * True when a real, currently-scrollable ancestor of `target` — walking up
 * to (but never including) `columnBoundary` — can consume `delta` itself.
 * When true, the caller must decline to route/preventDefault the event and
 * let the browser's native scroll proceed; the interior element handles it
 * exactly as it would outside a Scene. This is the wheel half of the "once
 * inside a Scene object, normal CSS/JS just works" contract (F8 interior
 * contract plan).
 *
 * - A candidate = `isVerticalScrollContainer(el)`.
 * - A candidate that can still move further in `delta`'s direction consumes
 *   — return true immediately.
 * - A candidate at its edge in that direction defers to its own
 *   `overscroll-behavior-y`: `contain`/`none` means the consumer's own CSS
 *   says "don't chain past this edge" — still consume (dead-stop; the
 *   caller must not also react). The default `auto` declines at this
 *   candidate and the walk continues outward (natural scroll-chaining) to
 *   the next ancestor.
 * - Reaching `columnBoundary` (exclusive) with no consuming candidate found
 *   — decline (return false).
 *
 * `axis` is threaded through (rather than hardcoded) so F8b's touch
 * interior contract can reuse this walk; the wheel caller always passes
 * `"y"` — Scene's wheel handler only ever routes the Y axis — so only Y
 * semantics are implemented here today; no unused X-axis logic.
 */
export function interiorCanConsume(
  target: Element,
  columnBoundary: Element,
  axis: "y",
  delta: number,
): boolean {
  if (axis !== "y" || delta === 0) return false;

  const movingForward = delta > 0;

  let el: Element | null = target;
  while (el && el !== columnBoundary) {
    if (isVerticalScrollContainer(el)) {
      const node = el as HTMLElement;
      const maxScrollTop = node.scrollHeight - node.clientHeight;
      // 1px epsilon on the forward edge only: `scrollTop` is fractional and
      // on non-integer devicePixelRatio displays can settle permanently a
      // fraction of a pixel short of the integer `maxScrollTop` (MDN's
      // documented caveat) — without the tolerance, at-edge never
      // registers, the gate never declines, and wheel input goes dead at
      // the island's visual edge instead of chaining outward. The `<= 0`
      // bottom edge needs no epsilon: scrollTop clamps at exactly 0.
      const atEdge = movingForward
        ? node.scrollTop >= maxScrollTop - 1
        : node.scrollTop <= 0;
      if (!atEdge) return true;

      const overscroll = effectiveOverscrollBehaviorY(el);
      if (overscroll === "contain" || overscroll === "none") return true;
      // "auto" (the default): decline at this candidate, keep walking outward.
    }
    el = el.parentElement;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Interactive/editable element exemption (D1, DELTA-1)
// ---------------------------------------------------------------------------

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * True for elements where keyboard input has text-editing semantics — arrow
 * keys move a text caret or change a native form control's value. These must
 * never be hijacked for column scrolling.
 */
export function isEditableElement(el: Element): boolean {
  if (EDITABLE_TAGS.has(el.tagName)) return true;
  return (el as HTMLElement).isContentEditable === true;
}

const NATIVE_INTERACTIVE_TAGS = new Set(["BUTTON", "SUMMARY"]);

// Interactive ARIA roles only — widgets that consume arrow/space/home/end
// keys for their own navigation or activation model. "scrollbar" is
// deliberately EXCLUDED (DELTA-1): the Scrollbar thumb's own D4 keyboard
// handler owns its arrow-key behavior and stops propagation; it must not
// also short-circuit the generic exemption check here.
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "combobox",
  "textbox",
  "searchbox",
  "listbox",
  "grid",
  "tree",
]);

/**
 * CURATED interactive-element check for the scroll-key exemption gate
 * (DELTA-1). A naive `[role]`/`[tabindex]` matcher would ALSO exempt the
 * column's own scrollable content wrapper (`role="region"`, `tabIndex={0}` —
 * D2) and the scrollbar thumb, breaking the tab-to-region-then-arrow-scroll
 * keyboard path. `role="region"` is not an interactive role, so it never
 * exempts on its own; the content wrapper and scrollbar thumb never exempt
 * via the generic non-negative-tabindex rule below, no matter their tabindex
 * value — see the SELF-vs-ANCESTOR asymmetry note just above that check.
 */
export function isInteractiveElement(el: Element): boolean {
  if (isEditableElement(el)) return true;

  const tag = el.tagName;
  if (NATIVE_INTERACTIVE_TAGS.has(tag)) return true;
  if (tag === "A" && el.hasAttribute("href")) return true;
  if ((tag === "AUDIO" || tag === "VIDEO") && el.hasAttribute("controls")) return true;

  const role = el.getAttribute("role");
  if (role && INTERACTIVE_ROLES.has(role)) return true;

  // The column's own content wrapper is navigable-but-not-interactive — but
  // ONLY the wrapper itself, a SELF-ONLY check (fix round, gate finding):
  // every consumer's actual content lives inside [data-column-content] by
  // construction, so an ancestor-inclusive closest() check here would
  // wrongly exempt every NESTED focusable widget too (a roving-tabindex
  // list item, a focusable message bubble), hijacking its own arrow/Space
  // keys for column scroll. The scrollbar thumb is the opposite case:
  // [data-scrollbar] lives on the TRACK, an ANCESTOR of the thumb itself, so
  // closest() (ancestor-inclusive) is correct and necessary there.
  const isContentWrapperItself = el.hasAttribute("data-column-content");
  const isWithinScrollbar = el.closest("[data-scrollbar]") !== null;
  if (!isContentWrapperItself && !isWithinScrollbar) {
    const tabindex = el.getAttribute("tabindex");
    if (tabindex !== null && Number(tabindex) >= 0) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Keyboard → scroll command mapping
// ---------------------------------------------------------------------------

/** A plain instruction for how a column's scroll offset should change. */
export type ScrollCommand =
  | { type: "scrollBy"; delta: number }
  | { type: "page"; delta: number }
  | { type: "toTop" }
  | { type: "toBottom" }
  | { type: "fling"; velocity: number };

/**
 * Maps a keydown's key (+ shiftKey, for reversed paging on Space) to a
 * ScrollCommand. `pageSize` (typically the column's viewport height) sizes
 * PageUp/PageDown/Space. Returns `null` for keys with no scroll meaning —
 * callers should not preventDefault or otherwise treat the keydown as handled.
 */
export function mapScrollKeyToCommand(
  key: string,
  shiftKey: boolean,
  pageSize: number,
): ScrollCommand | null {
  switch (key) {
    case "ArrowDown":
      return { type: "scrollBy", delta: 40 };
    case "ArrowUp":
      return { type: "scrollBy", delta: -40 };
    case "PageDown":
      return { type: "page", delta: pageSize };
    case "PageUp":
      return { type: "page", delta: -pageSize };
    case " ":
      return { type: "page", delta: shiftKey ? -pageSize : pageSize };
    case "Home":
      return { type: "toTop" };
    case "End":
      return { type: "toBottom" };
    default:
      return null;
  }
}
