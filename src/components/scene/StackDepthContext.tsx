import { createContext } from "react";

/**
 * Maps column name → depth index for in-between unfocused columns.
 * Depth 1 = adjacent to the rightmost focused column (nearest, most opaque).
 * Depth 2 = next further back, etc.
 *
 * Provided by Scene during render, derived from its column registry (S6
 * registration architecture) once populated, or from a prop-walk seed
 * before any column has registered. Ordinary compositions settle on the
 * first render pass; Fragment-wrapped or custom-component-returned columns
 * settle on a second, synchronous, pre-paint correction pass — both are
 * invisible to consumers since they resolve before paint.
 */
export const StackDepthContext = createContext<Map<string, number>>(new Map());
