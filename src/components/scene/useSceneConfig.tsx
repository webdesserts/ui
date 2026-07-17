import { createContext, useContext } from "react";
import type { Transition } from "motion/react";

export const DEFAULT_STIFFNESS = 300;
export const DEFAULT_DAMPING = 30;
export const DEFAULT_COLUMN_GAP = 16;
export const DEFAULT_PERSPECTIVE = 800;
export const DEFAULT_PEEK_OFFSET = 12;
/**
 * `power` for touch-release inertia (Motion's `type: "inertia"` decay) —
 * the classic iOS deceleration flywheel constant. Lower = the coast decays
 * (and stops) sooner. Bumped 0.4 -> 0.55 per Michael's on-device feel
 * direction ("inertia could be bumped up", 2026-07-17, feed 801, on the
 * live app running the F14 pin) — a longer coast distance. The sliders
 * remain the fine-tune path from here.
 */
export const DEFAULT_TOUCH_POWER = 0.55;
/**
 * `timeConstant` (ms) for touch-release inertia — how quickly the decay's
 * velocity falls off. Lower = a snappier, shorter coast; higher = a
 * floatier, longer one. 325 mirrored iOS's own native scroll-release feel;
 * bumped 325 -> 375 per Michael's on-device feel direction ("inertia could
 * be bumped up", 2026-07-17, feed 801) — a floatier coast to match the
 * power bump above. The sliders remain the fine-tune path from here.
 */
export const DEFAULT_TOUCH_TIME_CONSTANT = 375;

/** Shared configuration for the Scene system. */
export interface SceneConfig {
  /** Spring stiffness for position/size animations. */
  stiffness: number;
  /** Spring damping for position/size animations. */
  damping: number;
  /**
   * `power` for touch-release inertia (Motion's `type: "inertia"` decay).
   * Michael-tunable — see DEFAULT_TOUCH_POWER's own doc comment.
   */
  touchPower: number;
  /**
   * `timeConstant` (ms) for touch-release inertia. Michael-tunable — see
   * DEFAULT_TOUCH_TIME_CONSTANT's own doc comment.
   */
  touchTimeConstant: number;
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
  touchPower: DEFAULT_TOUCH_POWER,
  touchTimeConstant: DEFAULT_TOUCH_TIME_CONSTANT,
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

/**
 * Computes the transition used for Scene's spring-driven animations
 * (column depth-deck treatment, within-column depth-deck treatment, swap
 * offsets, camera pan) from the current SceneConfig. Shared by SceneColumn
 * and SceneObject so both apply the SAME duration=0/slowMo/real-spring
 * rules — previously duplicated inline in SceneColumn, DRY'd here (Scene
 * F2 C2).
 *
 * - duration===0 (tests): instant, no spring — `{ duration: 0 }`.
 * - slowMo (animation snapshot testing): the SAME spring type but much
 *   lazier stiffness/damping, so a test can freeze mid-transition.
 * - otherwise: the configured spring (stiffness/damping).
 */
export function computeSceneTransition(
  config: Pick<SceneConfig, "duration" | "slowMo" | "stiffness" | "damping">,
): Transition {
  return config.duration === 0
    ? { duration: 0 }
    : config.slowMo
      ? { type: "spring", stiffness: 30, damping: 8 }
      : { type: "spring", stiffness: config.stiffness, damping: config.damping };
}
