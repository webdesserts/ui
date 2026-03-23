import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMotionValue, type MotionValue } from "motion/react";
import { cn } from "../utils/cn";

// ---------------------------------------------------------------------------
// SceneScrollContext — shared state between SceneScrollView and Camera
// ---------------------------------------------------------------------------

/**
 * Exposes scroll state to Camera so it can report content height and reset
 * scroll position when focus changes.
 */
export interface SceneScrollContextValue {
  /** Available viewport height in px, measured from the container. */
  availableHeight: number;
  /** Current scroll offset as a MotionValue for zero-re-render DOM updates. */
  scrollTop: MotionValue<number>;
  /** Current content height as a MotionValue — Camera updates this on layout. */
  contentHeight: MotionValue<number>;
  /** Called by Camera to report how tall the scene content is. */
  setContentHeight: (h: number) => void;
  /** Scrolls the container back to the top. */
  resetScroll: () => void;
}

export const SceneScrollContext =
  createContext<SceneScrollContextValue | null>(null);

// ---------------------------------------------------------------------------
// useSceneScroll — public hook for consumers
// ---------------------------------------------------------------------------

export interface SceneScrollState {
  /** Current scroll offset in px. */
  scrollTop: number;
  /** Height of the scroll container in px. */
  availableHeight: number;
  /** Height of the scene content in px. */
  contentHeight: number;
  /** True when content exceeds available height and the view can scroll. */
  scrollable: boolean;
}

/**
 * Returns reactive scroll state from the nearest `SceneScrollView`. Useful
 * for hiding controls or adapting layout based on scroll position or overflow.
 *
 * Must be used inside a `SceneScrollView`.
 */
export function useSceneScroll(): SceneScrollState {
  const ctx = useContext(SceneScrollContext);
  if (!ctx) {
    throw new Error("useSceneScroll must be used inside a SceneScrollView");
  }

  // Mirror the MotionValues into React state so consumers get re-renders.
  const [scrollTopState, setScrollTopState] = useState(
    ctx.scrollTop.get(),
  );
  const [contentHeightState, setContentHeightState] = useState(
    ctx.contentHeight.get(),
  );

  useLayoutEffect(() => {
    return ctx.scrollTop.on("change", setScrollTopState);
  }, [ctx.scrollTop]);

  useLayoutEffect(() => {
    return ctx.contentHeight.on("change", setContentHeightState);
  }, [ctx.contentHeight]);

  return {
    scrollTop: scrollTopState,
    availableHeight: ctx.availableHeight,
    contentHeight: contentHeightState,
    scrollable: contentHeightState > ctx.availableHeight,
  };
}

// ---------------------------------------------------------------------------
// SceneScrollView (public) — scroll container wrapping a Scene
// ---------------------------------------------------------------------------

export interface SceneScrollViewProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * A scroll container for `Scene`. When the camera's content exceeds the
 * available height, a native scrollbar appears and the scene can be scrolled.
 *
 * Uses `position: sticky` internally: the Scene stays pinned while a spacer
 * div creates the scrollable range. This lets the Camera animate freely while
 * the browser handles scrolling natively.
 *
 * @example
 * <SceneScrollView style={{ height: "100vh" }}>
 *   <Scene>
 *     <SceneObject focused={step === 0}><StepOne /></SceneObject>
 *     <SceneObject focused={step === 1}><StepTwo /></SceneObject>
 *   </Scene>
 * </SceneScrollView>
 */
export function SceneScrollView({ children, className }: SceneScrollViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState(0);

  // MotionValues let Camera read scroll position and report content height
  // without causing React re-renders in SceneScrollView on every update.
  const scrollTop = useMotionValue(0);
  const contentHeight = useMotionValue(0);

  // Spacer height is derived from contentHeight, but we need it in React state
  // to trigger the spacer div re-render. We update it only when the value
  // changes, rather than on every frame.
  const [scrollHeight, setScrollHeight] = useState(0);

  // Measure container height and keep it updated on resize.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const height = entry.contentRect.height;
        setAvailableHeight(height);
        // Keep spacer at least as tall as the container.
        setScrollHeight((prev) =>
          Math.max(contentHeight.get(), height) !== prev
            ? Math.max(contentHeight.get(), height)
            : prev,
        );
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [contentHeight]);

  // Sync scroll position to the MotionValue without triggering React re-renders.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      scrollTop.set(container.scrollTop);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [scrollTop]);

  const setContentHeight = (h: number) => {
    if (h === contentHeight.get()) return;
    contentHeight.set(h);
    setScrollHeight((prev) => {
      const next = Math.max(h, availableHeight);
      return next !== prev ? next : prev;
    });
  };

  const resetScroll = () => {
    containerRef.current?.scrollTo({ top: 0 });
    scrollTop.set(0);
  };

  const contextValue: SceneScrollContextValue = {
    availableHeight,
    scrollTop,
    contentHeight,
    setContentHeight,
    resetScroll,
  };

  return (
    <div
      ref={containerRef}
      className={cn("overflow-y-auto", className)}
      style={{ height: "100%" }}
    >
      {/* Spacer that creates the scrollable range. Height matches content when
          content overflows, or available height when it fits (no scrollbar). */}
      <div style={{ height: scrollHeight }}>
        {/* Sticky wrapper keeps the Scene pinned while the spacer scrolls. */}
        <div style={{ position: "sticky", top: 0, height: availableHeight }}>
          <SceneScrollContext.Provider value={contextValue}>
            {children}
          </SceneScrollContext.Provider>
        </div>
      </div>
    </div>
  );
}
