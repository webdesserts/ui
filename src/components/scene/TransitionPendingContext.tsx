import { createContext } from "react";

/**
 * True while a Scene-wide focus transition (mount entrance, or any focus-
 * arrangement change) is pending settle — false once the settle counter
 * (SettleSignalContext) reaches zero (ui/t:20). Has two remaining consumers
 * in SceneObject.tsx, both race-prevention rather than content inertness
 * (which gates on `focused` alone since ui/t:31/Option A — see Scene.tsx's
 * own transitionPending doc comment for the full design, including the
 * deliberate ambient-overlap tradeoff): `activatable` blocks retargeting
 * focus to a different, still-unfocused object while a transition is
 * already in flight, and the two-phase focus effect gates DOM keyboard-
 * focus delivery until settle.
 *
 * Provided by Scene to every descendant SceneObject. Defaults to `false`
 * outside a Scene (SceneObject used standalone) — no gating applies there,
 * matching every other Scene-provided context's null/no-op-outside-Scene
 * contract.
 */
export const TransitionPendingContext = createContext<boolean>(false);
