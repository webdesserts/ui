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
}: {
  children: React.ReactNode;
  fullPage?: boolean;
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
          ? { width: "1280px", height: "800px", overflow: "hidden" }
          : { padding: "1rem" }
      }
    >
      {children}
    </div>
  );
}
