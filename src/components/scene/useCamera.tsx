import { createContext, useContext } from "react";

/** A rectangle in page-relative coordinates (matches getBoundingClientRect()). */
export interface CameraRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Current state of the Camera's viewport window into the Scene. */
export interface CameraState {
  /**
   * The Camera viewport element's real bounding rect, page-relative (from
   * getBoundingClientRect() — not padding-box-relative measurements like
   * ResizeObserver's contentRect.top/left, which are ~0 regardless of the
   * viewport's actual page position).
   */
  viewport: CameraRect;
  /**
   * The focused content's bounds — the union of every currently-focused
   * column's rect — inflated by Scene's `padding` on every side, in the SAME
   * page-relative coordinate space as `viewport`. Retains its last measured
   * value when nothing is focused (the camera stays still); starts as a
   * zero rect before Scene's first measurement.
   */
  target: CameraRect;
  /** Whether a camera pan (horizontal centering transition) is currently in flight. */
  transitioning: boolean;
}

const zeroRect: CameraRect = { top: 0, left: 0, width: 0, height: 0 };

const defaultState: CameraState = {
  viewport: zeroRect,
  target: zeroRect,
  transitioning: false,
};

export const CameraContext = createContext<CameraState>(defaultState);

/**
 * Returns the current camera state — the viewport's real bounding rect, the
 * focused content's target bounds, and whether a camera pan is in flight.
 * Available to any component inside a Scene.
 */
export function useCamera(): CameraState {
  return useContext(CameraContext);
}
