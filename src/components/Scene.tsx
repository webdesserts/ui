import React, {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { motion, useMotionValue, useTransform } from "motion/react";
import { cn } from "../utils/cn";
import { SceneScrollContext } from "./SceneScrollView";
import {
  boundsToRect,
  getOffsetBounds,
  getTotalBounds,
  type Bounds,
  type Rect,
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

function useSceneContext(): SceneContextValue {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("SceneObject must be used inside a Scene");
  return ctx;
}

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
// Camera (internal) — reads entries, computes bounds, animates
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
  stiffness,
  damping,
  padding,
  duration,
  entries,
}: CameraProps) {
  const [transitioning, setTransitioning] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // null when Camera is not wrapped in a SceneScrollView.
  const scrollCtx = useContext(SceneScrollContext);

  // Detect prefers-reduced-motion and update reactively.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
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

  const rect: Rect = boundsToRect(paddedBounds);

  // When inside a SceneScrollView, cap the viewport to the available height so
  // the viewport never grows taller than the scroll container.
  const viewportHeight = scrollCtx
    ? Math.min(rect.height, scrollCtx.availableHeight)
    : rect.height;

  const transition =
    duration !== undefined
      ? { duration: duration / 1000 }
      : reducedMotion
        ? { duration: 0 }
        : { type: "spring" as const, stiffness, damping };

  // Report the full (unclamped) content height to SceneScrollView so it can
  // size the spacer div that drives the browser's scroll range.
  useEffect(() => {
    if (scrollCtx) {
      scrollCtx.setContentHeight(rect.height);
    }
  }, [rect.height, scrollCtx]);

  // When the focused target's position changes, scroll back to the top so the
  // new content isn't obscured by a stale scroll offset.
  const prevRectRef = useRef({ x: rect.x, y: rect.y });
  useEffect(() => {
    if (
      scrollCtx &&
      (prevRectRef.current.x !== rect.x || prevRectRef.current.y !== rect.y)
    ) {
      scrollCtx.resetScroll();
    }
    prevRectRef.current = { x: rect.x, y: rect.y };
  }, [rect.x, rect.y, scrollCtx]);

  // Build a negated scroll offset for the scroll-offset div. useTransform must
  // be called unconditionally (React hooks rules), so we always create a
  // fallback MotionValue and use whichever is active.
  const fallbackScrollTop = useMotionValue(0);
  const activeScrollTop = scrollCtx?.scrollTop ?? fallbackScrollTop;
  const negatedScrollY = useTransform(activeScrollTop, (v) => -v);

  const cameraState: CameraState = {
    bounds: {
      top: paddedBounds.top,
      left: paddedBounds.left,
      width: rect.width,
      height: rect.height,
    },
    transitioning,
  };

  return (
    <CameraContext.Provider value={cameraState}>
      {/* Viewport — animates width/height to frame focused objects */}
      <motion.div
        data-testid="camera-viewport"
        animate={{ width: rect.width, height: viewportHeight }}
        transition={transition}
        onAnimationStart={() => setTransitioning(true)}
        onAnimationComplete={() => setTransitioning(false)}
        className={cn("transition-none overflow-visible", className)}
      >
        {/* Stage — animates x/y to pan to the focused area */}
        <motion.div
          data-testid="camera-stage"
          animate={{ x: -rect.x, y: -rect.y }}
          transition={transition}
          className="relative transition-none w-fit h-max"
        >
          {/* When inside a SceneScrollView, offset children by the scroll
              position so the visible slice of content tracks the scrollbar. */}
          {scrollCtx ? (
            <motion.div
              data-testid="camera-scroll-offset"
              style={{ y: negatedScrollY }}
            >
              {children}
            </motion.div>
          ) : (
            children
          )}
        </motion.div>
      </motion.div>
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

/**
 * A 2D scene that frames its focused objects with animated camera movement.
 *
 * Wrap layout regions in `SceneObject` with `focused` to control what the
 * camera frames. When nothing is focused, the camera shows all objects.
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
        {children}
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
  /** Whether the Camera should frame this object. */
  focused: boolean;
  children: React.ReactNode;
}

/**
 * A positioned object within a Scene. Set `focused` to true to tell the
 * camera to frame this object.
 */
export const SceneObject = forwardRef<HTMLDivElement, SceneObjectProps>(
  function SceneObject({ name, focused, children, ...htmlProps }, forwardedRef) {
    const generatedId = useId();
    const id = name ?? generatedId;
    const internalRef = useRef<HTMLDivElement>(null);
    const { register, unregister } = useSceneContext();

    useLayoutEffect(() => {
      if (!internalRef.current) return;
      const element = internalRef.current;
      register(id, element, focused);

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
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- register/unregister
    // close over stable setEntries; including them causes infinite re-renders.
  }, [id, focused]);

    return (
      <div
        ref={(node) => {
          (internalRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        data-focused={focused}
        {...htmlProps}
      >
        <div inert={!focused || undefined}>
          {children}
        </div>
      </div>
    );
  },
);
