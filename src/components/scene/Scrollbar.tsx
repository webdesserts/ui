import React, { useCallback, useEffect, useRef } from "react";

export interface ScrollbarProps {
  /** Current scroll offset in px (0 = top). */
  scrollOffset: number;
  /** Maximum scroll offset (contentHeight - viewportHeight). */
  maxScroll: number;
  /** Height of the scrollbar track in px (typically the viewport height). */
  trackHeight: number;
  /** Called when the user drags the scrollbar thumb. Receives new scroll offset. */
  onScroll: (offset: number) => void;
}

/**
 * Custom scrollbar component for a single overflowing column. Renders a thin
 * track with a proportionally-sized thumb. Supports drag-to-scroll via pointer
 * events.
 *
 * Positioned at the column's right edge by the parent (absolute positioning
 * is applied externally, not here).
 */
export function Scrollbar({ scrollOffset, maxScroll, trackHeight, onScroll }: ScrollbarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Thumb height: proportional to the ratio of visible area to total content.
  // contentHeight = maxScroll + trackHeight (since maxScroll = content - viewport)
  const contentHeight = maxScroll + trackHeight;
  const thumbHeight = Math.max(20, (trackHeight / contentHeight) * trackHeight);

  // Thumb position: maps scrollOffset [0, maxScroll] to track position [0, trackHeight - thumbHeight]
  const thumbTop =
    maxScroll > 0 ? (scrollOffset / maxScroll) * (trackHeight - thumbHeight) : 0;

  // Pointer drag state
  const dragStartY = useRef<number>(0);
  const dragStartOffset = useRef<number>(0);
  const isDragging = useRef<boolean>(false);

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
      <div
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerUp}
        onPointerCancel={handleThumbPointerUp}
        style={{
          position: "absolute",
          right: 0,
          top: thumbTop,
          width: 6,
          height: thumbHeight,
          background: "rgba(128, 128, 128, 0.5)",
          borderRadius: 3,
          cursor: "grab",
        }}
      />
    </div>
  );
}
