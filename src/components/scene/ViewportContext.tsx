import { createContext } from "react";

/** Dimensions of the Scene viewport, provided to child columns for centering. */
export interface ViewportDimensions {
  width: number;
  height: number;
}

/**
 * Provides viewport dimensions (width + height) to descendant SceneColumns so
 * they can compute vertical centering margins without prop drilling.
 */
export const ViewportContext = createContext<ViewportDimensions>({ width: 0, height: 0 });
