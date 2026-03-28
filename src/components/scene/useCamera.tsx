import { createContext, useContext } from "react";

/** Current state of the Camera's viewport window into the Scene. */
export interface CameraState {
  /** Bounding rect of the Camera viewport element. */
  bounds: { top: number; left: number; width: number; height: number };
  /** Whether a layout transition is currently in flight. */
  transitioning: boolean;
}

const defaultState: CameraState = {
  bounds: { top: 0, left: 0, width: 0, height: 0 },
  transitioning: false,
};

export const CameraContext = createContext<CameraState>(defaultState);

/**
 * Returns the current camera state — the viewport bounds and whether a
 * transition is in flight. Available to any component inside a Scene.
 */
export function useCamera(): CameraState {
  return useContext(CameraContext);
}
