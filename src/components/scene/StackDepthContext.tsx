import { createContext } from "react";

/**
 * Maps column name → depth index for in-between unfocused columns.
 * Depth 1 = adjacent to the rightmost focused column (nearest, most opaque).
 * Depth 2 = next further back, etc.
 *
 * Provided synchronously by Scene during render (no DOM measurement needed),
 * so columns see correct depth values on the first render pass.
 */
export const StackDepthContext = createContext<Map<string, number>>(new Map());
