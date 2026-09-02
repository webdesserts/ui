import { createElement } from "react";
import { cn } from "../utils/cn";

// ---------------------------------------------------------------------------
// Heading — polymorphic section title
//
// Ported from voice-chat-prototype's heading.tsx and reconciled onto the
// lib's tokens and `cn` utility: `size` picks both a default HTML element
// (xl/lg → h1, md → h2, sm → h3) and a Tailwind class recipe (custom
// text-heading-*/leading-heading-* size tokens + a bare font-weight
// utility); `as` overrides the element without changing the visual size.
// Color routes through the lib's existing text-text-primary/text-text-muted
// tokens (same names the prototype itself already uses).
// ---------------------------------------------------------------------------

export type HeadingSize = "xl" | "lg" | "md" | "sm";
export type HeadingElement = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

const headingSizes: Record<HeadingSize, { defaultAs: HeadingElement; classes: string }> = {
  xl: { defaultAs: "h1", classes: "text-heading-xl leading-heading-xl font-extralight" },
  lg: { defaultAs: "h1", classes: "text-heading-lg leading-heading-lg font-light" },
  md: { defaultAs: "h2", classes: "text-heading-md leading-heading-md font-medium" },
  sm: { defaultAs: "h3", classes: "text-heading-sm leading-heading-sm font-medium" },
};

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  size?: HeadingSize;
  as?: HeadingElement;
  muted?: boolean;
  children: React.ReactNode;
}

export function Heading({ size = "lg", as, muted = false, className, children, ...props }: HeadingProps) {
  const config = headingSizes[size];
  const tag = as ?? config.defaultAs;
  const color = muted ? "text-text-muted" : "text-text-primary";

  return createElement(tag, { className: cn(config.classes, color, className), ...props }, children);
}
