import { createContext, useContext } from "react";

export const DEFAULT_STIFFNESS = 300;
export const DEFAULT_DAMPING = 30;
export const DEFAULT_COLUMN_GAP = 16;
export const DEFAULT_PERSPECTIVE = 800;
export const DEFAULT_PEEK_OFFSET = 12;

/** Shared configuration for the Scene system. */
export interface SceneConfig {
  /** Spring stiffness for position/size animations. */
  stiffness: number;
  /** Spring damping for position/size animations. */
  damping: number;
  /** CSS perspective distance (in px) for depth deck 3D effect. */
  perspective: number;
  /** Padding (in px) around the stage content. */
  padding: number;
  /** Gap (in px) between focused columns in the stage flex row. */
  columnGap: number;
  /**
   * Per-depth-level peek offset (in px) for depth-deck cards. A card peeks
   * out in the direction it travels when pulled from the deck: column decks
   * anchor under the right focused column and peek left; within-column decks
   * anchor under the lower focused sibling and peek up. Fanned so every
   * deeper card's edge stays visible (depth-N peeks by N * peekOffset).
   */
  peekOffset: number;
  /**
   * Animation duration override (in ms). Set to 0 to disable all animations —
   * useful in tests to avoid waiting for spring settle times.
   */
  duration: number | undefined;
  /** Enable debug overlays and outlines. */
  debug: boolean;
  /** Slow-motion springs for animation snapshot testing. Same spring physics, much lazier parameters. */
  slowMo: boolean;
}

const defaultConfig: SceneConfig = {
  stiffness: DEFAULT_STIFFNESS,
  damping: DEFAULT_DAMPING,
  perspective: DEFAULT_PERSPECTIVE,
  padding: 0,
  columnGap: DEFAULT_COLUMN_GAP,
  peekOffset: DEFAULT_PEEK_OFFSET,
  duration: undefined,
  debug: false,
  slowMo: false,
};

export const SceneConfigContext = createContext<SceneConfig>(defaultConfig);

/** Returns the current Scene configuration. */
export function useSceneConfig(): SceneConfig {
  return useContext(SceneConfigContext);
}
