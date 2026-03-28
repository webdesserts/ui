/** A registered object within the Scene. */
export interface SceneEntry {
  element: HTMLElement;
  focused: boolean;
}

/** Captured dimensions of a column at the moment it loses focus. */
export interface FrozenSize {
  width: number;
  height: number;
}
