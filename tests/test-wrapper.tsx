/**
 * Shared test wrapper that loads global styles (Tailwind + tokens + preset)
 * so component screenshots render correctly.
 */

import "@/dev/main.css";

export function TestWrapper({
  children,
  fullPage,
}: {
  children: React.ReactNode;
  fullPage?: boolean;
}) {
  return (
    <div
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
