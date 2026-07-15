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
 * exempts on its own; and an element bearing (or nested within)
 * `[data-column-content]` or `[data-scrollbar]` never exempts via the
 * generic non-negative-tabindex rule, no matter its tabindex value.
 */
export function isInteractiveElement(el: Element): boolean {
  if (isEditableElement(el)) return true;

  const tag = el.tagName;
  if (NATIVE_INTERACTIVE_TAGS.has(tag)) return true;
  if (tag === "A" && el.hasAttribute("href")) return true;
  if ((tag === "AUDIO" || tag === "VIDEO") && el.hasAttribute("controls")) return true;

  const role = el.getAttribute("role");
  if (role && INTERACTIVE_ROLES.has(role)) return true;

  // The column's own content wrapper and the scrollbar thumb (a descendant
  // of the [data-scrollbar] track) are navigable-but-not-interactive: never
  // exempt them via the generic tabindex rule below.
  const exempt = el.closest("[data-column-content], [data-scrollbar]");
  if (!exempt) {
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
