import { createContext } from "react";

/**
 * Scene's horizontal pan control surface (ui#19 slice (c), A2 architecture:
 * column-first-claim). A focused, scrollable SceneColumn's own touch
 * handler triad is the sole horizontal consumer for gestures that START
 * inside its content — on classifying "horizontal" it keeps tracking (an
 * X-variant of its existing 1:1 vertical drag) and drives panOffset through
 * THIS surface instead of releasing to native. Scene's own net-new
 * viewport-level touch triad covers everything a column's triad didn't
 * claim (stage background, parked columns, non-scrollable focused columns)
 * — using this SAME surface. One classifier decision per gesture (whoever
 * owns the pointerdown), no mid-gesture handoff, no second independent
 * classification of the same stream — and exactly one write path for
 * panOffset regardless of which of the two event sources is driving it.
 */
export interface PanControl {
  /** Live panOffsetRef.current — for capturing a drag gesture's starting baseline. */
  getPanOffset: () => number;
  /** Live panBoundsRef.current — for clamping (fling bounds, etc.) without waiting for a write. */
  getPanBounds: () => { min: number; max: number };
  /**
   * Sets panOffset to an ABSOLUTE value (clamped internally against the
   * live bounds) and drives the camera — the ONE write path every
   * pan-driving input handler in this arc uses (wheel, both touch triads).
   */
  setPanOffset: (value: number) => void;
  /**
   * Starts (or restarts) a touch-release inertia fling toward wherever
   * momentum carries panOffset, clamped to the live bounds — mirrors
   * SceneColumn's own startInertiaFlingRef shape (F13 commit 4), scoped
   * down to what horizontal panning actually needs (no anchor="end"
   * pinning or content-growth compensation concepts apply to panning).
   */
  startPanFling: (velocity: number) => void;
}

export const PanControlContext = createContext<PanControl | null>(null);
