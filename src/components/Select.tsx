import { forwardRef, useRef, useState } from "react";
import {
  useFloating,
  useClick,
  useDismiss,
  useRole,
  useListNavigation,
  useInteractions,
  useMergeRefs,
  offset,
  size as floatingSize,
  autoUpdate,
} from "@floating-ui/react";
import type { Placement } from "@floating-ui/react";
import { cn } from "../utils/cn";
import { MenuItem } from "./Button";
import { spreadSetupBase, spreadBarClasses, interactiveRing } from "./shared";
import type { ButtonSize } from "./shared";

// ---------------------------------------------------------------------------
// Select — controlled dropdown select (input chrome + chevron)
//
// The visual language is the settled ui/t:7 verdict (see
// tests/visual/select-trigger-candidates.test.tsx for the permanent candidate
// record): candidate C's trigger (real 2px bottom border that inverts to
// interactive-bg while hovered/open, quiet surface-raised fill spreading up
// behind it, text that never inverts) with M1 selected-option treatment via
// the shared MenuItem, and the mockup-era "icon-select" asset (stacked
// chevrons + center diamond) retokened to currentColor — magenta stays
// reserved for focus/press, so the icon rides the trigger's own text color.
// The stacked shape is vertically symmetric, so it does not rotate when open.
//
// Ghost variant: transparent RESTING surface only. Every other state — the
// full-strength bottom rule, seam, hover/open fill, focus ring, icon,
// dimensions, timing, and the persistent invalid rule — is identical to the
// default trigger.
// ---------------------------------------------------------------------------

/**
 * The one seam value (Michael's 2026-07-23 coupling ruling: "however many px
 * you put between the border and the fill of the input, the gap from the
 * border to the menu should match"). Feeds BOTH the trigger's internal
 * fill-to-border seam (via the --select-seam custom property below) and the
 * trigger→panel Floating UI offset. Broader menu alignment is ui/t:10's
 * scope — do not grow this into a generic positioning system.
 */
const SHARED_SEAM = 2;

/** Panel-internal fill inset: 2px rail column + the shared seam, so row fills
 *  clear the panel's border column (same value the candidate fixtures used). */
const PANEL_FILL_LEFT = SHARED_SEAM + 2;

export interface SelectOption {
  /** Canonical value committed to the controlled state — never display shorthand. */
  value: string;
  /** Human label shown in the trigger and the option row. */
  label: string;
}

// The component owns the combobox contract: role, expansion state, popup
// relationship, button type, and the controlled value/onChange. Everything
// else on the native button surface (id, aria-label/labelledby, data-*,
// event and class props) passes through to the trigger.
//
// Native form limitation: Select does NOT participate in native form
// submission. A `name` prop does not submit the selected value with a parent
// <form>, and no hidden input is rendered — form integration remains
// consumer-owned.
export interface SelectProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    | "children"
    | "type"
    | "role"
    | "value"
    | "defaultValue"
    | "onChange"
    | "disabled"
    | "aria-expanded"
    | "aria-haspopup"
  > {
  /** Controlled selected value — must match an option's canonical `value`. */
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Shown when no option matches `value`. Display text only — never the
   *  trigger's accessible name. */
  placeholder?: string;
  size?: ButtonSize;
  /** Persistent 2px danger rule (same mechanism as TextInput). */
  invalid?: boolean;
  disabled?: boolean;
  /** Floating UI placement of the panel. Defaults to "bottom-start". */
  placement?: Placement;
  /** Transparent resting trigger surface; all other states identical to default. */
  ghost?: boolean;
}

// Heights/padding share the Button/TextInput scale so the three controls
// align in a row (same values as TextInput's inputSizes).
const triggerSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

/**
 * Candidate C's trigger chrome, byte-faithful to the permanent candidate
 * fixtures: shared spread setup, real border-b-2, and the fill geometry that
 * stops short of the border by the shared seam (top+height only — bottom is
 * dropped, no over-constraint). The hover block and the open block carry the
 * same look; `open` swaps them in EXCLUSIVELY (two unconditional
 * same-specificity groups targeting the same ::after properties don't
 * reliably resolve by class order — see the candidates file's
 * TRIGGER_C_RESTING/TRIGGER_C_OPEN comment).
 */
const TRIGGER_C = cn(
  "group flex w-full items-center justify-between rounded-t-sm",
  spreadSetupBase,
  interactiveRing,
  "cursor-pointer outline-none",
  "border-b-2 transition-[border-color] duration-200",
  "transition-[color,opacity] duration-200",
  "not-disabled:hover:border-interactive-bg",
  "not-disabled:hover:after:top-0 not-disabled:hover:after:left-0 not-disabled:hover:after:right-0 not-disabled:hover:after:w-full not-disabled:hover:after:h-[calc(100%_-_var(--select-seam))] not-disabled:hover:after:m-0",
  "not-disabled:hover:after:bg-surface-raised",
  "not-disabled:hover:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
  "not-disabled:focus-visible:text-surface-base",
  "not-disabled:focus-visible:after:inset-0 not-disabled:focus-visible:after:w-full not-disabled:focus-visible:after:h-full not-disabled:focus-visible:after:m-0",
  "not-disabled:focus-visible:after:bg-[var(--spread-bg-hover,var(--interactive-bg))]",
  "not-disabled:focus-visible:after:[transition:top_250ms,left_250ms,right_250ms,bottom_250ms,width_250ms,height_250ms,margin_250ms,background-color_200ms]",
);

/** Open holds the hover look statically (Michael's ruling: the hover state is
 *  active while the dropdown is open), including the same shared seam. */
const TRIGGER_C_OPEN = cn(
  "border-interactive-bg",
  "after:top-0 after:left-0 after:right-0 after:w-full after:h-[calc(100%_-_var(--select-seam))] after:m-0 after:bg-surface-raised",
);

/** Resting spread-bar geometry + the line's own color (see TRIGGER_C's
 *  exclusivity note). */
const TRIGGER_C_RESTING = cn(spreadBarClasses.bottom, "border-interactive-border");

/** Placeholder styling — candidate C's: no hover invert (text never flips),
 *  focus-visible gets the full invert copied from candidate B. */
const PLACEHOLDER_C = cn(
  "text-text-secondary transition-[color,opacity] duration-200",
  "group-focus-visible:text-surface-base group-focus-visible:opacity-60",
);

/** Panel: the settled full-height rail, square attached top edge, glass
 *  surface, and per-row fill inset. No margin — Floating UI's offset owns the
 *  trigger→panel gap (the shared seam). Rows inherit --spread-bg-rest
 *  transparent so the rail reads as the only border; the SELECTED row's own
 *  MenuItem inline override wins over inheritance, so the border darkens at
 *  the selected row. */
const PANEL = cn("glass-panel rounded-b-md py-1 relative overflow-hidden");

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    value,
    options,
    onChange,
    placeholder,
    size = "md",
    invalid = false,
    disabled = false,
    placement = "bottom-start",
    ghost = false,
    className,
    style,
    ...props
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedLabel = selectedIndex === -1 ? undefined : options[selectedIndex].label;
  const canOpen = !disabled && options.length > 0;

  // Availability invariant: an already-open panel must close when the Select
  // becomes disabled or its options empty. Resetting the stale `open` state
  // during render (React's documented state-adjustment pattern) also prevents
  // availability returning from resurrecting a panel nobody reopened. The
  // derived `isOpen` below keeps aria-expanded/panel rendering truthful in
  // the SAME commit.
  const isOpen = open && canOpen;
  if (open && !isOpen) {
    setOpen(false);
  }

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setOpen,
    placement,
    middleware: [
      // The shared seam precedes width-matching (middleware order = run order).
      offset(SHARED_SEAM),
      floatingSize({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
          });
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context, { enabled: canOpen });
  // Escape is handled manually (below) so it can return focus to the trigger;
  // the library's escape dismissal would close without the focus contract.
  const dismiss = useDismiss(context, { enabled: isOpen, escapeKey: false });
  const role = useRole(context, { role: "listbox" });
  const listNavigation = useListNavigation(context, {
    enabled: isOpen,
    listRef,
    activeIndex,
    selectedIndex: selectedIndex === -1 ? null : selectedIndex,
    onNavigate: setActiveIndex,
    // Real DOM focus (not aria-activedescendant) — the contract is that the
    // option buttons themselves hold focus.
    virtual: false,
    focusItemOnOpen: true,
    loop: false,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click,
    dismiss,
    role,
    listNavigation,
  ]);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const setTriggerRef = useMergeRefs([ref, triggerRef, refs.setReference]);

  /** Selection/Escape path: focus the trigger BEFORE the panel unmounts so
   *  focus never lands on <body> between unmount and refocus. */
  function closeAndReturnFocus() {
    triggerRef.current?.focus();
    setOpen(false);
  }

  function select(option: SelectOption) {
    // Availability guard: a stale option activation (e.g. after the Select was
    // disabled or emptied mid-interaction) must not commit a value.
    if (!canOpen) return;
    // Exactly one onChange per selection — Enter/click/space all funnel here.
    onChange(option.value);
    closeAndReturnFocus();
  }

  // react-hooks/refs: floating-ui's prop getters composes EVENT handlers —
  // the onKeyDowns below read triggerRef (via closeAndReturnFocus) only when
  // a key event fires, never during render. The compiler can't see through
  // the opaque getter calls; this is floating-ui's documented consumer
  // pattern. Hoisted here (not inline in JSX) so the suppression can carry
  // its justification.
  // eslint-disable-next-line react-hooks/refs -- floating-ui prop-getter pattern: ref access is event-time only
  const triggerProps = getReferenceProps({
    ...props,
    onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
      props.onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (!isOpen) return;
      if (event.key === "Escape") {
        closeAndReturnFocus();
      } else if (event.key === "Tab") {
        // Close without trapping or forcing focus back — the browser's
        // default Tab continues sequential navigation.
        setOpen(false);
      }
    },
  });

  // Same pattern as triggerProps: these keys arrive with focus on an option
  // button; the trigger's handler above covers focus-on-trigger cases.
  // eslint-disable-next-line react-hooks/refs -- floating-ui prop-getter pattern: ref access is event-time only
  const panelProps = getFloatingProps({
    onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeAndReturnFocus();
      } else if (event.key === "Tab") {
        setOpen(false);
      }
    },
  });

  // react-hooks/refs: the per-item callback ref writes listRef at
  // callback-ref time (React's own ref lifecycle), not during render —
  // standard floating-ui listRef registration.
  // eslint-disable-next-line react-hooks/refs -- listRef registration runs at callback-ref time, not render time
  const optionItems = options.map((option, index) => (
    <MenuItem
      key={option.value}
      ref={(node) => {
        listRef.current[index] = node;
      }}
      selected={option.value === value}
      {...getItemProps({
        role: "option",
        type: "button",
        "aria-selected": option.value === value,
        onClick() {
          select(option);
        },
      })}
    >
      <span className="truncate">{option.label}</span>
    </MenuItem>
  ));

  return (
    <>
    <button
      ref={setTriggerRef}
      {...props}
      {...triggerProps}
      type="button"
      role="combobox"
      disabled={disabled}
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      aria-invalid={invalid || undefined}
      className={cn(
        TRIGGER_C,
        open ? TRIGGER_C_OPEN : TRIGGER_C_RESTING,
        ghost ? "bg-transparent" : "bg-surface-input",
        invalid && [
          "border-danger",
          // The persistent danger rule: paints the 2px line ON TOP of the
          // hover/open fill (same mechanism as TextInput), which would
          // otherwise cover a border-only cue.
          "shadow-[inset_0_-2px_0_var(--danger)]",
        ],
        triggerSizes[size],
        className,
      )}
      style={
        {
          // One shared value feeds the seam (here) and the Floating UI offset
          // (the middleware above) — they cannot drift apart.
          "--select-seam": `${SHARED_SEAM}px`,
          // Neutralize the spread bar's resting fallback so it doesn't double
          // the real border (candidates file's TRIGGER_C_STYLE).
          "--spread-bg-rest": "transparent",
          ...style,
        } as React.CSSProperties
      }
    >
      <span className={cn("truncate", selectedLabel === undefined && PLACEHOLDER_C)}>
        {selectedLabel ?? placeholder}
      </span>
      <SelectIcon size={12} className="shrink-0 ml-2" />
    </button>
    {isOpen && (
      <div
        ref={refs.setFloating}
        {...panelProps}
        className={PANEL}
        style={
          {
            ...floatingStyles,
            // No margin: the shared seam offset lives in the Floating UI
            // middleware. Rows inherit these vars (candidates file's
            // OpenPanel wiring) — the selected MenuItem's own inline
            // --spread-bg-rest override wins, darkening the rail at the
            // selected row.
            "--spread-bg-rest": "transparent",
            "--spread-fill-left": `${PANEL_FILL_LEFT}px`,
          } as React.CSSProperties
        }
      >
        <div aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-interactive-border" />
        {optionItems}
      </div>
    )}
    </>
  );
});

/** The settled mockup-era "icon-select" asset (Select Icon Assets
 *  (mockup-era)): stacked up/down chevrons + center diamond, retokened from
 *  the mockup palette to currentColor so it follows the trigger's text color
 *  through hover/open inversion. Symmetric vertically — no rotation when open. */
function SelectIcon({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path d="M5 11L8 14L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
      <path
        d="M7.41406 8L8 8.58594L8.58594 8L8 7.41406L7.41406 8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
      <path d="M5 5L8 2L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

