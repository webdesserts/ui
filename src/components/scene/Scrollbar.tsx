import React, { useCallback, useEffect, useRef } from "react";
import { motion, useTransform, type MotionValue } from "motion/react";
import { mapScrollKeyToCommand, type ScrollCommand } from "./inputController";

export interface ScrollbarProps {
  /** Current scroll offset in px (0 = top). */
  scrollOffset: number;
  /**
   * F16: the SAME scrollY MotionValue SceneColumn drives the content
   * wrapper's own position from (see SceneColumn's S3 motion pipeline doc
   * comment) — the thumb's TOP position is derived from this directly, per
   * frame, outside React (mirrors composedTop's useTransform pattern),
   * rather than from the scrollOffset prop above. scrollOffset itself is
   * deliberately NOT updated per-tick in real mode (the whole reason that
   * pipeline exists — see handleContentPointerMove's own comment), so a
   * thumb rendered from it alone sat frozen through every coast/spring and
   * only jumped at the next state flush (Michael's "the scroll bar
   * teleports rather than animating", 2026-07-17, feed 801). scrollOffset
   * remains the model for everything that doesn't need per-frame
   * freshness: aria-valuenow, and the drag interaction's own
   * dragStartOffset baseline below.
   */
  scrollY: MotionValue<number>;
  /** Maximum scroll offset (contentHeight - viewportHeight). */
  maxScroll: number;
  /** Height of the scrollbar track in px (typically the viewport height). */
  trackHeight: number;
  /** Called when the user drags the scrollbar thumb. Receives new scroll offset. */
  onScroll: (offset: number) => void;
  /**
   * id of the scrollable region this scrollbar controls (D4 — threaded from
   * SceneColumn's content wrapper id, rendered as the thumb's aria-controls).
   */
  controlsId?: string;
  /**
   * Applies a scroll command via the same input-controller command path
   * (SceneColumn's applyScrollCommand) used by wheel/keyboard/touch (D4 —
   * the thumb's own keyboard operations reuse it rather than duplicating
   * the write logic).
   */
  onCommand?: (cmd: ScrollCommand) => void;
}

/**
 * Custom scrollbar component for a single overflowing column. Renders a thin
 * track with a proportionally-sized thumb. Supports drag-to-scroll via pointer
 * events.
 *
 * Positioned at the column's right edge by the parent (absolute positioning
 * is applied externally, not here).
 */
export function Scrollbar({
  scrollOffset,
  scrollY,
  maxScroll,
  trackHeight,
  onScroll,
  controlsId,
  onCommand,
}: ScrollbarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Thumb height: proportional to the ratio of visible area to total content.
  // contentHeight = maxScroll + trackHeight (since maxScroll = content - viewport)
  const contentHeight = maxScroll + trackHeight;
  const thumbHeight = Math.max(20, (trackHeight / contentHeight) * trackHeight);

  // F16: thumb TOP position, derived from scrollY per frame (mirrors
  // SceneColumn's composedTop useTransform pattern) — maps scrollY
  // [0, maxScroll] to track position [0, trackHeight - thumbHeight]. Motion
  // resubscribes this transform's closure on every render (useTransform's
  // own useCombineMotionValues re-runs its layout effect with no deps
  // array), so maxScroll/trackHeight/thumbHeight staying fresh across
  // renders doesn't depend on scrollY itself changing.
  const thumbTop = useTransform(scrollY, (s) =>
    maxScroll > 0 ? (s / maxScroll) * (trackHeight - thumbHeight) : 0,
  );

  // Pointer drag state
  const dragStartY = useRef<number>(0);
  const dragStartOffset = useRef<number>(0);
  const isDragging = useRef<boolean>(false);

  // D4 keyboard ops: a NATIVE listener (not a React onKeyDown prop) is
  // required for e.stopPropagation() to actually prevent SceneColumn's own
  // column-level keydown listener from ALSO firing. Both listeners are
  // native `addEventListener` calls on real DOM ancestors of the thumb, and
  // native bubbling reaches the thumb's own listener before it ever reaches
  // an ancestor's — a React synthetic onKeyDown here would fire too late
  // (React delegates at the root, the outermost ancestor in the bubble
  // path), so its stopPropagation() couldn't undo an ancestor's native
  // listener that already ran (probe-confirmed: without this, ArrowDown
  // scrolled by -80 instead of -40 — both the thumb's command AND the
  // column's own keydown handler applied).
  const thumbRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      const cmd = mapScrollKeyToCommand(e.key, e.shiftKey, trackHeight);
      if (!cmd) return;
      onCommand?.(cmd);
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [trackHeight, onCommand]);

  const handleThumbPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartOffset.current = scrollOffset;
      (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    },
    [scrollOffset],
  );

  const handleThumbPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging.current) return;
      const deltaY = e.clientY - dragStartY.current;
      // Convert thumb movement to scroll offset movement
      const scrollRange = trackHeight - thumbHeight;
      const scrollDelta =
        scrollRange > 0 ? (deltaY / scrollRange) * maxScroll : 0;
      const newOffset = Math.max(
        0,
        Math.min(maxScroll, dragStartOffset.current + scrollDelta),
      );
      onScroll(newOffset);
    },
    [maxScroll, trackHeight, thumbHeight, onScroll],
  );

  const handleThumbPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      isDragging.current = false;
      (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
    },
    [],
  );

  // Click on track (outside thumb) jumps to that position
  const handleTrackPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!trackRef.current) return;
      const trackRect = trackRef.current.getBoundingClientRect();
      const clickY = e.clientY - trackRect.top;
      // Center the thumb at the click position
      const newThumbTop = Math.max(0, Math.min(trackHeight - thumbHeight, clickY - thumbHeight / 2));
      const scrollRange = trackHeight - thumbHeight;
      const newOffset =
        scrollRange > 0 ? (newThumbTop / scrollRange) * maxScroll : 0;
      onScroll(newOffset);
    },
    [maxScroll, trackHeight, thumbHeight, onScroll],
  );

  return (
    <div
      ref={trackRef}
      data-scrollbar
      onPointerDown={handleTrackPointerDown}
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        width: 6,
        height: trackHeight,
        background: "transparent",
        cursor: "default",
        zIndex: 10,
        userSelect: "none",
      }}
    >
      {/* Thumb hit-box: widened to 24px (WCAG 2.2 SC 2.5.8 minimum target
          size) while the VISIBLE bar (inner div below) stays thin at 6px,
          right-flush — the same visual position as before. touchAction:
          "none" so a touch-drag starting on the thumb is never hijacked by
          native scrolling/zooming in ANY direction (the Camera viewport's
          own touch-action: pan-x pinch-zoom would otherwise let the browser
          claim a horizontal drag that starts here). */}
      <motion.div
        ref={thumbRef}
        role="scrollbar"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={maxScroll}
        aria-valuenow={scrollOffset}
        aria-controls={controlsId}
        tabIndex={0}
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerUp}
        onPointerCancel={handleThumbPointerUp}
        style={{
          position: "absolute",
          right: 0,
          top: thumbTop,
          width: 24,
          height: thumbHeight,
          touchAction: "none",
          cursor: "grab",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 6,
            height: "100%",
            background: "rgba(128, 128, 128, 0.5)",
            borderRadius: 3,
            pointerEvents: "none",
          }}
        />
      </motion.div>
    </div>
  );
}
