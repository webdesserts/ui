import React, {
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../utils/cn";
import { SceneScrollContext } from "./SceneScrollView";
// SceneColumn is imported here for auto-wrapping bare children. SceneColumn
// also imports from this file (ColumnContext, useSceneContext), creating a
// cycle — but this is safe in bundlers like Vite because by the time Scene
// renders, both modules are fully evaluated.
import { SceneColumn } from "./SceneColumn";
import {
  boundsToRect,
  getOffsetBounds,
  getTotalBounds,
  type Bounds,
} from "../utils/bounds";

// ---------------------------------------------------------------------------
// SceneContext — shared registry between Scene and SceneObject
// ---------------------------------------------------------------------------

type SceneEntry = { element: HTMLElement; focused: boolean; size: { width: number; height: number } };

interface SceneContextValue {
  register(id: string, element: HTMLElement, focused: boolean, size?: { width: number; height: number }): void;
  unregister(id: string): void;
  entries: Map<string, SceneEntry>;
  stiffness: number;
  damping: number;
  padding: number;
  duration: number | undefined;
}

const SceneContext = createContext<SceneContextValue | null>(null);

export function useSceneContext(): SceneContextValue {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("SceneObject must be used inside a Scene");
  return ctx;
}

// ---------------------------------------------------------------------------
// ColumnContext — communicates column membership from SceneColumn to SceneObject
// ---------------------------------------------------------------------------

/**
 * Per-child animation offsets for a vertical swap. Each child's `init` value
 * is the starting translateY (placed off-screen) and `settle` is where it
 * animates to (incoming → 0, outgoing → ±columnHeight).
 */
export interface SwapState {
  children: Map<string, { init: number; settle: number }>;
  phase: "init" | "settle";
}

export interface ColumnContextValue {
  columnId: string;
  /** Called by SceneObject children to register their ID with the column. */
  registerChild(childId: string): void;
  /** Called by SceneObject children to unregister their ID from the column. */
  unregisterChild(childId: string): void;
  /** Active vertical swap animation state, or null when no swap is in progress. */
  swapState: SwapState | null;
}

export const ColumnContext = createContext<ColumnContextValue | null>(null);

// ---------------------------------------------------------------------------
// CameraContext — exposes camera state to consumers via useCamera()
// ---------------------------------------------------------------------------

/** Current state of the Camera's animated viewport. */
export interface CameraState {
  bounds: { top: number; left: number; width: number; height: number };
  transitioning: boolean;
}

const CameraContext = createContext<CameraState>({
  bounds: { top: 0, left: 0, width: 0, height: 0 },
  transitioning: false,
});

/** Returns the current camera state — bounds and whether a transition is in flight. */
export function useCamera(): CameraState {
  return useContext(CameraContext);
}

// ---------------------------------------------------------------------------
// CenteringContext — provides per-axis centering offsets to SceneColumn
// ---------------------------------------------------------------------------

/** Translation offsets to center focused content within the viewport. */
export interface CenteringOffset {
  x: number;
  y: number;
}

const CenteringContext = createContext<CenteringOffset>({ x: 0, y: 0 });

/**
 * Returns the current centering offset that focused SceneColumns should apply
 * as a transform. The offset is positive when focused content is smaller than
 * the viewport (content gets centered), and zero when content overflows.
 */
export function useCenteringOffset(): CenteringOffset {
  return useContext(CenteringContext);
}

// ---------------------------------------------------------------------------
// Camera (internal) — reads entries, computes bounds, renders flex container
// ---------------------------------------------------------------------------

interface CameraProps {
  children: React.ReactNode;
  className?: string;
  stiffness: number;
  damping: number;
  padding: number;
  duration: number | undefined;
  entries: Map<string, SceneEntry>;
}

function Camera({
  children,
  className,
  padding,
  duration,
  entries,
}: CameraProps) {
  // null when Camera is not wrapped in a SceneScrollView.
  const scrollCtx = useContext(SceneScrollContext);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  // Track viewport dimensions via ResizeObserver so centering stays accurate
  // when the container resizes (e.g. window resize, panel expand).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const observer = new ResizeObserver((observerEntries) => {
      const entry = observerEntries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setViewportSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const allEntries = Array.from(entries.values());
  const focusedEntries = allEntries.filter((e) => e.focused);
  // Fall back to all entries when nothing is explicitly focused.
  const targetEntries = focusedEntries.length > 0 ? focusedEntries : allEntries;

  let targetBounds: Bounds = { top: 0, left: 0, bottom: 0, right: 0 };
  if (targetEntries.length > 0) {
    targetBounds = getTotalBounds(
      targetEntries.map((e) => getOffsetBounds(e.element)),
    );
  }

  // Apply padding by expanding the bounds outward.
  const paddedBounds: Bounds = {
    top: targetBounds.top - padding,
    left: targetBounds.left - padding,
    bottom: targetBounds.bottom + padding,
    right: targetBounds.right + padding,
  };

  const rect = boundsToRect(paddedBounds);

  // Keep scrollCtx reference alive to avoid breaking SceneScrollView consumers,
  // even though scroll-driven layout is not wired in this phase.
  void scrollCtx;

  // Bounds are informational — no longer driving animation in this phase.
  // transitioning is false until layout animations are added in Commit 1b.
  const cameraState: CameraState = {
    bounds: {
      top: paddedBounds.top,
      left: paddedBounds.left,
      width: rect.width,
      height: rect.height,
    },
    transitioning: false,
  };

  // Compute centering offsets: center focused content when it fits within the
  // viewport, align to top-left (offset = 0) when it overflows.
  //
  // For the Y axis, we measure content height from focused SceneObject elements
  // (data-focused="true") rather than column offsetHeight, because columns use
  // items-stretch and match the full viewport height, not the content height.
  let focusedContentWidth = 0;
  let focusedContentHeight = 0;

  if (viewportRef.current) {
    const focusedColumns = viewportRef.current.querySelectorAll<HTMLElement>('[data-column-focused="true"]');
    focusedColumns.forEach((col) => {
      focusedContentWidth += col.offsetWidth;
      // Measure content height from focused objects inside the column, not the
      // column itself (which stretches to viewport height via items-stretch).
      const focusedObjects = col.querySelectorAll<HTMLElement>('[data-focused="true"]');
      focusedObjects.forEach((obj) => {
        focusedContentHeight = Math.max(focusedContentHeight, obj.scrollHeight);
      });
    });
  }

  const centeringOffset: CenteringOffset = {
    x: Math.max(0, (viewportSize.width - focusedContentWidth) / 2),
    y: Math.max(0, (viewportSize.height - focusedContentHeight) / 2),
  };

  void duration;

  return (
    <CameraContext.Provider value={cameraState}>
      <CenteringContext.Provider value={centeringOffset}>
        {/* Viewport — a flex row that always fills its container. Focused
            SceneObjects participate in the flex layout; unfocused ones are
            positioned absolute and hidden until freeze/unfreeze is added. */}
        <div
          ref={viewportRef}
          data-testid="camera-viewport"
          className={cn("w-full h-full flex flex-row items-stretch overflow-visible relative transition-none", className)}
        >
          {children}
        </div>
      </CenteringContext.Provider>
    </CameraContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Scene (public) — top-level wrapper, owns the entry registry
// ---------------------------------------------------------------------------

export interface SceneProps {
  children: React.ReactNode;
  className?: string;
  /** Spring stiffness. Default: 120 */
  stiffness?: number;
  /** Spring damping. Default: 30 */
  damping?: number;
  /** Padding around focused bounds in px (uniform). Default: 0 */
  padding?: number;
  /** Override spring physics with a fixed duration in ms. Useful for tests. When set to 0, animations are instant. */
  duration?: number;
}

// ---------------------------------------------------------------------------
// Auto-wrapping — bare SceneObjects get implicit single-item SceneColumns
// ---------------------------------------------------------------------------

/**
 * Checks if a React element is already a SceneColumn by looking at its
 * displayName. Using displayName avoids importing SceneColumn here, which
 * would create a circular dependency (SceneColumn already imports from Scene).
 */
function isSceneColumn(child: React.ReactElement): boolean {
  const type = child.type as { displayName?: string };
  return type?.displayName === "SceneColumn";
}

/**
 * Wraps any direct child that is NOT already a SceneColumn in an implicit
 * single-item SceneColumn. This ensures all SceneObjects participate in the
 * column-based layout regardless of whether the consumer uses SceneColumn
 * explicitly or places SceneObjects directly inside Scene.
 *
 * The implicit column takes its name from the child's `key` or `name` prop
 * to maintain stable React identity across re-renders.
 */
function wrapBareChildren(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    if (isSceneColumn(child)) return child;

    // Use the child's key or name prop for the column's name so React can
    // maintain stable identity across re-renders without remounting.
    const childProps = child.props as { name?: string };
    const columnName = child.key ?? childProps?.name;

    return (
      <SceneColumn name={columnName ?? undefined}>
        {child}
      </SceneColumn>
    );
  });
}

/**
 * A spatial navigation container that frames focused objects in a flex row.
 *
 * Wrap layout regions in `SceneObject` with `focused` to control which objects
 * participate in the visible flex layout. Unfocused objects are removed from
 * flow and hidden until freeze/unfreeze animations are added.
 *
 * @example
 * <Scene stiffness={120} damping={30}>
 *   <SceneObject focused={step === 0}><StepOne /></SceneObject>
 *   <SceneObject focused={step === 1}><StepTwo /></SceneObject>
 * </Scene>
 */
export function Scene({
  children,
  className,
  stiffness = 120,
  damping = 30,
  padding = 0,
  duration,
}: SceneProps) {
  const [entries, setEntries] = useState<Map<string, SceneEntry>>(new Map());

  const register = (
    id: string,
    element: HTMLElement,
    focused: boolean,
    size: { width: number; height: number } = { width: 0, height: 0 },
  ) => {
    setEntries((prev) => {
      const next = new Map(prev);
      next.set(id, { element, focused, size });
      return next;
    });
  };

  const unregister = (id: string) => {
    setEntries((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const wrappedChildren = wrapBareChildren(children);

  return (
    <SceneContext.Provider
      value={{ register, unregister, entries, stiffness, damping, padding, duration }}
    >
      <Camera
        className={className}
        stiffness={stiffness}
        damping={damping}
        padding={padding}
        duration={duration}
        entries={entries}
      >
        {wrappedChildren}
      </Camera>
    </SceneContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// SceneObject (public) — registers a child element with the Scene
// ---------------------------------------------------------------------------

export interface SceneObjectProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional name for debugging. Auto-generated via useId() if omitted. */
  name?: string;
  /** Whether this object participates in the visible flex layout. */
  focused: boolean;
  children: React.ReactNode;
}

/** Dimensions and column-relative position captured when an object leaves focus. */
type FrozenStyle = { left: number; top: number; width: number; height: number };

/**
 * A focusable object within a Scene. Set `focused` to true to include this
 * object in the visible flex row.
 *
 * When an object transitions from focused to unfocused, it freezes at its last
 * rendered dimensions and position (absolutely placed within the Scene's flex
 * container). When it has never been focused, it's hidden with `opacity: 0`
 * until it receives focus for the first time.
 */
export const SceneObject = forwardRef<HTMLDivElement, SceneObjectProps>(
  function SceneObject({ name, focused, children, ...htmlProps }, forwardedRef) {
    const generatedId = useId();
    const id = name ?? generatedId;
    const internalRef = useRef<HTMLDivElement>(null);
    const { register, unregister, duration } = useSceneContext();
    const columnCtx = useContext(ColumnContext);

    // Dimensions and position captured at the moment this object lost focus.
    // null means the object has never been focused (hidden on first render).
    const [frozenStyle, setFrozenStyle] = useState<FrozenStyle | null>(null);

    // Track previous focused state to detect focus transitions.
    const prevFocusedRef = useRef(focused);

    // When inside a column with an active swap, defer the freeze until the swap
    // completes. This keeps the outgoing object in flow (position:relative) during
    // the slide-out animation instead of snapping it to absolute immediately.
    // State (not ref) so the render reads a consistent value.
    const [pendingFreeze, setPendingFreeze] = useState(false);

    useLayoutEffect(() => {
      const wasFocused = prevFocusedRef.current;
      prevFocusedRef.current = focused;

      if (wasFocused && !focused && internalRef.current) {
        const swapActive = columnCtx?.swapState !== null && columnCtx?.swapState !== undefined;
        if (swapActive) {
          // Swap will fire the freeze when it completes via the effect below.
          setPendingFreeze(true);
        } else {
          // Focused → unfocused: capture position and size for the freeze.
          const el = internalRef.current;
          setFrozenStyle({
            left: el.offsetLeft,
            top: el.offsetTop,
            width: el.offsetWidth,
            height: el.offsetHeight,
          });
        }
      }
    }, [focused, columnCtx?.swapState]);

    // When the swap completes (swapState → null), fire any deferred freeze.
    useLayoutEffect(() => {
      if (pendingFreeze && !columnCtx?.swapState && internalRef.current) {
        setPendingFreeze(false);
        const el = internalRef.current;
        setFrozenStyle({
          left: el.offsetLeft,
          top: el.offsetTop,
          width: el.offsetWidth,
          height: el.offsetHeight,
        });
      }
    }, [pendingFreeze, columnCtx?.swapState]);

    useLayoutEffect(() => {
      if (!internalRef.current) return;
      const element = internalRef.current;
      register(id, element, focused);

      // When inside a SceneColumn, register this object as a column child so
      // the column can derive its own focus state from its children.
      if (columnCtx) {
        columnCtx.registerChild(id);
      }

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        register(id, element, focused, { width, height });
      });
      observer.observe(element);

      return () => {
        observer.disconnect();
        unregister(id);
        if (columnCtx) {
          columnCtx.unregisterChild(id);
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- register/unregister
    // close over stable setEntries; columnCtx is stable for the SceneObject's
    // mount lifetime (objects don't move between columns).
  }, [id, focused]);

    // When inside a SceneColumn, the column is the flex item — the object itself
    // uses position:relative for focused and the same freeze pattern for unfocused,
    // but does NOT set flex shorthand (that would conflict with the column's flex role).
    const focusedStyle: React.CSSProperties = columnCtx
      ? { position: "relative" as const }
      : { flex: "0 1 auto" as const, minWidth: 0, position: "relative" as const };

    // During an active swap, the outgoing object (unfocused with a pending freeze)
    // should stay in flow for the slide animation. Override the absolute positioning
    // until the swap completes and the freeze fires.
    const isSwappingOut = pendingFreeze && !!columnCtx?.swapState;

    const unfocusedStyle: React.CSSProperties = isSwappingOut
      // Keep in flow during the swap so transform animation is visible.
      ? { position: "relative" as const }
      : frozenStyle
        // Previously focused: pin at exact frozen dimensions so the element
        // appears to stay in place visually as it exits the flex layout.
        ? { position: "absolute", left: frozenStyle.left, top: frozenStyle.top, width: frozenStyle.width, height: frozenStyle.height }
        // Never been focused: hide until first focus.
        : { position: "absolute", opacity: 0 };

    // Apply vertical swap transforms when a swap is in progress for this object.
    const swapEntry = columnCtx?.swapState?.children.get(id);
    let swapStyle: React.CSSProperties = {};
    if (swapEntry) {
      const y = columnCtx!.swapState!.phase === "init" ? swapEntry.init : swapEntry.settle;
      swapStyle = {
        transform: `translateY(${y}px)`,
        ...(columnCtx!.swapState!.phase === "settle"
          ? { transition: `transform ${duration ?? 300}ms ease-out` }
          : {}),
      };
    }

    return (
      <div
        ref={(node) => {
          (internalRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        data-scene-id={id}
        data-focused={focused}
        {...htmlProps}
        style={{
          ...htmlProps.style,
          ...(focused ? focusedStyle : unfocusedStyle),
          ...swapStyle,
        }}
      >
        <div inert={!focused || undefined}>
          {children}
        </div>
      </div>
    );
  },
);
