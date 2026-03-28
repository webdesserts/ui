import { createContext, useContext } from "react";

/** Shared configuration for the Scene system. */
export interface SceneConfig {
  /** Spring stiffness for position/size animations. */
  stiffness: number;
  /** Spring damping for position/size animations. */
  damping: number;
  /** Padding (in px) around the stage content. */
  padding: number;
  /**
   * Animation duration override (in ms). Set to 0 to disable all animations —
   * useful in tests to avoid waiting for spring settle times.
   */
  duration: number | undefined;
  /** Enable debug overlays and outlines. */
  debug: boolean;
}

const defaultConfig: SceneConfig = {
  stiffness: 300,
  damping: 30,
  padding: 0,
  duration: undefined,
  debug: false,
};

export const SceneConfigContext = createContext<SceneConfig>(defaultConfig);

/** Returns the current Scene configuration. */
export function useSceneConfig(): SceneConfig {
  return useContext(SceneConfigContext);
}
