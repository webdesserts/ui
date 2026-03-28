import { createContext } from "react";

/**
 * The x offset (px) within the stage where in-between columns should align.
 * This equals the left edge of the rightmost focused column relative to the
 * stage, measured after layout by SceneViewport.
 *
 * 0 on the first render (before measurement). SceneColumns use this value to
 * translate themselves to the depth deck stacking position.
 */
export const DepthDeckContext = createContext<number>(0);
