import React, {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { SceneObject, type SceneObjectProps } from "./SceneObject";
import { useSceneConfig } from "./useSceneConfig";
import { ViewportContext } from "./ViewportContext";
import { ColumnPositionContext } from "./ColumnPositionContext";
import { DepthDeckContext } from "./DepthDeckContext";
import { StackDepthContext } from "./StackDepthContext";
import { ScrollOffsetStoreContext } from "./ScrollOffsetStoreContext";
import { ScrollCommandRegistryContext } from "./ScrollCommandRegistryContext";
import { useAnimationCallbacks } from "./AnimationCallbackContext";
import { SceneFirstPaintContext } from "./SceneFirstPaintContext";
import { useMotionSeam } from "./motionSeam";
import { computeDepthTreatment, formatGrayscale } from "./depth";
import { Scrollbar } from "./Scrollbar";
import type { FrozenSize } from "./types";
import { isInteractiveElement, mapScrollKeyToCommand, type ScrollCommand } from "./inputController";

// ---------------------------------------------------------------------------
// ColumnContext — lets SceneObjects register their elements and report their
// natural heights to the parent column.
// ---------------------------------------------------------------------------

/**
 * Depth info for an unfocused SceneObject that is sandwiched between two
 * focused siblings within the same column. These objects receive depth-deck
 * visual treatment (opacity, greyscale, scale) and are positioned to peek
 * above the lower focused sibling rather than being hidden.
 */
export interface WithinColumnDepthInfo {
  /** Depth index: 1 = adjacent to the lower focused sibling, increasing outward. */
  depth: number;
  /**
   * Content-wrapper-relative top position (px) of the lower focused sibling.
   * The SceneObject uses this to position itself peeking above that sibling.
   */
  anchorTop: number;
}

interface ColumnRegistration {
  /** Register a SceneObject's outer element. Returns an unregister function. */
  register: (name: string, el: HTMLElement) => () => void;
  /**
   * Whether the parent column is in the depth deck (in-between, unfocused).
   * When true, unfocused SceneObjects stay in flow (position: relative) so the
   * column sizes to its content — necessary for perspective-depth width comparison.
   */
  isInDepthDeck: boolean;
  /**
   * Depth info for unfocused SceneObjects sandwiched between two focused
   * siblings. Objects not in this map receive normal (hidden) treatment.
   */
  withinColumnDepths: Map<string, WithinColumnDepthInfo>;
}

export const ColumnContext = createContext<ColumnRegistration | null>(null);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derives whether any direct SceneObject child is currently focused. */
function deriveColumnFocused(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some(
    (child) =>
      isValidElement<SceneObjectProps>(child) &&
      child.type === SceneObject &&
      child.props.focused === true,
  );
}

/** A direct SceneObject child's focus state and reset preference, in DOM order. */
interface ObjectState {
  name: string;
  focused: boolean;
  resetAlignment: "top" | "center";
}

/**
 * Derives all direct SceneObject children's focus state in DOM order.
 * Returns an array of `{ name, focused, resetAlignment }` entries.
 */
function deriveObjectStates(children: React.ReactNode): ObjectState[] {
  const result: ObjectState[] = [];
  React.Children.forEach(children, (child) => {
    if (
      isValidElement<SceneObjectProps>(child) &&
      child.type === SceneObject
    ) {
      result.push({
        name: child.props.name,
        focused: child.props.focused,
        resetAlignment: child.props.resetAlignment ?? "top",
      });
    }
  });
  return result;
}

/**
 * Joins the names of all currently-focused objects (sorted, so the key is
 * independent of DOM order) into a single string key. Used by the swap-reset
 * scroll model (A2) to distinguish an unchanged inner focus arrangement
 * (park/return — restore) from a within-column swap (reset).
 */
function computeFocusedObjectKey(objectStates: ObjectState[]): string {
  return objectStates
    .filter((o) => o.focused)
    .map((o) => o.name)
    .sort()
    .join(",");
}

/** A registered object's measured position within its column's content wrapper. */
interface GeometryEntry {
  /** Distance (px) from the content wrapper's top edge to this object's top edge. */
  offsetTop: number;
  /** This object's rendered height (px). */
  height: number;
}

/**
 * Computes the vertical offset (in px) that the content wrapper must slide to
 * bring the (single) focused object into view at the top of the column.
 * Returns 0 when multiple objects are focused (stacking — show from top) or
 * when no objects are focused.
 *
 * Reads the focused object's own measured offsetTop directly from the
 * geometry store — every registered object (focused or not, except
 * within-column depth cards) stays in flow, so its rendered offset already
 * reflects the real cumulative height (and gap) of everything before it,
 * with no need to sum anything here.
 */
function computeTopOffset(
  objectStates: ObjectState[],
  geometryStore: Map<string, GeometryEntry>,
): number {
  const focusedNames = objectStates
    .filter((o) => o.focused)
    .map((o) => o.name);

  // Multi-focus stacking: show from top, no offset
  if (focusedNames.length !== 1) return 0;

  const focusedName = focusedNames[0]!;
  return geometryStore.get(focusedName)?.offsetTop ?? 0;
}

/**
 * Identifies unfocused SceneObjects that are sandwiched between two focused
 * siblings in DOM order and computes depth info for each. These objects will
 * peek out above the lower focused sibling rather than being hidden.
 *
 * Depth index counts from the lower focused sibling outward: the unfocused
 * object immediately above the lower focused object is depth-1, the next one
 * is depth-2, and so on.
 *
 * Returns a Map from object name → `{ depth, anchorTop }` for every between-
 * unfocused object. Objects that are not sandwiched are absent from the map.
 */
function computeWithinColumnDepths(
  objectStates: ObjectState[],
  geometryStore: Map<string, GeometryEntry>,
): Map<string, WithinColumnDepthInfo> {
  const result = new Map<string, WithinColumnDepthInfo>();
  const n = objectStates.length;

  // For each unfocused object, check whether there is a focused object both
  // before it and after it in DOM order.
  for (let i = 0; i < n; i++) {
    if (objectStates[i]!.focused) continue;

    const hasFocusedBefore = objectStates.slice(0, i).some((o) => o.focused);
    const focusedAfterIndex = objectStates.slice(i + 1).findIndex((o) => o.focused);
    if (!hasFocusedBefore || focusedAfterIndex === -1) continue;

    // This object is between two focused objects. Find the lower focused sibling
    // (the first focused object after this one in DOM order).
    const lowerFocusedIndex = i + 1 + focusedAfterIndex;

    // Depth = distance from this object to the lower focused sibling.
    // The object immediately above lowerFocused is depth-1, further away is higher.
    const depth = lowerFocusedIndex - i;

    // anchorTop = the lower focused sibling's own measured offsetTop — it is
    // always in flow (focused objects are never depth cards), so its
    // registered geometry already reflects the real cumulative height of
    // everything before it.
    const anchorTop = geometryStore.get(objectStates[lowerFocusedIndex]!.name)?.offsetTop ?? 0;

    result.set(objectStates[i]!.name, { depth, anchorTop });
  }

  return result;
}

/**
 * Sums the rendered heights of every currently-focused object (from the
 * geometry store) plus the gaps between them. This is the focused-content
 * scroll range — a distinct concept from topOffset (strip position): it
 * only ever includes focused content, never unfocused in-flow siblings.
 */
function computeFocusedContentHeight(
  objectStates: ObjectState[],
  geometryStore: Map<string, GeometryEntry>,
  objectGap: number,
): number {
  let focusedHeight = 0;
  let focusedCount = 0;
  for (const { name, focused } of objectStates) {
    if (!focused) continue;
    focusedCount++;
    focusedHeight += geometryStore.get(name)?.height ?? 0;
  }
  if (focusedCount > 1 && objectGap) {
    focusedHeight += (focusedCount - 1) * objectGap;
  }
  return focusedHeight;
}

// ---------------------------------------------------------------------------
// SceneColumn
// ---------------------------------------------------------------------------

export interface SceneColumnProps {
  /** Stable name for this column. Shown in debug mode and used for implicit wrapping. */
  name: string;
  children: React.ReactNode;
  /** Gap (in px) between focused objects in this column's flex stack. Defaults to 0. */
  objectGap?: number;
}

/**
 * A vertical slot within a Scene. Objects inside a column share a horizontal
 * position and swap vertically when focus changes. A column is considered
 * focused if any of its children are focused.
 *
 * Focused columns participate in the Scene's flex row (`position: relative`,
 * `flex: 1 1 0`). Unfocused columns exit the flex flow — they capture their
 * last known size via ResizeObserver, then switch to `position: absolute` with
 * explicit inline width/height (the "freeze"). On re-focus, the frozen size is
 * cleared and motion's `layout` FLIP-animates the column back into flex.
 *
 * Within a column, vertical swap is implemented by spring-animating the `top`
 * property on an inner content wrapper. When focus changes from object A to
 * object B, the column slides its content to bring B into view. Multiple
 * simultaneously focused objects stack vertically (no slide offset).
 *
 * @example
 * <SceneColumn name="nav">
 *   <SceneObject name="nav-panel" focused={view === "nav"}>
 *     <NavPanel />
 *   </SceneObject>
 * </SceneColumn>
 */
export function SceneColumn({ name, children, objectGap = 0 }: SceneColumnProps) {
  const columnFocused = deriveColumnFocused(children);
  const objectStates = deriveObjectStates(children);
  const { duration, stiffness, damping, padding, slowMo, peekOffset } = useSceneConfig();
  const { width: viewportWidth, height: viewportHeight } = useContext(ViewportContext);
  const columnPositions = useContext(ColumnPositionContext);
  const scrollOffsetStore = useContext(ScrollOffsetStoreContext);
  const scrollCommandRegistry = useContext(ScrollCommandRegistryContext);
  const position = columnPositions.get(name) ?? null;
  const stackTargetLeft = useContext(DepthDeckContext);
  const stackDepths = useContext(StackDepthContext);
  const stackDepth = stackDepths.get(name) ?? 0;
  const firstPaintRef = useContext(SceneFirstPaintContext);

  // duration=0 → instant transitions for tests; otherwise use configured spring.
  // slowMo → lazier spring parameters for animation snapshot testing.
  // Declared early (rather than inline near its original JSX use) so the
  // motion pipeline below (driveScrollYRef) can close over it.
  const transition =
    duration === 0
      ? { duration: 0 }
      : slowMo
        ? { type: "spring" as const, stiffness: 30, damping: 8 }
        : { type: "spring" as const, stiffness, damping };

  // S3 motion pipeline: scrollY mirrors scrollOffset (below) as a MotionValue
  // so the content wrapper's `top` can be driven off React's render cycle —
  // touch pan (commit 2) needs 1:1 per-frame writes without forcing a
  // re-render on every pointermove. scrollY represents the JS scroll amount
  // alone (not the swap offset), keeping its bounds naturally [0, maxScroll]
  // for inertia's min/max in commit 2.
  const scrollY = useMotionValue(0);
  // Release velocity is read via scrollY.getVelocity() directly at release
  // time (not useVelocity(scrollY)) — probe-confirmed (fix-round,
  // residual-velocity re-fling): useVelocity's derived value is a CACHED
  // signal that only refreshes on a "change" event or an elapsed animation
  // frame tick, neither of which happens in a same-tick grab->release (a
  // fast tap during a coasting fling) — it would keep reporting the fling's
  // pre-grab velocity indefinitely in that case. getVelocity() is always
  // computed fresh with no caching, so it correctly reflects
  // scrollY.jump()'s velocity-tracking reset (see handleContentPointerDown)
  // even within the same synchronous tick.
  const motionSeam = useMotionSeam();
  useEffect(() => {
    motionSeam?.registerMotionValue(`scrollY:${name}`, scrollY);
  }, [motionSeam, scrollY, name]);

  // Drives scrollY in parallel with the existing scrollOffset React state at
  // every write site below (wheel/keyboard/swap-reset/scrollbar). duration=0
  // uses `.set()` directly (NOT animate(...,{duration:0}) — async completion
  // semantics differ, forecast-gate adjudication #1); otherwise `animate()`
  // retargets the in-flight spring exactly like the old animate={{top}} prop
  // did on every tick (the "spring-chase" feel). Stored in a ref (mirroring
  // this file's viewportHeightRef/maxScrollRef pattern) so the stable-closure
  // effects below (wheel, keyboard — subscribed once via `[]` deps) always
  // call the latest version instead of a stale one captured at mount.
  const driveScrollYRef = useRef<(target: number) => void>(() => {});
  driveScrollYRef.current = (target: number) => {
    if (duration === 0) {
      scrollY.set(target);
    } else {
      const controls = animate(scrollY, target, transition);
      motionSeam?.registerControls(`scrollY:${name}`, controls);
    }
  };

  // Registered SceneObject elements — populated via ColumnContext.
  const registeredEls = useRef<Map<string, HTMLElement>>(new Map());
  // Single measurement layer: every registered object's offsetTop/height,
  // relative to the content wrapper. Bulk-remeasured (a) synchronously after
  // every render via useLayoutEffect and (b) asynchronously by a shared
  // ResizeObserver that catches content growth with no accompanying render.
  // Values from the previous render's remeasure are available during the
  // current render — valid for computing swap offsets since object content
  // doesn't change during a focus-only re-render.
  const geometryStore = useRef<Map<string, GeometryEntry>>(new Map());
  // Fingerprint of the last-remeasured geometry, used to bail out of forcing
  // a re-render (geometryVersion bump) when a ResizeObserver callback fires
  // but nothing actually moved.
  const geometryFingerprintRef = useRef("");
  // Bumped (via setGeometryVersion) only when the ResizeObserver-driven
  // remeasure finds a real change — forces a re-render so topOffset/
  // anchorTop/contentHeight recompute from the fresh geometry. The value
  // itself is never read; only the state update matters.
  const [, setGeometryVersion] = useState(0);
  // The ResizeObserver instance shared by every registered object element
  // plus colRef itself. Created once on mount; register/unregister manage
  // membership as objects mount/unmount.
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // The last measured size while the column was focused. Set to null while
  // focused (no freeze applied) and to a FrozenSize after losing focus.
  const [frozenSize, setFrozenSize] = useState<FrozenSize | null>(null);
  // Content height at the time the column lost focus, used for vertical
  // centering of unfocused columns (so they maintain consistent positioning).
  const [frozenContentHeight, setFrozenContentHeight] = useState(0);

  // Tracks the latest size observed via ResizeObserver while focused.
  const lastObservedSize = useRef<FrozenSize>({ width: 0, height: 0 });
  const colRef = useRef<HTMLDivElement | null>(null);

  // Focused content height tracked via ResizeObserver on the content wrapper.
  // Used to compute vertical centering margin-top and scroll bounds.
  const [contentHeight, setContentHeight] = useState(0);
  const contentWrapperRef = useRef<HTMLDivElement | null>(null);

  // -------------------------------------------------------------------------
  // Vertical scroll state (pure JS — no overflow-y, no proxy divs)
  //
  // scrollOffset drives `top: -scrollOffset` on the content wrapper.
  // maxScroll = contentHeight - viewportHeight (clamped to 0 when content fits).
  // The viewport's wheel handler decides a target column and calls straight
  // into that column's registered applyScrollCommand (S5 input controller,
  // below) with a scrollBy command — no intervening DOM event.
  // -------------------------------------------------------------------------

  const [scrollOffset, setScrollOffset] = useState(0);
  const scrollOffsetRef = useRef(0);

  // Effective viewport height accounts for Scene padding applied to the stage.
  // Padding reduces the usable height, so the scroll range grows accordingly.
  const effectiveViewportHeight = viewportHeight - padding * 2;
  const maxScroll = Math.max(
    0,
    columnFocused && effectiveViewportHeight > 0
      ? contentHeight - effectiveViewportHeight
      : 0,
  );
  const maxScrollRef = useRef(maxScroll);
  maxScrollRef.current = maxScroll;

  // Clamp scrollOffset to [0, maxScroll] whenever maxScroll changes (e.g. on
  // content resize or viewport resize).
  useEffect(() => {
    if (scrollOffsetRef.current > maxScroll) {
      const clamped = Math.min(scrollOffsetRef.current, maxScroll);
      scrollOffsetRef.current = clamped;
      setScrollOffset(clamped);
      driveScrollYRef.current(clamped);
    }
  }, [maxScroll]);

  // Single write-path closure (S5 input controller) for every scroll command
  // source: wheel (via the registry below), keyboard, touch release (fling),
  // and the Scrollbar thumb (pointer-drag and keyboard). Non-fling commands
  // resolve to a target offset and write it through the same triplet
  // (scrollOffsetRef, scrollOffset state, driveScrollYRef) every other write
  // site used to duplicate individually. fling is a real branch of its own —
  // it drives the scrollY MotionValue directly (instant clamp, boundary
  // spring-back, or full inertia decay) rather than the driveScrollYRef
  // triplet, since inertia's physics aren't expressible as a single target +
  // the standard transition chase.
  const applyScrollCommand = useCallback(
    (cmd: ScrollCommand) => {
      if (cmd.type === "fling") {
        if (duration === 0) {
          // Instant mode: inertia has no meaningful instant equivalent — just
          // settle at the clamped release position (forecast-gate plan §2).
          // Clamped defensively — instant mode never runs a fling (this whole
          // branch returns before the inertia code below), so scrollY
          // shouldn't normally be out of bounds here, but the same bound-on-
          // release invariant as the real-mode path below applies if it ever is.
          scrollY.set(Math.max(0, Math.min(maxScrollRef.current, scrollY.get())));
          return;
        }

        // velocity is scrollY.getVelocity(), read directly by the caller at
        // release time — NOT a cached useVelocity() derived value — fix-round,
        // residual-velocity re-fling defect: a cached value only refreshes on
        // a scrollY "change" event or an elapsed animation frame tick,
        // neither of which is guaranteed to have happened yet in a fast
        // grab->release (probe-confirmed: it would still read the pre-grab
        // fling's velocity indefinitely in a same-tick sequence).
        // getVelocity() is always computed fresh, so it correctly reflects
        // handleContentPointerDown's scrollY.jump() reset.
        const velocity = cmd.velocity;

        // Fix-round round 2 (gate finding: 203px drift on a genuinely
        // zero-velocity release): a fresh type:"inertia" animation's
        // checkCatchBoundary(0) engages its boundary-catch spring at GENERATOR
        // CREATION TIME whenever the STARTING keyframe is out of [min,max]
        // bounds — completely independent of the passed velocity (probe-
        // confirmed at source: animate(y, [2029], {type:"inertia", velocity:0,
        // max:1200,...}) still springs 2029->1366 over 300ms). scrollY CAN
        // legitimately sit out of bounds here: it's a snapshot of wherever a
        // PRIOR fling's own rubber-band overshoot was at the exact moment this
        // grab's jump() froze it (the plan's "clamped rubber-band" physics can
        // transiently exceed maxScroll before its own boundary spring pulls it
        // back — a real, verified C4 behavior, not a bug). A genuinely
        // zero-velocity release means the user imparted no momentum, so no
        // inertia/friction decay is warranted here — but the strip must still
        // never come to rest permanently past its scrollable edge (iOS
        // convention; the spec's Touch scenario: "overscroll past the scroll
        // bounds should be clamped"). So: in bounds → leave it exactly where
        // jump() froze it (nothing to correct); out of bounds → spring back to
        // the nearest edge, the same correction an uninterrupted fling's own
        // boundary-catch would eventually have applied.
        if (Math.abs(velocity) < 0.01) {
          const current = scrollY.get();
          const clamped = Math.max(0, Math.min(maxScrollRef.current, current));
          if (current !== clamped) {
            const controls = animate(scrollY, clamped, transition);
            motionSeam?.registerControls(`scrollY:${name}`, controls);
          }
          return;
        }

        // NOTE: deviates from the plan's literal
        // animate(scrollY, undefined, {type:"inertia",...}) — probe-confirmed
        // that resolves internally to keyframes=[null, undefined], which
        // finishes the animation instantly without ever running. Passing an
        // explicit single-element keyframes array with the current value is
        // required for inertia to actually decelerate from here.
        const controls = animate(scrollY, [scrollY.get()], {
          type: "inertia",
          velocity,
          min: 0,
          max: maxScrollRef.current,
          // Reuses Scene's configured spring constants for the boundary bounce
          // so the touch-release feel matches wheel/keyboard's spring physics,
          // rather than introducing a third unrelated set of magic numbers —
          // judgment call: the plan named bounceStiffness/bounceDamping
          // without pinning values.
          bounceStiffness: stiffness,
          bounceDamping: damping,
        });
        motionSeam?.registerControls(`scrollY:${name}`, controls);
        return;
      }

      let nextOffset: number;
      switch (cmd.type) {
        case "scrollBy":
        case "page":
          nextOffset = Math.max(
            0,
            Math.min(maxScrollRef.current, scrollOffsetRef.current + cmd.delta),
          );
          break;
        case "toTop":
          nextOffset = 0;
          break;
        case "toBottom":
          nextOffset = maxScrollRef.current;
          break;
      }
      scrollOffsetRef.current = nextOffset;
      setScrollOffset(nextOffset);
      driveScrollYRef.current(nextOffset);
    },
    [duration, transition, motionSeam, name, stiffness, damping, scrollY],
  );

  // Mirrors driveScrollYRef's ref pattern: the wheel/keyboard effects below
  // subscribe once via `[]` deps for a stable listener across renders, so
  // they read applyScrollCommand through a ref kept fresh every render
  // rather than closing over a possibly-stale version from mount time.
  const applyScrollCommandRef = useRef(applyScrollCommand);
  applyScrollCommandRef.current = applyScrollCommand;

  // Register this column's command applier so Scene's wheel handler can
  // route a decided ScrollCommand straight here (replaces the old
  // 'columnscroll' CustomEvent bridge). Kept fresh as applyScrollCommand's
  // own deps change; only deletes on cleanup if we're still the registered
  // handler for this name (guards a same-name remount race, mirroring this
  // file's other name-keyed store patterns).
  useEffect(() => {
    scrollCommandRegistry.set(name, applyScrollCommand);
    return () => {
      if (scrollCommandRegistry.get(name) === applyScrollCommand) {
        scrollCommandRegistry.delete(name);
      }
    };
  }, [scrollCommandRegistry, name, applyScrollCommand]);

  // Ref to the latest viewport height for use in the keyboard handler (avoids
  // stale closure — we want the current value at the time of the keypress).
  const viewportHeightRef = useRef(viewportHeight);
  viewportHeightRef.current = viewportHeight;

  // Keyboard scroll: intercept arrow/page/home/end keys when keyboard focus is
  // inside this column. Standard scroll amounts match browser conventions.
  // isInteractiveElement (S5 input controller, DELTA-1) is the CURATED
  // exemption gate — a naive [role]/[tabindex] matcher would also exempt this
  // column's own scrollable content wrapper (role="region", tabIndex=0 — D2)
  // and the scrollbar thumb, breaking the tab-to-region-then-arrow-scroll path.
  useEffect(() => {
    const el = colRef.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      // Only handle when this column has focused content to scroll.
      if (maxScrollRef.current <= 0) return;

      if (isInteractiveElement(e.target as Element)) return;

      const cmd = mapScrollKeyToCommand(e.key, e.shiftKey, viewportHeightRef.current);
      if (!cmd) return; // Not a scroll key — don't intercept

      applyScrollCommandRef.current(cmd);
      e.preventDefault();
    };

    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, []);

  // Ref mirrors of render-time values, kept fresh every render so the
  // ResizeObserver callback below (a stable closure, subscribed once on
  // mount) always reads the current values instead of a stale snapshot.
  const objectStatesRef = useRef(objectStates);
  objectStatesRef.current = objectStates;
  const objectGapRef = useRef(objectGap);
  objectGapRef.current = objectGap;
  const columnFocusedRef = useRef(columnFocused);
  columnFocusedRef.current = columnFocused;

  // Bulk-remeasures every registered object's offsetTop/height relative to
  // the content wrapper (the rect-delta technique — invariant under the
  // wrapper's own animated `top`, since both rects shift together). Shared
  // by the per-render layout effect below and the ResizeObserver callback.
  // Returns true when the geometry actually changed (fingerprint bail-out —
  // avoids forcing a re-render on every ResizeObserver callback when
  // nothing moved).
  const remeasureGeometry = useCallback((): boolean => {
    const wrapper = contentWrapperRef.current;
    if (!wrapper) return false;
    const wrapperRect = wrapper.getBoundingClientRect();
    for (const [objName, el] of registeredEls.current) {
      const rect = el.getBoundingClientRect();
      geometryStore.current.set(objName, {
        offsetTop: rect.top - wrapperRect.top,
        height: rect.height,
      });
    }
    const fingerprint = Array.from(geometryStore.current.entries())
      .map(([objName, g]) => `${objName}:${Math.round(g.offsetTop)}:${Math.round(g.height)}`)
      .join(",");
    const changed = fingerprint !== geometryFingerprintRef.current;
    geometryFingerprintRef.current = fingerprint;
    return changed;
  }, []);

  // Compute the top offset during render using geometry captured in the
  // previous render's useLayoutEffect. This is accurate for focus swaps
  // (object content doesn't change when only focus changes) and avoids a
  // two-render cycle.
  const topOffset = computeTopOffset(objectStates, geometryStore.current);

  // Compute depth info for unfocused objects sandwiched between focused siblings.
  // Used to give them peekable depth-card treatment instead of hiding them.
  const withinColumnDepths = computeWithinColumnDepths(objectStates, geometryStore.current);

  // Joined focused-object-name key for this render (see computeFocusedObjectKey).
  // Drives the swap-reset scroll model (A2) below.
  const focusedObjectKey = computeFocusedObjectKey(objectStates);

  // Tracks the key from the last render where this column WAS focused. The
  // save-on-unfocus effect below runs on the render where columnFocused just
  // became false — by then objectStates already reflects "nothing focused"
  // (focusedObjectKey === ""), so this ref preserves what was actually
  // active right before the park. Plain render-time ref mutation (like
  // maxScrollRef above) — safe, no setState involved.
  const lastActiveFocusedKeyRef = useRef("");
  if (columnFocused) {
    lastActiveFocusedKeyRef.current = focusedObjectKey;
  }

  // While the column is focused, snapshot its current dimensions synchronously
  // after each render (useLayoutEffect fires before the browser paints). This
  // ensures `lastObservedSize` is always fresh and doesn't depend on the async
  // ResizeObserver firing before focus is lost.
  useLayoutEffect(() => {
    if (columnFocused && colRef.current) {
      const { width, height } = colRef.current.getBoundingClientRect();
      if (width > 0 || height > 0) {
        lastObservedSize.current = { width, height };
      }
    }
  });

  // Whether this column has ever been focused. Only columns that were
  // previously focused need a frozen size — never-focused columns size to
  // their content naturally (position: absolute, no explicit dimensions).
  const wasEverFocused = useRef(columnFocused);

  // True only on the very first render. Used to detect a freshly mounted
  // column so it can animate in from offscreen rather than appearing at rest.
  const isMountingRef = useRef(true);
  useEffect(() => {
    isMountingRef.current = false;
  }, []);

  // Save scroll offset, focused-object key, and content height when the
  // column transitions to unfocused. Using useLayoutEffect ensures this runs
  // before the useEffect clamping logic — clamping (tied to maxScroll) would
  // zero the ref before we could save it. All three fields live together on
  // the STORE entry (keyed by column name, owned by the parent Scene) rather
  // than a per-instance ref — this is the B7 fix: contentHeightAtSave
  // survives an unmount/remount of a same-named column, where a fresh
  // component instance's own ref would otherwise reset to 0 and defeat the
  // drastic-resize guard below.
  useLayoutEffect(() => {
    if (!columnFocused && wasEverFocused.current) {
      scrollOffsetStore.set(name, {
        offset: scrollOffsetRef.current,
        focusedKey: lastActiveFocusedKeyRef.current,
        contentHeightAtSave: contentWrapperRef.current?.getBoundingClientRect().height ?? 0,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFocused]);

  // Track column focus state: freeze the last size on focus loss, and clear
  // on re-focus. Scroll offset restore/reset lives in the swap-reset effect
  // below (A2) — it needs to react to focusedObjectKey too, to also catch a
  // within-column swap (columnFocused stays true throughout a swap, so a
  // [columnFocused]-only effect like this one would never see it — probe-
  // confirmed: a swap left the prior scroll offset untouched).
  useEffect(() => {
    if (columnFocused) {
      wasEverFocused.current = true;
      // Re-focusing — clear the frozen size so the column returns to flex flow.
      setFrozenSize(null);
      // lastObservedSize while focused is now kept current by the shared
      // geometry ResizeObserver below (single measurement layer) — no
      // per-focus observer needed here.
    } else if (wasEverFocused.current) {
      // Freeze at the last captured dimensions so the column doesn't collapse.
      setFrozenSize({ ...lastObservedSize.current });
      // Save content height for vertical centering of unfocused columns.
      setFrozenContentHeight(contentHeight);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFocused]);

  // Single shared ResizeObserver for this column: observes colRef plus every
  // registered SceneObject element. Created once on mount; register/
  // unregister (below) manage membership as objects mount/unmount. Catches
  // content growth (e.g. an image finishing load) with no accompanying React
  // render — the actual B2 fix. The synchronous per-render remeasure below
  // handles the common case (focus/prop changes); this handles the rest.
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      // Always refresh the cache (cheap; corrected again by the next
      // synchronous per-render remeasure regardless) so a column that later
      // becomes focused starts from reasonably fresh geometry.
      const changed = remeasureGeometry();

      // Only unfocused columns' geometry (colHeight, marginTop) — none of
      // it depends on the geometry store (computeTopOffset/anchorTop/
      // computeFocusedContentHeight all early-return with zero focused
      // objects), so forcing a re-render here would be pure overhead. Worse,
      // an unfocused in-between column sits under CSS perspective/translateZ
      // depth treatment — a rect read after that transform has visually
      // settled reports a foreshortened size, and forcing an otherwise-
      // unnecessary render risks feeding that projected size into
      // unrelated column-level layout math. Bail out entirely.
      if (!columnFocusedRef.current) return;

      setContentHeight(
        computeFocusedContentHeight(objectStatesRef.current, geometryStore.current, objectGapRef.current),
      );
      const colEl = colRef.current;
      if (colEl) {
        const rect = colEl.getBoundingClientRect();
        lastObservedSize.current = { width: rect.width, height: rect.height };
      }
      // Fingerprint bail-out (forecast-gate adjudication): only force a
      // re-render when the geometry actually changed.
      if (changed) setGeometryVersion((v) => v + 1);
    });
    resizeObserverRef.current = observer;
    if (colRef.current) observer.observe(colRef.current);
    for (const el of registeredEls.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [remeasureGeometry]);

  // Measure the content wrapper synchronously after each render (useLayoutEffect
  // fires before the browser paints) so geometry is fresh for the very next
  // render — this is what removes the one-render lag that would otherwise
  // corrupt a same-commit swap-reset decision reading maxScroll. The shared
  // ResizeObserver above keeps geometry current between renders too.
  // Compute focused content height from the sum of focused objects' heights
  // (not the content wrapper's total height, which includes unfocused
  // objects in flow). This ensures scroll range only covers focused content.
  useLayoutEffect(() => {
    remeasureGeometry();
    if (!columnFocused) return;
    setContentHeight(computeFocusedContentHeight(objectStates, geometryStore.current, objectGap));
  });

  // Swap-reset scroll model (A2): decides this column's scroll offset
  // whenever it is focused AND its inner focus arrangement (focusedObjectKey)
  // settles to a new value. [columnFocused, focusedObjectKey] as deps is
  // what unifies BOTH triggers with one mechanism — park→return (columnFocused
  // flips true, same key as when parked) and a within-column swap
  // (columnFocused stays true, key changes) — while a re-render where
  // NEITHER changed (e.g. from unrelated content updates) correctly does not
  // re-run this and clobber active user scrolling.
  //
  // Declared AFTER the remeasure effect above so geometryStore.current is
  // already fresh for THIS commit — reading the still-stale `contentHeight`/
  // `maxScroll` REACT STATE here (which only updates a render later, since
  // state updates don't retroactively affect an already-captured closure)
  // would corrupt resetAlignment:"center"'s maxScroll read at swap time
  // (forecast-gate adjudication #4/riskiest-unknown #2). Computing a fresh
  // value directly from the just-remeasured geometry store sidesteps that
  // lag entirely.
  useLayoutEffect(() => {
    if (!columnFocused) return;

    const freshContentHeight = computeFocusedContentHeight(objectStates, geometryStore.current, objectGap);
    const freshMaxScroll = Math.max(
      0,
      effectiveViewportHeight > 0 ? freshContentHeight - effectiveViewportHeight : 0,
    );

    const entry = scrollOffsetStore.get(name);
    let nextOffset: number;

    if (entry && entry.focusedKey === focusedObjectKey) {
      // Unchanged arrangement (park/return with the same object(s) focused).
      // Drastic-resize guard: a saved offset from before a >50% content
      // change is meaningless — fall back to top. Compares against the
      // STORE's persisted contentHeightAtSave (B7), not a per-instance ref.
      const prevHeight = entry.contentHeightAtSave;
      const isDrasticResize =
        prevHeight > 0 &&
        freshContentHeight > 0 &&
        Math.abs(freshContentHeight - prevHeight) / prevHeight > 0.5;

      nextOffset = isDrasticResize
        ? 0
        // B6: clamp the restored offset to the current maxScroll — a saved
        // position must not outlive a resize that shrank the scrollable
        // range while parked. This clamp is NOT redundant with the
        // pre-existing generic [maxScroll] clamp effect elsewhere in this
        // file: that one is a passive useEffect (runs post-paint), while
        // this swap-reset decision is a useLayoutEffect (runs pre-paint).
        // Without this clamp, the DOM commits and paints one real frame at
        // the raw unclamped offset before the passive effect corrects it —
        // verified via a MutationObserver on data-scroll-offset showing the
        // commit sequence null→0→380→200 with this clamp removed, vs
        // null→0→200 with it present (380 was the saved pre-resize offset,
        // 200 the correct post-resize maxScroll). Do not remove this as a
        // "simplification" on the theory that the passive effect already
        // covers it — no settled-state test can catch that regression,
        // since both paths converge to the same final value; only the
        // transient unclamped frame is observably different.
        : Math.max(0, Math.min(entry.offset, freshMaxScroll));
    } else {
      // A swap (or first-ever focus, or a mismatched/absent entry): reset
      // deterministically per the newly-focused object's resetAlignment.
      // Tie-break (forecast-gate adjudication #2): when 2+ objects become
      // newly focused simultaneously, the FIRST newly-focused one in DOM
      // order governs — objectStates is already in DOM order, so the first
      // match is exactly that.
      const newlyFocused = objectStates.find((o) => o.focused);
      nextOffset = newlyFocused?.resetAlignment === "center" ? freshMaxScroll / 2 : 0;
    }

    scrollOffsetRef.current = nextOffset;
    setScrollOffset(nextOffset);
    driveScrollYRef.current(nextOffset);
    // Keep the store's offset/key in sync so a LATER swap within the same
    // focused session compares against the truly-latest arrangement, not a
    // stale entry from before this column was even refocused (contentHeightAtSave
    // is deliberately NOT touched here — it must only change at the moment
    // of an actual park, so a later drastic-resize check has something
    // meaningful to compare against).
    scrollOffsetStore.set(name, {
      offset: nextOffset,
      focusedKey: focusedObjectKey,
      contentHeightAtSave: entry?.contentHeightAtSave ?? 0,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFocused, focusedObjectKey]);

  // Imperative data-scroll-offset attribute writer (forecast-gate adjudication
  // #2): mirrors SceneObjectOutlines' direct-DOM-mutation pattern rather than
  // React-rendering the attribute from scrollOffset state — scrollY changes
  // per-frame during a fling/wheel chase and must not force a re-render on
  // every tick just to keep this debug/overlay-read attribute current. Syncs
  // immediately on mount and on every columnFocused flip (re-subscribing with
  // a fresh closure), then stays current via the scrollY change subscription.
  useEffect(() => {
    const el = colRef.current;
    if (!el) return;

    const sync = (latest: number) => {
      if (columnFocused) {
        el.setAttribute("data-scroll-offset", String(latest));
      } else {
        el.removeAttribute("data-scroll-offset");
      }
    };

    sync(scrollY.get());
    return scrollY.on("change", sync);
  }, [columnFocused, scrollY]);

  // Vertical centering: center the focused content within the viewport when it
  // fits. When content overflows (contentHeight > viewportHeight), margin is 0
  // and content aligns to the top.
  // Vertical centering for all columns. Focused columns use their live
  // contentHeight. Previously-focused columns use frozenContentHeight.
  // Never-focused columns measure their content wrapper directly.
  let effectiveContentHeight = columnFocused ? contentHeight : frozenContentHeight;
  if (effectiveContentHeight === 0 && contentWrapperRef.current) {
    effectiveContentHeight = contentWrapperRef.current.getBoundingClientRect().height;
  }
  const marginTop =
    viewportHeight > 0 && effectiveContentHeight > 0
      ? Math.max(0, (viewportHeight - effectiveContentHeight) / 2)
      : 0;

  // Registration callback provided to child SceneObjects. Also drives the
  // shared ResizeObserver's membership — newly registered elements join the
  // single measurement layer immediately (or are picked up by the mount
  // effect's initial sweep if the observer hasn't been created yet).
  const register = useCallback((objName: string, el: HTMLElement) => {
    registeredEls.current.set(objName, el);
    resizeObserverRef.current?.observe(el);
    return () => {
      resizeObserverRef.current?.unobserve(el);
      registeredEls.current.delete(objName);
      geometryStore.current.delete(objName);
    };
  }, []);

  // Debug outline tracking: notify the animation counter in SceneViewport when
  // this column's motion animations start or end. The rAF loop in
  // SceneObjectOutlines runs while the counter is > 0. Only active in debug
  // mode — context is null otherwise so callbacks are never called.
  const animCallbacks = useAnimationCallbacks();

  // The combined vertical offset applied to the content wrapper:
  // - topOffset: vertical swap offset (bring focused object into view)
  // - scrollOffset: JS scroll state (driven by wheel events)
  // Both are subtracted so positive values slide the content up. Used only
  // for the instant-mode (duration=0) synchronous style write below — see
  // composedTop for the real-animation equivalent.
  const combinedTop = -(topOffset + scrollOffset);

  // Real-animation equivalent of combinedTop: a MotionValue derived from
  // scrollY (the live, per-tick value) composed with topOffset (a per-render
  // plain number — the swap offset only changes on focus swap, recomputed
  // synchronously each render from fresh geometry). useTransform recombines
  // synchronously on every render with a fresh closure (forecast-gate
  // validated at source: no stale-closure trap), so topOffset here is never
  // stale even though it isn't itself a MotionValue. NOT used in instant mode
  // — forecast-gate adjudication #1: relying on motion's rAF-batched style
  // binding for a synchronous instant-mode write would depend on undocumented
  // same-frame-ordering internals.
  const composedTop = useTransform(scrollY, (so) => -(topOffset + so));

  // position and flex must be in `style` (not `animate`) because motion only
  // animates transforms, opacity, and CSS custom properties — not layout properties.
  // flex: 0 1 auto → columns size to their content by default. Consumers can
  // override via className (e.g. adding flex:1 for equal-share or a fixed width).
  const focusedStyle: React.CSSProperties = {
    position: "relative",
    flex: "0 1 auto",
  };

  // Unfocused in-between columns exit flex flow and stack as a depth deck,
  // positioned behind the rightmost focused column. top:0 anchors them to the
  // stage top so they align with the focused row; x-translation (via animate)
  // slides them to the left edge of the rightmost focused column.
  const inBetweenStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    flex: "none",
    ...(frozenSize ? { width: frozenSize.width, height: frozenSize.height } : {}),
  };

  // Outer unfocused columns stay in the flex row with their frozen size so the
  // Camera can pan past them. No opacity:0 — the viewport clips visibility.
  const outerStyle: React.CSSProperties = {
    position: "relative",
    flex: "0 0 auto",
    ...(frozenSize ? { width: frozenSize.width, height: frozenSize.height } : {}),
  };

  // Select which style applies. Focused columns use focusedStyle; in-between
  // unfocused columns use inBetweenStyle; all other unfocused use outerStyle.
  const columnStyle = columnFocused
    ? focusedStyle
    : position === "in-between"
      ? inBetweenStyle
      : outerStyle;

  // Depth deck visual values for in-between columns. Deeper columns appear
  // smaller (via perspective + translateZ), more transparent, more greyscale,
  // and stacked lower (z-index).
  const isInBetween = position === "in-between" && stackDepth > 0;

  // In-between columns animate toward the rightmost focused column's left edge,
  // then peek out further left by an explicit per-depth offset (A5 — the
  // pull-out-direction principle: a deck card peeks in the direction it
  // travels when pulled from the deck, so a column deck anchored under the
  // right focused column peeks left). Fanned by stackDepth so every deeper
  // card's left edge stays visible past its shallower neighbors. This is a
  // manual offset, not an emergent artifact of perspective projection.
  // Outer columns stay at x:0 — they're in the natural flex row position.
  const animateX = position === "in-between" ? stackTargetLeft - peekOffset * stackDepth : 0;
  // translateZ pushes in-between columns back in 3D space. The stage's
  // perspective (800px) projects them smaller: depth-1 → 800/900 ≈ 0.89×,
  // depth-2 → 800/1000 = 0.80×, depth-3 → 800/1100 ≈ 0.73×.
  // Focused columns explicitly sit at translateZ(0) to participate in the 3D
  // stacking context and always render in front of in-between columns.
  // columnDepth must be declared AFTER isInBetween (variable ordering).
  const columnDepth = isInBetween ? computeDepthTreatment(stackDepth) : { opacity: 1, grayscale: 0, translateZ: 0 };
  // Only in-between columns get depth-scaled opacity. Outer columns are fully
  // opaque — the viewport clips their visibility, not opacity:0.
  const depthOpacity = columnDepth.opacity;
  // Greyscale increases with depth: depth-1 → 25%, depth-2 → 50%, etc.
  // Reinforces the sense of receding into the background.
  const depthGreyscale = columnDepth.grayscale;
  const depthZ = columnDepth.translateZ;
  // z-index is NOT used inside preserve-3d — 3D z-ordering is determined
  // entirely by translateZ values (higher z = closer = rendered in front).

  // In-between columns are position:absolute from the stage top. To visually
  // align them with the focused content (which is centered via marginTop),
  // we translate them down to the vertical center of the viewport.
  // colHeight is the column's frozen or natural height — used for centering.
  // For in-between columns without a frozenSize, skip centering (top-aligned)
  // rather than calling getBoundingClientRect which returns projected sizes
  // inside the preserve-3d context.
  const colHeight = frozenSize?.height ?? (isInBetween ? 0 : (colRef.current?.getBoundingClientRect().height ?? 0));
  const inBetweenY =
    isInBetween && viewportHeight > 0 && colHeight > 0
      ? (viewportHeight - colHeight) / 2
      : 0;

  // A column that mounts for the first time already focused should enter from
  // the right (depth-forward navigation). motion will animate from this initial
  // position to the flex layout position via the layout FLIP mechanism.
  // When duration=0 (tests), motion skips the initial state immediately.
  //
  // Gated on !firstPaintRef.current: during Scene's very first paint every
  // focused column looks like it's "mounting" because isMountingRef.current
  // hasn't been cleared yet. The first-paint ref distinguishes a true
  // mid-session late-mount (slide-in wanted) from first paint (no slide-in).
  const mountInitial =
    isMountingRef.current && !firstPaintRef.current && columnFocused && viewportWidth > 0
      ? { x: viewportWidth }
      : undefined;

  const isScrollable = columnFocused && maxScroll > 0;

  // D2/D4: stable id for the content wrapper, unconditional (not gated on
  // focus/scrollability) so the Scrollbar thumb (D4) always has a valid
  // aria-controls target to reference regardless of when it renders.
  const contentWrapperId = `scene-column-content-${name}`;

  // -------------------------------------------------------------------------
  // Touch pan (1:1 finger tracking + release inertia)
  //
  // Mirrors Scrollbar.tsx's setPointerCapture idiom rather than motion's
  // `drag` prop (transform-based; would abandon the deliberate top/left-not-
  // transform text-quality architecture — see the module doc). Gated on
  // columnFocused && isScrollable (mirrors Scrollbar's conditional render)
  // AND pointerType touch/pen only — mouse drag stays native (text selection
  // preserved; the spec's Touch scenarios are finger-only).
  // -------------------------------------------------------------------------

  const dragStartY = useRef(0);
  const dragStartOffset = useRef(0);
  const isDragging = useRef(false);

  const handleContentPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!columnFocused || !isScrollable) return;
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartOffset.current = scrollOffsetRef.current;
      // A bare .set() does NOT stop an in-flight animate()-driven animation
      // (its own rAF loop keeps overwriting the value — probe-confirmed at
      // source: MotionValue.set() never calls .stop()). A coasting inertia
      // fling from a prior release could still be running here, so it must
      // be stopped explicitly before 1:1 tracking begins.
      // jump() (not stop()) — fix-round, residual-velocity re-fling defect:
      // .stop() halts the animation but leaves scrollY's internal velocity-
      // tracking state (prevFrameValue/prevUpdatedAt) untouched, so a grab
      // followed by a release within motion's MAX_VELOCITY_DELTA (30ms)
      // window would still read the fling's PRE-GRAB velocity and re-fling
      // on release even though the finger never moved. jump(currentValue)
      // resets that tracking state (probe-confirmed: getVelocity() reads 0
      // immediately after, even within the same synchronous tick) while
      // also stopping the animation (jump's endAnimation default calls
      // .stop() internally) — a strict superset of the old .stop() call.
      scrollY.jump(scrollY.get());
      (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    },
    [columnFocused, isScrollable, scrollY],
  );

  const handleContentPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      // 1:1 finger tracking: the finger moving down (deltaY positive) should
      // move the content down too (content "attached" to the finger), which
      // means scrollOffset DECREASES — content top = -(topOffset+scrollOffset).
      const deltaY = e.clientY - dragStartY.current;
      const newOffset = Math.max(
        0,
        Math.min(maxScrollRef.current, dragStartOffset.current - deltaY),
      );
      scrollOffsetRef.current = newOffset;
      scrollY.set(newOffset);
      // React state (setScrollOffset) is skipped per-tick in real mode — the
      // content wrapper's visual position there is driven entirely by the
      // composedTop MotionValue (see the style branch below), so forcing a
      // re-render on every pointermove tick would be pure overhead (the
      // whole reason this pipeline exists). Instant mode DOES need it: its
      // style write is the synchronous plain-number path (combinedTop),
      // derived from scrollOffset state, so it wouldn't move without this.
      if (duration === 0) {
        setScrollOffset(newOffset);
      }
    },
    [duration, scrollY],
  );

  const handleContentPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);

      const releaseOffset = scrollOffsetRef.current;
      // Always sync React state at release (regardless of duration) — keeps
      // the Scrollbar prop and instant-mode style path consistent with the
      // final drag position even though real mode skipped per-tick renders.
      setScrollOffset(releaseOffset);

      // scrollY.getVelocity() called directly, NOT a cached useVelocity()
      // derived value — fix-round, residual-velocity re-fling defect: a
      // cached value only refreshes on a scrollY "change" event or an
      // elapsed animation frame tick, neither of which is guaranteed to have
      // happened yet in a fast grab->release (probe-confirmed: it would
      // still read the pre-grab fling's velocity indefinitely in a same-tick
      // sequence). getVelocity() is always computed fresh, so it correctly
      // reflects handleContentPointerDown's scrollY.jump() reset above.
      // Skipped in instant mode (duration===0) — inertia has no meaningful
      // instant equivalent (forecast-gate plan §2) and applyScrollCommand's
      // fling branch never reads velocity in that case anyway.
      const velocity = duration === 0 ? 0 : scrollY.getVelocity();
      applyScrollCommand({ type: "fling", velocity });
    },
    [duration, scrollY, applyScrollCommand],
  );

  return (
    // isInDepthDeck is true for ALL unfocused columns, not just in-between ones.
    // Outer unfocused columns also need their SceneObjects in flow so the column
    // has natural dimensions (otherwise position: absolute children yield a
    // zero-width column that overlaps with adjacent focused columns).
    <ColumnContext.Provider value={{ register, isInDepthDeck: !columnFocused, withinColumnDepths }}>
      {/* Invariant: animatable properties (opacity, transform, filter) must only be
          set via animate={}, never inline style. Inline style wins at React commit
          time and silently shadows the spring. See depth.ts for the no-shadow rule. */}
      <motion.div
        ref={colRef}
        layout
        {...(mountInitial ? { initial: mountInitial } : firstPaintRef.current ? { initial: false } : {})}
        data-column={name}
        data-column-focused={String(columnFocused)}
        data-column-position={position ?? undefined}
        data-stack-depth={isInBetween ? String(stackDepth) : undefined}
        data-max-scroll={isScrollable ? String(maxScroll) : undefined}
        /* data-scroll-offset is written imperatively via the scrollY
           subscription effect below (forecast-gate adjudication #2), not
           React-rendered — per-tick MotionValue changes during a fling must
           not force a re-render just to update this attribute. */
        data-content-height={columnFocused ? String(contentHeight) : undefined}
        animate={{
          opacity: depthOpacity,
          // Invariant: depth-deck position lives entirely in transform space (x, y,
          // z). Motion's layout FLIP cannot see it. This is why 'layout' must
          // compose with these via animate transforms, never by re-measuring layout
          // boxes.
          x: animateX,
          y: inBetweenY,
          z: depthZ,
          // Always emit a valid filter string — motion cannot interpolate between
          // undefined and a filter string, which caused the unfocus pop (bug 2b).
          filter: formatGrayscale(depthGreyscale),
        }}
        transition={transition}
        onAnimationStart={animCallbacks?.onStart}
        onAnimationComplete={animCallbacks?.onEnd}
        onLayoutAnimationStart={animCallbacks?.onStart}
        onLayoutAnimationComplete={animCallbacks?.onEnd}
        style={columnStyle}
      >
        {/* Content wrapper: spring-animated top offset for vertical swap.
            margin-top centers focused content vertically when it fits the
            viewport. When content overflows, marginTop is 0 (top-aligned).
            display: flex + flex-direction: column lets gap apply between
            focused objects in multi-focus stacking.
            D2: role="region" + aria-label mark this as a navigable landmark
            only while focused (an offscreen/frozen column has nothing a
            screen reader should announce as a region); tabIndex={0} is
            added ADDITIONALLY only when scrollable — a focused-but-fitting
            column has no keyboard scroll behavior to offer, so it isn't a
            tab stop. Every column content wrapper still gets a stable id
            (D4's aria-controls target) regardless of focus/scrollability. */}
        <motion.div
          ref={contentWrapperRef}
          data-column-content
          id={contentWrapperId}
          {...(columnFocused
            ? { role: "region" as const, "aria-label": `${name} content${isScrollable ? ", scrollable" : ""}` }
            : {})}
          {...(isScrollable ? { tabIndex: 0 } : {})}
          initial={false}
          animate={{ marginTop }}
          transition={transition}
          onAnimationStart={animCallbacks?.onStart}
          onAnimationComplete={animCallbacks?.onEnd}
          onPointerDown={handleContentPointerDown}
          onPointerMove={handleContentPointerMove}
          onPointerUp={handleContentPointerUp}
          onPointerCancel={handleContentPointerUp}
          style={{
            position: "relative",
            // Instant mode (duration=0): the synchronous plain-number write,
            // unchanged from before S3 (forecast-gate adjudication #1) — top
            // is NOT MotionValue-driven here.
            // Real animation: top is the composedTop MotionValue, updated
            // off React's render cycle. marginTop still springs via animate
            // above (unchanged) — only its own instant-mode style mirror
            // moves with `duration === 0` here, same as before.
            ...(duration === 0 ? { top: combinedTop, marginTop } : { top: composedTop }),
            display: "flex",
            flexDirection: "column",
            gap: objectGap || undefined,
          }}
        >
          {children}
        </motion.div>

        {/* Custom scrollbar — only rendered when focused content overflows. */}
        {isScrollable && viewportHeight > 0 && (
          <Scrollbar
            scrollOffset={scrollOffset}
            maxScroll={maxScroll}
            trackHeight={viewportHeight}
            controlsId={contentWrapperId}
            onScroll={(newOffset) => {
              // Pointer-drag reports an absolute target offset (computed from
              // track/thumb geometry), not a delta — expressed as a scrollBy
              // command via the delta from the current offset so it goes
              // through the same applyScrollCommand write path as every
              // other scroll source.
              applyScrollCommand({ type: "scrollBy", delta: newOffset - scrollOffsetRef.current });
            }}
            onCommand={applyScrollCommand}
          />
        )}
      </motion.div>
    </ColumnContext.Provider>
  );
}

// Explicit displayName allows Scene to detect SceneColumn children via
// child.type.displayName without importing SceneColumn directly (avoiding
// circular import issues).
SceneColumn.displayName = "SceneColumn";
