import { forwardRef } from "react";
import { cn } from "../utils/cn";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/**
 * Base interactive styles shared by all button types.
 *
 * Hover bg/text is handled by the spread animation (::after fill + color
 * transition via spreadBase). Only border-color hover is set here since
 * spread doesn't affect borders.
 */
/**
 * Accent outline ring — identical for focus-visible and active states.
 * The `highlight:` custom variant matches both `:focus-visible` and
 * `:active:not(:disabled)`. Uses outline so it doesn't conflict with
 * box-shadow composition. z-1 prevents clipping by adjacent buttons.
 */
const interactiveBase =
  "cursor-pointer outline-none highlight:outline-solid highlight:outline-2 highlight:outline-accent highlight:z-1 disabled:cursor-not-allowed disabled:opacity-50";

const glassBlur = "backdrop-blur-[var(--glass-blur)]";
const glassBg = `bg-glass-bg ${glassBlur}`;
const glassDangerBg = `bg-glass-danger-bg ${glassBlur}`;

export type BorderSide = "bottom" | "top" | "right" | "left";

const borderSideClasses = {
  bottom: { border: "border-b", rounding: "rounded-t-sm" },
  top: { border: "border-t", rounding: "rounded-b-sm" },
  right: { border: "border-r", rounding: "rounded-l-sm" },
  left: { border: "border-l", rounding: "rounded-r-sm" },
} as const;

/**
 * 1px inset box-shadow border on the 3 edges opposite the border side.
 * Uses box-shadow so it doesn't affect element sizing.
 */
const glassBorderSides = {
  bottom:
    "shadow-[inset_1px_0_0_var(--color-rule-subtle),inset_-1px_0_0_var(--color-rule-subtle),inset_0_1px_0_var(--color-rule-subtle)]",
  top:
    "shadow-[inset_1px_0_0_var(--color-rule-subtle),inset_-1px_0_0_var(--color-rule-subtle),inset_0_-1px_0_var(--color-rule-subtle)]",
  right:
    "shadow-[inset_1px_0_0_var(--color-rule-subtle),inset_0_1px_0_var(--color-rule-subtle),inset_0_-1px_0_var(--color-rule-subtle)]",
  left:
    "shadow-[inset_-1px_0_0_var(--color-rule-subtle),inset_0_1px_0_var(--color-rule-subtle),inset_0_-1px_0_var(--color-rule-subtle)]",
} as const;

// ---------------------------------------------------------------------------
// Spread animation — pure Tailwind class strings
//
// Universal hover/focus affordance: a ::after pseudo-element starts as a
// resting bar and expands to fill the entire element on hover/focus.
// Asymmetric timing: fast enter (200ms ease-out), slow exit (350ms ease-in-out).
// ---------------------------------------------------------------------------

/** Base classes shared by all bar spread variants. */
const spreadBase = [
  "relative z-0 overflow-hidden",
  "transition-[color,opacity] duration-200",
  // ::after setup
  "after:absolute after:-z-1",
  "after:bg-[var(--spread-bg-rest,var(--interactive-border))]",
  "after:[transition:top_400ms_ease-in-out,left_400ms_ease-in-out,right_400ms_ease-in-out,bottom_400ms_ease-in-out,width_400ms_ease-in-out,height_400ms_ease-in-out,margin_400ms_ease-in-out,background-color_600ms_ease-in]",
  // Hover — fill + text inversion
  "not-disabled:hover:text-interactive-text",
  "not-disabled:hover:after:inset-0 not-disabled:hover:after:w-full not-disabled:hover:after:h-full not-disabled:hover:after:m-0",
  "not-disabled:hover:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "not-disabled:hover:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
  // Focus-visible — same as hover
  "not-disabled:focus-visible:text-interactive-text",
  "not-disabled:focus-visible:after:inset-0 not-disabled:focus-visible:after:w-full not-disabled:focus-visible:after:h-full not-disabled:focus-visible:after:m-0",
  "not-disabled:focus-visible:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "not-disabled:focus-visible:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
].join(" ");

/** Bar geometry per border side (resting state position). */
const spreadBarClasses = {
  bottom: "after:top-[calc(100%-2px)] after:left-0 after:right-0 after:bottom-0 after:w-full after:h-0.5",
  top: "after:top-0 after:left-0 after:right-0 after:bottom-[calc(100%-2px)] after:w-full after:h-0.5",
  right: "after:top-0 after:left-[calc(100%-2px)] after:right-0 after:bottom-0 after:w-0.5 after:h-full",
  left: "after:top-0 after:left-0 after:right-[calc(100%-2px)] after:bottom-0 after:w-0.5 after:h-full",
} as const;

/**
 * Partial bar resting state for ButtonLink — sits 2px below center.
 * All positional properties use explicit calc values (no `auto`) so CSS
 * can interpolate them smoothly during the transition.
 */
const spreadBarPartial = [
  "after:top-[calc(50%+0.625rem+2px)]",
  "after:bottom-[calc(50%-0.625rem-4px)]",
  "after:left-0",
  "after:right-[calc(100%-24px)]",
  "after:w-[24px] after:h-0.5 after:m-0",
].join(" ");

/**
 * Ring spread for rounded buttons — uses box-shadow instead of ::after.
 * Rounded buttons never appear inside ButtonGroups, so no shadow-none conflict.
 */
const spreadRing = [
  "relative z-0 overflow-hidden",
  "shadow-[inset_0_0_0_2px_var(--spread-bg-rest,var(--interactive-border))]",
  "[transition:box-shadow_400ms_ease-in-out,color_200ms,opacity_200ms]",
  "not-disabled:hover:text-interactive-text",
  "not-disabled:hover:shadow-[inset_0_0_0_20px_var(--spread-bg-hover,var(--interactive-bg))]",
  "not-disabled:hover:[transition:box-shadow_250ms,color_200ms,opacity_200ms]",
  "not-disabled:focus-visible:text-interactive-text",
  "not-disabled:focus-visible:shadow-[inset_0_0_0_20px_var(--spread-bg-hover,var(--interactive-bg))]",
  "not-disabled:focus-visible:[transition:box-shadow_250ms,color_200ms,opacity_200ms]",
].join(" ");

/** Returns spread bar classes for a given border side. */
function spreadBarClass(side: BorderSide): string {
  return `${spreadBase} ${spreadBarClasses[side]}`;
}

/** Constrain inline SVG icons inside text buttons.
 *  Uses !important to override Phosphor's inline width/height attributes. */
const buttonIconSize = "[&>svg]:!size-4 [&>svg]:shrink-0";

// ---------------------------------------------------------------------------
// Button — standalone actions, full-width spread bar
// ---------------------------------------------------------------------------

const buttonSizes = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm font-medium",
} as const;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: keyof typeof buttonSizes;
  ghost?: boolean;
  glass?: boolean;
  borderSide?: BorderSide;
  children: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      size = "md",
      ghost = false,
      glass = false,
      borderSide = "bottom",
      className,
      children,
      ...props
    },
    ref,
  ) {
    const { border, rounding } = borderSideClasses[borderSide];
    const glassBorder = glassBorderSides[borderSide];

    const bg = ghost
      ? "bg-transparent"
      : glass
        ? `${glassBg} ${glassBorder}`
        : "bg-surface-raised";

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap",
          buttonIconSize,
          interactiveBase,

          spreadBarClass(borderSide),
          rounding,
          "text-text-primary",
          bg,
          buttonSizes[size],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

// ---------------------------------------------------------------------------
// ButtonLink — navigation links, partial centered spread bar
//
// No horizontal padding at rest — padding animates in on hover alongside
// the spread fill, causing adjacent links to "nudge" apart.
// ---------------------------------------------------------------------------

const buttonLinkSizes = {
  sm: "h-8 text-sm",
  md: "h-10 text-sm font-medium",
} as const;

interface ButtonLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  size?: keyof typeof buttonLinkSizes;
  as?: "a" | "button";
  children: React.ReactNode;
}

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  function ButtonLink(
    { size = "md", as: Tag = "a", className, children, ...props },
    ref,
  ) {
    return (
      <Tag
        ref={ref as any}
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap",
          buttonIconSize,
          interactiveBase,

          spreadBase,
          spreadBarPartial,
          "bg-transparent text-text-primary no-underline",
          Tag === "a" && "hover:underline focus-visible:underline",
          "px-0 hover:px-3 focus-visible:px-3 transition-[padding,color] duration-200",
          buttonLinkSizes[size],
          className,
        )}
        {...(props as any)}
      >
        {children}
      </Tag>
    );
  },
);

// ---------------------------------------------------------------------------
// IconButton — icon-only, full-width spread bar
// ---------------------------------------------------------------------------

const iconButtonSizes = {
  sm: "p-1 [&>svg]:!size-4",
  md: "p-1.5 [&>svg]:!size-4",
  lg: "p-2.5 [&>svg]:!size-5",
} as const;

interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: keyof typeof iconButtonSizes;
  color?: "default" | "danger";
  ghost?: boolean;
  glass?: boolean;
  rounded?: boolean;
  borderSide?: BorderSide;
  children: React.ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      size = "md",
      color = "default",
      ghost = false,
      glass = false,
      rounded = false,
      borderSide = "bottom",
      className,
      children,
      ...props
    },
    ref,
  ) {
    const { rounding } = borderSideClasses[borderSide];
    const glassBorder = glassBorderSides[borderSide];

    const bg = ghost
      ? "bg-transparent"
      : glass && color === "danger"
        ? `${glassDangerBg} ${glassBorder}`
        : glass
          ? `${glassBg} ${glassBorder}`
          : color === "danger"
            ? "bg-danger-muted"
            : "bg-surface-raised";

    const colorClasses =
      color === "danger"
        ? `${bg} text-danger`
        : `${bg} text-text-secondary`;

    return (
      <button
        ref={ref}
        className={cn(
          rounded ? "rounded-full" : rounding,
          interactiveBase,

          rounded ? spreadRing : spreadBarClass(borderSide),
          iconButtonSizes[size],
          colorClasses,
          className,
        )}
        style={color === "danger" ? {
          "--spread-bg-rest": "var(--danger-muted)",
          "--spread-bg-hover": "var(--danger)",
        } as React.CSSProperties : undefined}
        {...props}
      >
        {children}
      </button>
    );
  },
);

// ---------------------------------------------------------------------------
// ChevronButton — narrow dropdown trigger
// ---------------------------------------------------------------------------

const chevronButtonSizes = {
  sm: "px-0.5 py-1 [&>svg]:!size-3",
  md: "px-0.5 py-2 [&>svg]:!size-3",
  lg: "px-1 py-[13px] [&>svg]:!size-3.5",
} as const;

interface ChevronButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: keyof typeof chevronButtonSizes;
  color?: "default" | "danger";
  ghost?: boolean;
  glass?: boolean;
  borderSide?: BorderSide;
  pressed?: boolean;
  children: React.ReactNode;
}

export const ChevronButton = forwardRef<HTMLButtonElement, ChevronButtonProps>(
  function ChevronButton(
    {
      size = "md",
      color = "default",
      ghost = false,
      glass = false,
      borderSide = "bottom",
      pressed = false,
      className,
      children,
      ...props
    },
    ref,
  ) {
    const { rounding } = borderSideClasses[borderSide];
    const glassBorder = glassBorderSides[borderSide];

    const pressedClasses = "bg-interactive-bg text-interactive-text";

    const bg = ghost
      ? "bg-transparent"
      : glass && color === "danger"
        ? `${glassDangerBg} ${glassBorder}`
        : glass
          ? `${glassBg} ${glassBorder}`
          : color === "danger"
            ? "bg-danger-muted"
            : "bg-surface-raised";

    const colorClasses =
      color === "danger"
        ? `${bg} text-danger`
        : `${bg} text-text-secondary`;

    return (
      <button
        ref={ref}
        className={cn(
          rounding,
          interactiveBase,

          pressed ? "" : spreadBarClass(borderSide),
          chevronButtonSizes[size],
          pressed ? pressedClasses : colorClasses,
          className,
        )}
        style={color === "danger" ? {
          "--spread-bg-rest": "var(--danger-muted)",
          "--spread-bg-hover": "var(--danger)",
        } as React.CSSProperties : undefined}
        {...props}
      >
        {children}
      </button>
    );
  },
);

// ---------------------------------------------------------------------------
// ButtonGroup — unified container for adjacent buttons
// ---------------------------------------------------------------------------

const groupShadowSides = {
  bottom: "shadow-[inset_0_-1px_0_var(--interactive-border)]",
  top: "shadow-[inset_0_1px_0_var(--interactive-border)]",
  right: "shadow-[inset_-1px_0_0_var(--interactive-border)]",
  left: "shadow-[inset_1px_0_0_var(--interactive-border)]",
} as const;

const groupGlassBorderSides = {
  bottom:
    "after:shadow-[inset_1px_0_0_var(--color-rule-subtle),inset_-1px_0_0_var(--color-rule-subtle),inset_0_1px_0_var(--color-rule-subtle)]",
  top:
    "after:shadow-[inset_1px_0_0_var(--color-rule-subtle),inset_-1px_0_0_var(--color-rule-subtle),inset_0_-1px_0_var(--color-rule-subtle)]",
  right:
    "after:shadow-[inset_1px_0_0_var(--color-rule-subtle),inset_0_1px_0_var(--color-rule-subtle),inset_0_-1px_0_var(--color-rule-subtle)]",
  left:
    "after:shadow-[inset_-1px_0_0_var(--color-rule-subtle),inset_0_1px_0_var(--color-rule-subtle),inset_0_-1px_0_var(--color-rule-subtle)]",
} as const;

interface ButtonGroupProps {
  children: React.ReactNode;
  ghost?: boolean;
  glass?: boolean;
  borderSide?: BorderSide;
  className?: string;
}

/**
 * Per-border-side rounding for first/last children in a group.
 * Replaces overflow-hidden so highlight outlines aren't clipped.
 */
const groupChildRounding = {
  bottom: "[&>:first-child]:rounded-tl-sm [&>:last-child]:rounded-tr-sm",
  top: "[&>:first-child]:rounded-bl-sm [&>:last-child]:rounded-br-sm",
  right: "[&>:first-child]:rounded-tl-sm [&>:last-child]:rounded-bl-sm",
  left: "[&>:first-child]:rounded-tr-sm [&>:last-child]:rounded-br-sm",
} as const;

export function ButtonGroup({
  children,
  ghost = false,
  glass = false,
  borderSide = "bottom",
  className,
}: ButtonGroupProps) {
  const bg = ghost || glass ? "bg-transparent" : "bg-[var(--interactive-border)]";

  return (
    <div
      className={cn(
        `relative inline-flex items-center gap-px ${bg}`,
        !ghost && groupShadowSides[borderSide],
        "[&_button]:rounded-none",
        groupChildRounding[borderSide],
        glass &&
          `after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] ${groupGlassBorderSides[borderSide]} [&_button]:shadow-none`,
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MenuItem — dropdown list items
// ---------------------------------------------------------------------------

interface MenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  children: React.ReactNode;
}

export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(
  function MenuItem({ selected = false, className, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
          interactiveBase,

          spreadBase,
          spreadBarClasses.left,
          selected
            ? "bg-interactive-bg text-interactive-text"
            : "text-text-secondary",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
