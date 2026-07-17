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
  | { type: "fling"; velocity: number }
  | { type: "scrollTo"; offset: number };

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

// ---------------------------------------------------------------------------
// Content-growth anchor selection (F9)
// ---------------------------------------------------------------------------

/**
 * A registered object's focus state, structurally compatible with
 * SceneColumn's own (unexported) ObjectState — kept as a minimal local
 * shape here rather than importing it, since inputController.ts is a
 * dependency-light pure-function module SceneColumn.tsx imports FROM (an
 * import the other direction would be circular).
 */
export interface AnchorCandidate {
  name: string;
  focused: boolean;
}

/**
 * A registered object's measured position, structurally compatible with
 * SceneColumn's own (unexported) GeometryEntry — same rationale as
 * AnchorCandidate above.
 */
export interface AnchorGeometry {
  offsetTop: number;
  height: number;
}

/**
 * Selects the anchor object for content-growth scroll compensation (F9
 * anchoring-as-default): the topmost focused object, in DOM order, whose
 * measured range intersects the current scroll window
 * `[scrollOffset, scrollOffset + viewportHeight)`. Mirrors native browser
 * scroll anchoring in spirit — stabilize what the user is looking at — at
 * OBJECT granularity rather than arbitrary DOM nodes: Scene's geometry
 * store only knows each registered SceneObject's own total measured
 * height, not what moved within it, so this is the finest grain available
 * (and the only grain multi-focused-object stacking needs).
 *
 * `objectStates` is assumed to already be in DOM order (SceneColumn's own
 * `deriveObjectStates` preserves child order) — DOM order for focused
 * objects sharing `position: relative` in a column IS visual top-to-bottom
 * order, so the first intersecting match found while walking in order is
 * the topmost one; no separate sort is needed.
 *
 * Null-safety contract (forecast Finding 2): returns `null` when no
 * focused object's geometry entry can be found (e.g. a transient state
 * mid-swap-commit, before geometry has been remeasured for a newly-focused
 * object) — this is a legal transient state, not an error. Callers must
 * treat `null` as "skip compensation, no-op" and never NaN-propagate it
 * into a scroll write.
 */
export function selectAnchorObject(
  objectStates: AnchorCandidate[],
  geometryStore: Map<string, AnchorGeometry>,
  scrollOffset: number,
  viewportHeight: number,
): string | null {
  const windowStart = scrollOffset;
  const windowEnd = scrollOffset + viewportHeight;
  for (const { name, focused } of objectStates) {
    if (!focused) continue;
    const geometry = geometryStore.get(name);
    if (!geometry) continue;
    const objStart = geometry.offsetTop;
    const objEnd = geometry.offsetTop + geometry.height;
    // Intersects the visible window: the object starts before the window
    // ends AND ends after the window starts (a half-open range check —
    // an object flush against the window's own edge, touching but not
    // overlapping, does not count).
    if (objStart < windowEnd && objEnd > windowStart) {
      return name;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Follow-the-end pin threshold (F9 commit 2)
// ---------------------------------------------------------------------------

/**
 * Threshold (px) within which a scroll offset counts as "at the end" for
 * the `anchor="end"` follow-the-end pin state machine — probe-measured,
 * not guessed. A single real fractional wheel tick (deltaY=499.7 against a
 * maxScroll of 500.5) landed 1.3px short of the reported maxScroll in
 * testing: `data-max-scroll` resolves through `offsetHeight`, an integer
 * per the CSSOM spec (it rounds the true fractional layout box), while a
 * wheel-driven offset stays exactly fractional — so the design doc's
 * proposed "within 1px" would have missed a genuinely natural scroll-to-
 * the-bottom gesture. 2px clears that observed 1.3px gap with a small
 * margin while staying tight enough that the pin doesn't feel like it
 * re-engages from noticeably far away.
 */
export const END_PIN_THRESHOLD_PX = 2;

/**
 * True when `offset` is within END_PIN_THRESHOLD_PX of `maxScroll` — the
 * single check used symmetrically for both release ("moved away from the
 * end", when false) and re-pin ("scrolled back to the end", when true) in
 * the `anchor="end"` pin state machine. Evaluated at the same site as
 * every user-initiated write, against whatever offset that write is
 * driving toward.
 */
export function isAtScrollEnd(offset: number, maxScroll: number): boolean {
  return maxScroll - offset <= END_PIN_THRESHOLD_PX;
}

// ---------------------------------------------------------------------------
// Intra-object anchor selection (F10)
// ---------------------------------------------------------------------------

/**
 * Finds the candidate elements for intra-object content-growth anchoring
 * (F10): the children of the innermost single-child wrapper inside
 * `objectEl`. selectAnchorObject's own object-granularity anchoring is
 * structurally blind to a PREPEND inside a single anchor object's own
 * interior (its own offsetTop never moves from its own growth) — this finds
 * the finer-grained candidates one level down: the consumer's actual
 * rows/items, wherever they live under whatever incidental wrapping sits
 * above them.
 *
 * SceneObject always interposes its own inert wrapper div between a
 * registered object's outer element and the consumer's content
 * (`<div inert>{children}</div>`), and a consumer may add further
 * single-child wrapping of their own (e.g. a list component's own root
 * element). Descending through single-child chains before collecting
 * candidates finds the level where real siblings exist, regardless of how
 * many wrapper layers sit above them, without hardcoding a fixed depth.
 *
 * Returns an empty array when no level ever has more than one child (a
 * single-item, non-list object body) — there is nothing meaningful to
 * anchor at finer-than-object granularity there; the object-level
 * mechanism (F9 commit 1) already covers that shape (its own growth is
 * already a documented no-op, correctly, since nothing precedes it).
 */
export function findIntraObjectAnchorCandidates(objectEl: Element): Element[] {
  let container: Element = objectEl;
  while (container.children.length === 1) {
    container = container.children[0]!;
  }
  return Array.from(container.children);
}

/**
 * Selects the topmost intra-object anchor candidate (by index into
 * `candidates`) whose measured range intersects the current scroll window —
 * the SAME intersection rule as selectAnchorObject (F9 commit 1), scoped
 * one level finer: to the rows/items inside a single anchor object rather
 * than to top-level SceneObjects. `candidates` is assumed to already be in
 * DOM order (findIntraObjectAnchorCandidates preserves `element.children`
 * order), so the first intersecting match is the topmost.
 *
 * Returns `null` when no candidate intersects — a legal transient state
 * (mirrors selectAnchorObject's own null-safety contract), never
 * NaN-propagated into a scroll write.
 */
export function selectIntraObjectAnchorIndex(
  candidates: AnchorGeometry[],
  scrollOffset: number,
  viewportHeight: number,
): number | null {
  const windowStart = scrollOffset;
  const windowEnd = scrollOffset + viewportHeight;
  for (let i = 0; i < candidates.length; i++) {
    const { offsetTop, height } = candidates[i]!;
    if (offsetTop < windowEnd && offsetTop + height > windowStart) {
      return i;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recursive intra-object anchor descent (F10b)
// ---------------------------------------------------------------------------

/**
 * True for elements whose rendered position does NOT track normal flow —
 * `position: sticky` or `position: fixed`. Excluded from intra-object
 * anchor candidacy (F10b): native scroll anchoring excludes these from its
 * own candidate set for the same reason — a sticky/fixed element's
 * `getBoundingClientRect()` reflects wherever the viewport has pinned it,
 * not its flow position, so measuring it as a flow-position anchor would
 * produce a meaningless delta (and a sticky sibling parked at the anchor
 * line, e.g. a chat composer, would otherwise win selection over the
 * actual scrolling content next to it).
 */
function isStickyOrFixed(el: Element): boolean {
  const position = getComputedStyle(el).position;
  return position === "sticky" || position === "fixed";
}

/** A measured intra-object anchor match: the element plus its position, in
 * the SAME content-wrapper-relative frame `remeasureGeometry` uses for
 * top-level objects. */
export interface IntraObjectAnchorMatch {
  el: Element;
  offsetTop: number;
  height: number;
}

/**
 * Tolerance (px) for the store-time re-verification below: two
 * `getBoundingClientRect()` reads of the SAME element, taken microseconds
 * apart in the SAME synchronous pass, are trusted as consistent when they
 * agree within this margin. Mirrors this file's existing fractional-
 * rounding-class precedents at the same magnitude —
 * `END_PIN_THRESHOLD_PX` (a real ~1.3px fractional-wheel-tick gap,
 * probe-measured) and `interiorCanConsume`'s 1px `scrollTop` epsilon
 * (MDN-documented) — rather than inventing a new number for what's the
 * same underlying class of measurement noise one level deeper.
 */
export const STORE_VERIFY_TOLERANCE_PX = 2;

/**
 * Finds the DEEPEST element intersecting the current scroll window within
 * `objectEl` (F10b's recursive refinement of F10's one-level descent).
 * F10's `findIntraObjectAnchorCandidates` + `selectIntraObjectAnchorIndex`
 * correctly select the topmost intersecting candidate at ONE level — but a
 * real consumer pipeline can nest the actual scrolling rows two or more
 * wrapper levels below the level where real siblings first appear (e.g.
 * SceneObject's own inert wrapper → a flex stack of [rows-container,
 * sticky Composer, sticky PushBanner] → the rows themselves, INSIDE
 * rows-container). Stopping at the first branching level selects
 * rows-container — an identity-stable wrapper whose OWN offsetTop never
 * moves from a prepend inside it, reproducing F10's exact blindness one
 * level down.
 *
 * Native scroll anchoring's own rule is "the deepest element intersecting
 * the anchor line": at each level, selects the topmost non-sticky/fixed
 * candidate whose range intersects the window; if that candidate itself
 * has further candidates of its own, descends into it and repeats.
 * Terminates in one of TWO distinct ways: (a) a genuine leaf — the
 * selected candidate has no further element children to descend into
 * (e.g. an actual row, or a heading with only text content) — `best` is
 * trusted as-is, no extra work; (b) a "gave up" termination — the
 * selected candidate DOES have children, but NONE of them currently
 * intersect the scan window (e.g. the window moved out from under it
 * between when it WON selection at the level above and when its own
 * children got scanned). Case (b) is where F14's teleport bug lived:
 * `best` was trusted at the SHALLOW level's measurement with no check
 * that measurement was even still accurate, so a spurious/incorrect
 * intersection result at the level above — the reselection landing on a
 * candidate whose TRUE position turns out to be nowhere near the window
 * — got silently stored as fact, and the next settle would "correct"
 * toward that fiction by however far away the truth actually was
 * (probe-confirmed: a stub-forced reselection 3 sections away, landing
 * outside the window so its own children never intersected it, replayed
 * as an exact section-distance jump on the very next settle; 1-2 sections
 * away, still within the window, self-corrected because the deeper
 * descent reached a genuinely-remeasured leaf instead).
 *
 * F14 fix: on a "gave up" termination with a non-null `best`, re-read
 * `best.el`'s rect ONE more time (same `wrapperRect` frame) and compare
 * against the offsetTop already recorded for it. Agreeing within
 * `STORE_VERIFY_TOLERANCE_PX` means the shallow measurement was genuinely
 * accurate — a real case where a wrapper's own interior legitimately has
 * no in-view children right now (e.g. a padding gap) but the wrapper
 * itself IS the correct anchor — and `best` is trusted exactly as before.
 * Disagreeing means the level-above selection was NOT trustworthy —
 * return `null` instead of the fiction; the caller's carry-forward
 * machinery already self-heals a `null` result on the very next settle by
 * design (no special-case recovery needed, per this function's own
 * carry-forward caller). A genuine-leaf termination never reaches this
 * check — no extra reads on the common (correct) path.
 *
 * Honest limitation: the re-read happens microseconds after the
 * (potentially lying) read that won selection one level up, in the SAME
 * synchronous pass — this catches a bad measurement that was already
 * stale by the time it mattered, but a transient that persists for the
 * ENTIRE remeasure pass (i.e., both reads see the same wrong value) would
 * still agree and pass verification. This closes the amplification for
 * a same-pass measurement discrepancy; it does not by itself prove or
 * rule out any particular on-device trigger.
 *
 * Operates entirely in the SAME content-wrapper-relative (global) frame
 * `wrapperRect` establishes — a single shared measurement across the whole
 * recursive walk (mirrors remeasureGeometryWithAnchorCompensation's own
 * single-wrapperRect-read-per-pass technique). Converting the result to a
 * frame local to a specific anchor OBJECT (for composing with the
 * object-level diff) is the caller's job, same as F10's one-level version.
 *
 * Returns `null` when no candidate at the FIRST level intersects the
 * window — a legal transient state (mirrors selectIntraObjectAnchorIndex's
 * own null-safety contract), never NaN-propagated into a scroll write.
 */
export function findDeepestIntraObjectAnchor(
  objectEl: Element,
  wrapperRect: DOMRect,
  scrollOffset: number,
  viewportHeight: number,
): IntraObjectAnchorMatch | null {
  let current: Element = objectEl;
  let best: IntraObjectAnchorMatch | null = null;
  let gaveUp = false;

  for (;;) {
    const candidateEls = findIntraObjectAnchorCandidates(current).filter((el) => !isStickyOrFixed(el));
    if (candidateEls.length === 0) break; // genuine leaf — current has no further element children to descend into

    const candidateGeometry: AnchorGeometry[] = candidateEls.map((el) => ({
      offsetTop: el.getBoundingClientRect().top - wrapperRect.top,
      height: (el as HTMLElement).offsetHeight,
    }));
    const idx = selectIntraObjectAnchorIndex(candidateGeometry, scrollOffset, viewportHeight);
    if (idx === null) {
      // "Gave up": current HAS children, but none intersect the window
      // right now — best (if any, from one level up) needs verification
      // below before it can be trusted.
      gaveUp = true;
      break;
    }

    const selected = candidateEls[idx]!;
    best = { el: selected, offsetTop: candidateGeometry[idx]!.offsetTop, height: candidateGeometry[idx]!.height };
    current = selected; // descend and try to go deeper
  }

  if (gaveUp && best !== null) {
    const reread = best.el.getBoundingClientRect().top - wrapperRect.top;
    if (Math.abs(reread - best.offsetTop) > STORE_VERIFY_TOLERANCE_PX) {
      return null;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Declarative scrollTo (F11 commit 2)
// ---------------------------------------------------------------------------

/**
 * Finds the element with the given standard DOM `id` within `root` — the
 * interior contract again: consumers use normal HTML ids on their own
 * content, no Scene-specific naming. Scoped to `root` (the column's content
 * wrapper) rather than a global `document.getElementById` lookup, so a
 * `scrollTo` id collision with something OUTSIDE the column (e.g. another
 * column, or unrelated page chrome) can never silently navigate to the
 * wrong element. `CSS.escape` guards against ids containing characters that
 * would otherwise break the attribute-selector syntax (a real id
 * constraint browsers accept but a raw template-string selector wouldn't).
 */
export function findScrollToTarget(root: Element, id: string): Element | null {
  return root.querySelector(`[id="${CSS.escape(id)}"]`);
}

/**
 * Computes the nearest-edge scroll offset that brings a target element
 * fully into view, mirroring the native `element.scrollIntoView({ block:
 * "nearest" })` algorithm: already fully visible → no movement; entirely or
 * partially above the current window → align the target's TOP with the
 * viewport's top; entirely or partially below → align the target's BOTTOM
 * with the viewport's bottom. A target taller than the viewport (visible on
 * neither edge cleanly) falls into the "above" branch and aligns to its
 * top — an arbitrary but reasonable choice for that ambiguous case, same as
 * browsers make.
 *
 * Clamped to `[0, maxScroll]` — same bound every other write in this file
 * respects.
 */
export function computeNearestEdgeScrollOffset(
  currentOffset: number,
  viewportHeight: number,
  targetOffsetTop: number,
  targetHeight: number,
  maxScroll: number,
): number {
  const windowStart = currentOffset;
  const windowEnd = currentOffset + viewportHeight;
  const targetStart = targetOffsetTop;
  const targetEnd = targetOffsetTop + targetHeight;

  let next: number;
  if (targetStart < windowStart) {
    next = targetStart;
  } else if (targetEnd > windowEnd) {
    next = targetEnd - viewportHeight;
  } else {
    next = currentOffset;
  }

  return Math.max(0, Math.min(maxScroll, next));
}

// ---------------------------------------------------------------------------
// Touch gesture ownership disambiguation (F13 commit 1)
// ---------------------------------------------------------------------------

/**
 * A touch gesture's decided ownership: "undecided" until cumulative movement
 * clears TOUCH_DIRECTION_SLOP_PX, then "vertical" or "horizontal" ONCE,
 * permanently, for the gesture's lifetime — see
 * `classifyTouchGestureDirection`'s own doc comment for how the decision is
 * made and how SceneColumn's touch-pan block uses each outcome.
 */
export type TouchGestureOwnership = "undecided" | "vertical" | "horizontal";

/**
 * Slop (px) a touch gesture's cumulative movement must clear, on EITHER
 * axis, before ownership is decided — small movements are ambiguous (could
 * still be the start of either gesture, or a tap), so nothing is claimed or
 * released until the finger has genuinely committed to a direction.
 */
export const TOUCH_DIRECTION_SLOP_PX = 10;

/**
 * Classifies a touch gesture's ownership from its cumulative movement since
 * touchstart (`dx`/`dy`, both measured from the SAME fixed start point —
 * never from the previous sample, so a wobbly finger that reverses
 * direction mid-gesture doesn't re-trigger the decision). Below the slop on
 * BOTH axes: "undecided" — callers must apply neither vertical tracking nor
 * horizontal release yet. Once cleared: whichever axis has the larger
 * magnitude wins, decided once for the rest of the gesture (an exact tie
 * goes to "horizontal" — declining to claim is the safer default, since a
 * wrongly-claimed vertical gesture blocks the camera's horizontal pan
 * entirely, while a wrongly-released horizontal gesture just misses one
 * scroll tick that the next move corrects).
 *
 * Deliberately unaware of touch COUNT (pinch/multi-touch) — that's a
 * separate, orthogonal concern folded into `shouldPreventTouchMove` below,
 * not this function, so each stays independently testable.
 */
export function classifyTouchGestureDirection(dx: number, dy: number): TouchGestureOwnership {
  if (Math.abs(dx) < TOUCH_DIRECTION_SLOP_PX && Math.abs(dy) < TOUCH_DIRECTION_SLOP_PX) {
    return "undecided";
  }
  return Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
}

/**
 * Whether a native `touchmove` should be `preventDefault()`-ed, blocking the
 * browser's own page-pan gesture engine from running SIMULTANEOUSLY with
 * Scene's JS vertical pan — device-confirmed necessary (see SceneColumn's
 * touch-pan block doc comment): `touch-action: pan-x pinch-zoom` computes
 * correctly on iOS Safari but isn't reliably honored over Scene's
 * transformed subtree, so explicit `preventDefault()` is the load-bearing
 * layer, not touch-action alone.
 *
 * Multi-touch is NEVER claimed regardless of `ownership` — a single-finger
 * vertical claim decided before a second finger joins must not go on
 * blocking the browser's native pinch-zoom once the gesture becomes a
 * pinch.
 */
export function shouldPreventTouchMove(ownership: TouchGestureOwnership, touchCount: number): boolean {
  if (touchCount > 1) return false;
  return ownership === "vertical";
}

// ---------------------------------------------------------------------------
// Touch release velocity (F13 commit 2)
// ---------------------------------------------------------------------------

/** A single (timestamp, scroll offset) sample from an active touch drag. */
export interface VelocitySample {
  /** `performance.now()` at the time of this sample, in ms. */
  t: number;
  /** The column's scroll offset at this sample. */
  offset: number;
}

/**
 * Ceiling (px/s) on a computed release velocity — an iOS-realistic bound on
 * how fast a real finger flick can plausibly be. Clamps out the physically
 * impossible spikes event-timing jitter can otherwise produce (e.g. two
 * samples landing in the same animation frame with a near-zero `dt`, which
 * would blow the delta/dt ratio up arbitrarily).
 */
export const MAX_FLING_VELOCITY = 4000;

/** How far back (ms) `computeReleaseVelocity` looks for samples to average over. */
export const TOUCH_VELOCITY_WINDOW_MS = 100;

/**
 * A release counts as "the finger was already still" (zero velocity, no
 * fling) once the newest sample in the window is this many ms old —
 * distinguishes a deliberate hold-then-release from a genuine flick that
 * happens to have its last sample land slightly before the up event.
 */
export const TOUCH_VELOCITY_STALE_MS = 80;

/**
 * Computes a touch-release velocity (px/s) from a ring buffer of recent
 * drag samples, own-tracked by SceneColumn rather than read from
 * `scrollY.getVelocity()` at release time — see SceneColumn's own doc
 * comment on `handleContentPointerUp` for why a MotionValue's velocity
 * tracking is unreliable exactly at a pointer release (a 30ms window-based
 * cache that a fast release can land just outside of, plus it silently
 * inflates when a mid-coast compensation event has just jumped the value).
 * This tracker sidesteps both: it only ever looks at genuine drag samples,
 * never at anything Motion itself wrote.
 *
 * - Samples older than `TOUCH_VELOCITY_WINDOW_MS` before `now` are ignored.
 * - Fewer than 2 samples survive that filter, OR the newest surviving
 *   sample is already `TOUCH_VELOCITY_STALE_MS` old (the finger stopped
 *   moving before lifting — a deliberate hold, not a flick) → 0.
 * - Otherwise: the average velocity across the surviving window (oldest to
 *   newest sample), clamped to `±MAX_FLING_VELOCITY`.
 */
export function computeReleaseVelocity(samples: VelocitySample[], now: number): number {
  const recent = samples.filter((s) => now - s.t <= TOUCH_VELOCITY_WINDOW_MS);
  if (recent.length < 2) return 0;

  const newest = recent[recent.length - 1]!;
  if (now - newest.t > TOUCH_VELOCITY_STALE_MS) return 0;

  const oldest = recent[0]!;
  const dt = newest.t - oldest.t;
  if (dt <= 0) return 0;

  const raw = ((newest.offset - oldest.offset) / dt) * 1000;
  return Math.max(-MAX_FLING_VELOCITY, Math.min(MAX_FLING_VELOCITY, raw));
}

/**
 * Ceiling (px/s) on the velocity a spring-chase retarget (wheel/keyboard/
 * scrollbar — every non-fling scroll command) inherits from scrollY's own
 * internally-tracked velocity. F17: same rationale as MAX_FLING_VELOCITY —
 * near-zero-dt samples blow a delta/dt velocity estimate up arbitrarily —
 * but pinned at a DIFFERENT source: a real trackpad/wheel stream fires
 * multiple events per animation frame, and each one used to retarget
 * scrollY's spring immediately and synchronously, so pairs of retargets
 * landed with ~0ms elapsed between them (measured: 72 of 143 inter-retarget
 * gaps were <1ms in a real wheel-stream probe). Motion reads scrollY's own
 * velocity cache to chase-retarget a spring, and that cache is exactly what
 * a near-zero-dt pair corrupts — measured live values reaching ~1992px
 * against a 1082px maxScroll (implied instantaneous velocities in the tens
 * of thousands of px/s) during an otherwise-ordinary trackpad-style scroll.
 * Set well above any plausible LEGITIMATE single-frame wheel/trackpad
 * velocity (a fast two-finger swipe's largest single-frame delta is
 * unlikely to exceed a few hundred px over one ~16ms frame, i.e. a few
 * thousand px/s) so real fast scrolling is never damped, while still
 * catching the pathological spike class by a wide margin.
 */
export const MAX_SPRING_RETARGET_VELOCITY = 12000;

/**
 * Clamps a spring-chase retarget's inherited velocity (read from scrollY's
 * own tracking at retarget time) to `±MAX_SPRING_RETARGET_VELOCITY` — see
 * that constant's own doc comment for the mechanism this closes. A pure
 * function (mirrors computeReleaseVelocity's own shape) so the clamp itself
 * is unit-testable without any Motion/DOM dependency.
 */
export function clampSpringRetargetVelocity(rawVelocity: number): number {
  return Math.max(-MAX_SPRING_RETARGET_VELOCITY, Math.min(MAX_SPRING_RETARGET_VELOCITY, rawVelocity));
}

/**
 * Margin (px) a spring-chase retarget's LIVE VALUE may transiently exceed
 * [0, maxScroll] by before a corrective retarget pulls it back toward the
 * nearest bound. Mirrors the fling's own boundary-catch conceptually (see
 * startInertiaFlingRef's `min`/`max` inertia options in SceneColumn) —
 * reused here because a plain spring generator (unlike Motion's
 * `type: "inertia"`) has no built-in boundary clamp of its own. A small,
 * NONZERO margin (not a hard wall at exactly 0/maxScroll) deliberately
 * tolerates a single well-damped spring's own natural, expected overshoot
 * past its target — only a runaway EXCEEDING this margin (from repeated
 * same-frame retargeting compounding momentum faster than damping can
 * dissipate it, F17's pinned mechanism) triggers the correction.
 */
export const SPRING_RUBBER_BAND_MARGIN_PX = 40;
