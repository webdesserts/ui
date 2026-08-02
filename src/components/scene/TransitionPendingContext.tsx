import { createContext } from "react";

/**
 * True while a Scene-wide focus transition (mount entrance, or any focus-
 * arrangement change) is pending settle — false once the settle counter
 * (SettleSignalContext) reaches zero (ui#20). Gates inertness scene-wide:
 * every SceneObject stays fully inert (content `inert`, activation
 * disabled) while this is true, regardless of whether that particular
 * object's own channels are the ones animating — the stray-click hazard a
 * focus transition creates is scene-wide, not per-object (see Scene.tsx's
 * own transitionPending doc comment for the full design, including the
 * deliberate ambient-overlap tradeoff).
 *
 * Provided by Scene to every descendant SceneObject. Defaults to `false`
 * outside a Scene (SceneObject used standalone) — no gating applies there,
 * matching every other Scene-provided context's null/no-op-outside-Scene
 * contract.
 */
export const TransitionPendingContext = createContext<boolean>(false);
