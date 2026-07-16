/**
 * A snapshot of a SceneColumn's scroll state, passed to `onScroll`. Also
 * readable imperatively via a ref/useScene hook for the rare consumer that
 * needs a snapshot at event time (not part of this slice — v1 ships the
 * `onScroll` callback only, per the design note's "What consumers delete"
 * framing).
 */
export interface SceneScrollMetrics {
  /** Current scroll offset (px), same value data-scroll-offset reflects. */
  offset: number;
  /** Current scrollable range: contentHeight - viewportHeight, clamped to 0. */
  maxScroll: number;
  /** Current summed height of the column's focused content. */
  contentHeight: number;
  /** Effective (padding-subtracted) viewport height this column scrolls within. */
  viewportHeight: number;
  /**
   * Whether the column's follow-the-end pin (F9 commit 2, `anchor="end"`)
   * is currently engaged. `"none"` for both `anchor="none"` columns and an
   * `anchor="end"` column whose pin has been released. `"element"` (an
   * earlier design-note draft's third state, anchoring to a specific
   * object) was DROPPED before v1 (⚖️ adjudication 4) — default anchoring
   * (F9 commit 1) is a per-event displacement correction, not a persistent
   * state, so nothing in this API ever produces it. Adding a state later
   * is backward-compatible; shipping one this API never produces would not
   * have been.
   */
  anchored: "none" | "end";
}
