import { createContext } from "react";

/**
 * Dimensions (and page-relative position) of the Scene viewport, provided to
 * descendant SceneColumns for centering and to Scene itself for the
 * useCamera() `viewport` rect. top/left come from getBoundingClientRect()
 * (page-relative) — see the S6 useCamera reshape (forecast-gate adjudication
 * #2): ResizeObserver's contentRect.top/left are padding-box-relative
 * (≈0 always) and are NOT a valid substitute.
 */
export interface ViewportDimensions {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Provides viewport dimensions to descendant SceneColumns so they can
 * compute vertical centering margins without prop drilling.
 */
export const ViewportContext = createContext<ViewportDimensions>({ top: 0, left: 0, width: 0, height: 0 });
