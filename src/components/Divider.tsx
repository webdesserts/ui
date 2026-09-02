import { cn } from "../utils/cn";

// ---------------------------------------------------------------------------
// Divider — horizontal rule
//
// Ported from voice-chat-prototype's repeated `<hr>` divider markup
// (design/components/dividers/page.tsx, header.tsx) into a component: a
// dotted bottom rule (border-t-0, only the bottom edge visible) in one of
// two weights. The prototype hand-rolls two dotted-rule colors (--sepia-40
// "default", --sepia-30 "subtle") at each call site; this repo already
// carries that exact default/subtle pairing as shared tokens
// (border-rule-default/border-rule-subtle), so no new custom properties are
// needed to port the pattern — the two variants map straight onto them.
// Horizontal only — no vertical usage exists anywhere in the source
// prototype. `className` passthrough for spacing/width; the prototype never
// gives Divider intrinsic margin, leaving that to the caller's own layout
// (space-y-*, grid, etc).
// ---------------------------------------------------------------------------

export type DividerVariant = "default" | "subtle";

const dividerVariants: Record<DividerVariant, string> = {
  default: "border-rule-default",
  subtle: "border-rule-subtle",
};

export interface DividerProps extends React.HTMLAttributes<HTMLHRElement> {
  variant?: DividerVariant;
}

export function Divider({ variant = "default", className, ...props }: DividerProps) {
  return (
    <hr
      className={cn("border-b border-dotted border-t-0", dividerVariants[variant], className)}
      {...props}
    />
  );
}
