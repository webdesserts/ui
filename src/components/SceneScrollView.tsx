import React, { createContext, useContext } from "react";
import { cn } from "../utils/cn";

// ---------------------------------------------------------------------------
// SceneScrollContext — preserved for API compatibility
// ---------------------------------------------------------------------------

/**
 * Previously used to share scroll state between SceneScrollView and Camera.
 * Scroll is now handled directly by the Camera viewport. This context is
 * kept as a null-providing shell so any consumers that check for it don't
 * need to change.
 */
export const SceneScrollContext = createContext<null>(null);

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
 * Returns scroll state from the nearest `SceneScrollView`.
 *
 * @deprecated Scroll is now handled by the Camera viewport. This hook returns
 * zeroed values for backward compatibility and will be removed in a future version.
 */
export function useSceneScroll(): SceneScrollState {
  useContext(SceneScrollContext);
  return { scrollTop: 0, availableHeight: 0, contentHeight: 0, scrollable: false };
}

// ---------------------------------------------------------------------------
// SceneScrollView (public) — sizing wrapper for Scene
// ---------------------------------------------------------------------------

export interface SceneScrollViewProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * A sizing wrapper for `Scene`. Previously managed scrolling via a sticky-spacer
 * mechanism; scroll is now handled directly by the Camera viewport, which shows
 * native scrollbars when focused content overflows.
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
  return (
    <SceneScrollContext.Provider value={null}>
      <div className={cn("w-full h-full", className)}>
        {children}
      </div>
    </SceneScrollContext.Provider>
  );
}
