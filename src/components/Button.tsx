import { forwardRef } from "react";
import { cn } from "../utils/cn";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/**
 * Base interactive styles shared by all button types.
 *
 * Hover bg/text is handled by the spread animation (::after fill + color
 * transition in spread.css). Only border-color hover is set here since
 * spread doesn't affect borders.
 */
const interactiveBase =
  "cursor-pointer transition-[color,background-color,opacity] duration-200 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active-border disabled:cursor-not-allowed disabled:opacity-40";

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

/** Spread class for a given border side */
function spreadBarClass(side: BorderSide): string {
  if (side === "top") return "spread spread-bar-top";
  if (side === "right") return "spread spread-bar-right";
  if (side === "left") return "spread spread-bar-left";
  return "spread spread-bar-full";
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
          "spread spread-bar-partial",
          "bg-transparent text-text-primary no-underline",
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
    const { border, rounding } = borderSideClasses[borderSide];
    const glassBorder = glassBorderSides[borderSide];
    const borderStyle = rounded ? "border" : border;

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
        ? `${borderStyle} border-danger ${bg} text-danger`
        : `${borderStyle} border-rule-default ${bg} text-text-secondary`;

    return (
      <button
        ref={ref}
        className={cn(
          rounded ? "rounded-full" : rounding,
          interactiveBase,
          spreadBarClass(borderSide),
          iconButtonSizes[size],
          colorClasses,
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
    const { border, rounding } = borderSideClasses[borderSide];
    const glassBorder = glassBorderSides[borderSide];

    const pressedClasses =
      `${border} border-interactive-bg bg-interactive-bg text-interactive-text`;

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
        ? `${border} border-danger ${bg} text-danger`
        : `${border} border-rule-default ${bg} text-text-secondary`;

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
  bottom: "shadow-[inset_0_-1px_0_var(--border-default)]",
  top: "shadow-[inset_0_1px_0_var(--border-default)]",
  right: "shadow-[inset_-1px_0_0_var(--border-default)]",
  left: "shadow-[inset_1px_0_0_var(--border-default)]",
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
  glass?: boolean;
  borderSide?: BorderSide;
  className?: string;
}

export function ButtonGroup({
  children,
  glass = false,
  borderSide = "bottom",
  className,
}: ButtonGroupProps) {
  const bg = glass ? glassBg : "bg-surface-raised";
  const { rounding } = borderSideClasses[borderSide];

  return (
    <div
      className={cn(
        `relative inline-flex items-center gap-px ${rounding} ${bg} overflow-hidden ${groupShadowSides[borderSide]}`,
        glass &&
          `after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] ${groupGlassBorderSides[borderSide]} [&_button]:shadow-none`,
        "[&_button]:rounded-none [&_button]:border-none",
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
          "spread spread-bar-left",
          selected
            ? "border-l border-interactive-bg bg-interactive-bg text-interactive-text"
            : `border-l border-rule-default text-text-secondary`,
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
