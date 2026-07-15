/**
 * Shared test wrapper that loads global styles (Tailwind + tokens + preset)
 * so component screenshots render correctly.
 *
 * Sets `display: inline-flex` on the vitest render container so that
 * element screenshots are tightly cropped around the component instead of
 * spanning the full viewport width.
 */

import { useCallback } from "react";
import "@/dev/main.css";

export function TestWrapper({
  children,
  fullPage,
  width,
  height,
}: {
  children: React.ReactNode;
  fullPage?: boolean;
  /** Overrides fullPage's default 1280px width (test-only — e.g. mobile snapshots). */
  width?: number;
  /** Overrides fullPage's default 800px height (test-only — e.g. mobile snapshots). */
  height?: number;
}) {
  const shrinkContainer = useCallback((el: HTMLDivElement | null) => {
    if (el?.parentElement && !fullPage) {
      el.parentElement.style.display = "inline-flex";
    }
  }, [fullPage]);

  return (
    <div
      ref={shrinkContainer}
      className="bg-surface-base text-text-primary antialiased"
      style={
        fullPage
          ? { width: `${width ?? 1280}px`, height: `${height ?? 800}px`, overflow: "hidden" }
          : { padding: "1rem" }
      }
    >
      {children}
    </div>
  );
}
