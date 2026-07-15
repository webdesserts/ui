import { createContext } from "react";

/** A column's self-reported registration data. */
export interface RegisteredColumn {
  /** Whether any of this column's registered SceneObjects are currently focused. */
  focused: boolean;
  /** The column's own outer DOM element. */
  element: HTMLElement;
}

/**
 * Registers a column's current focus state and DOM element with the owning
 * Scene. Returns an unregister function. Called by SceneColumn in its own
 * useLayoutEffect, every render (S6 registration architecture) — this
 * happens via React context + a DOM ref, not by walking Scene's `children`
 * prop tree, so it stays correct regardless of Fragment wrapping or custom
 * components that return a SceneColumn.
 */
export type RegisterColumn = (
  name: string,
  registration: RegisteredColumn,
) => () => void;

/**
 * Provided by Scene to every descendant SceneColumn. `null` outside a Scene
 * (SceneColumn used standalone).
 */
export const ColumnRegistryContext = createContext<RegisterColumn | null>(null);
