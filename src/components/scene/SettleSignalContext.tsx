import { createContext } from "react";

/**
 * Fired by a column whenever one of its owned geometry channels (width,
 * margin, panel width — any MotionValue-driven channel whose settled state
 * the camera's own recentering measurement depends on) reaches its settled
 * state. Idempotent and fire-on-settle-only: call it once per settle event,
 * never per-frame during a spring's own progress.
 *
 * Why this exists: Scene's camera-recentering effect (the no-deps
 * useLayoutEffect that computes `stageLeft`) re-measures column geometry on
 * every SCENE render — but a column's own MotionValue-driven springs don't
 * inherently trigger a Scene render when they complete (a per-column
 * `setState` re-renders that column, not its parent). Without this signal,
 * the camera's measurement is a snapshot taken at the moment of whatever
 * commit last touched Scene (typically a focus toggle), never refreshed as
 * the spring that toggle started continues past that point — proven
 * empirically (ui#17 glass-stack rework, Slice 1): a 37px silent drift on
 * the committed baseline with a fully-settled, uninterrupted refocus; an
 * 86px click-mistargeting at a tested double-interruption timing under the
 * anchor/panel design specifically.
 *
 * Minimal precursor for ui#20's own settle-registry design (Michael ruled
 * ui#17 lands first so ui#20 can hook the final animation topology) — this
 * is intentionally a single fire-and-forget signal, not a per-channel
 * registry. ui#20 is expected to absorb/replace this with its own richer
 * settle-tracking mechanism.
 */
export type SettleSignal = () => void;

/**
 * Provided by Scene to every descendant SceneColumn. `null` outside a Scene
 * (SceneColumn used standalone) — settle signaling is a no-op in that case,
 * matching every other Scene-provided context's null-outside-Scene contract.
 */
export const SettleSignalContext = createContext<SettleSignal | null>(null);
