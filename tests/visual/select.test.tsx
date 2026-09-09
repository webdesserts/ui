import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import {
  freezeAnimationsAt,
  unfreezeAnimations,
  waitForAnimationFrame,
  slowTransitions,
  animationScreenshotOptions,
  wait,
} from "../utils/animation";
import { Select } from "@/src";
import type { SelectOption } from "@/src";

/**
 * Production Select visual + computed pins (ui/t:7 implementation slice).
 * Bounded dark/light baselines for the default and ghost variants plus the
 * computed geometry pins the screenshot comparator is proven blind to (the
 * candidates file's corner-radii/seam investigation). The historical
 * candidate record at select-trigger-candidates.test.tsx stays untouched —
 * this file pins the SHIPPED component, not the candidates.
 *
 * Open captures render inside an explicitly sized relative frame: the
 * floating panel is position:absolute and contributes no layout height, so
 * an unframed element screenshot would crop it.
 */

const FRAME_WIDTH = 280;
/** Tall enough for trigger (40px) + panel (3×40px rows + padding) inside the frame. */
const OPEN_FRAME_HEIGHT = 240;

const FRUITS: SelectOption[] = [
  { value: "apple-canonical", label: "Apple" },
  { value: "banana-canonical", label: "Banana" },
  { value: "cherry-canonical", label: "Cherry" },
];

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

function SelectFrame({
  children,
  height,
}: {
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <div style={{ width: FRAME_WIDTH, position: "relative", height }}>
      {children}
    </div>
  );
}

function Harness({
  value = "banana-canonical",
  ghost,
  invalid,
  disabled,
  size,
  placeholder,
}: {
  value?: string;
  ghost?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  placeholder?: string;
}) {
  return (
    <Select
      aria-label="Fruit"
      value={value}
      options={FRUITS}
      onChange={() => {}}
      ghost={ghost}
      invalid={invalid}
      disabled={disabled}
      size={size}
      placeholder={placeholder}
    />
  );
}

/** Park the pointer off the trigger so "resting" captures are deterministic. */
async function restPointer(container: Element) {
  await page.elementLocator(container).hover({ position: { x: 0, y: 0 } });
}

/** Hover the trigger, freeze its fill at the fully-settled end state. */
async function captureHover(container: Element) {
  const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  const restore = slowTransitions();
  await page.elementLocator(trigger).hover();
  await waitForAnimationFrame();
  const anims = freezeAnimationsAt(trigger, 1, { subtree: true });
  restore();
  await expect
    .element(page.elementLocator(container))
    .toMatchScreenshot(animationScreenshotOptions);
  unfreezeAnimations(anims);
}

/** Open the Select via a real click and wait for the floating panel. */
async function openSelect(container: Element) {
  const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
  await page.elementLocator(trigger).click();
  await expect.element(page.getByRole("listbox")).toBeInTheDocument();
  await restPointer(container);
  // Settle the open-state fill's 400ms transition (a real wait past the
  // duration — the deterministic post-settle pattern, since reading computed
  // geometry mid-flight yields transition-frame values).
  await wait(600);
}

// ---------------------------------------------------------------------------
// Bounded visual baselines — default variant (dark + light)
// ---------------------------------------------------------------------------

describe("Select default — rest, hover, focus, invalid (visual)", () => {
  it("select-default-rest-value-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness />
        </SelectFrame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-default-rest-value-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness />
        </SelectFrame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-default-rest-placeholder-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness value="missing" placeholder="Select…" />
        </SelectFrame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-default-rest-placeholder-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness value="missing" placeholder="Select…" />
        </SelectFrame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-default-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness />
        </SelectFrame>
      </TestWrapper>,
    );
    await captureHover(screen.container);
  });

  it("select-default-hover-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness />
        </SelectFrame>
      </TestWrapper>,
    );
    await captureHover(screen.container);
  });

  it("select-default-focus-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness />
        </SelectFrame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    // Real keyboard tab — the trigger is a plain :focus-visible button.
    await userEvent.tab();
    await waitForAnimationFrame();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-default-focus-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness />
        </SelectFrame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await userEvent.tab();
    await waitForAnimationFrame();
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-default-invalid-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness invalid />
        </SelectFrame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-default-invalid-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness invalid />
        </SelectFrame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Open state — explicitly sized frame so the floating panel can't be cropped.
// Dark + light only; the panel is the settled glass/menu language already
// pinned by menu-item + candidate fixtures.
// ---------------------------------------------------------------------------

describe("Select default — open (visual)", () => {
  it("select-default-open-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <SelectFrame height={OPEN_FRAME_HEIGHT}>
          <Harness />
        </SelectFrame>
      </TestWrapper>,
    );
    await openSelect(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot(animationScreenshotOptions);
  });

  it("select-default-open-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <SelectFrame height={OPEN_FRAME_HEIGHT}>
          <Harness />
        </SelectFrame>
      </TestWrapper>,
    );
    await openSelect(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot(animationScreenshotOptions);
  });
});

// ---------------------------------------------------------------------------
// Ghost variant — transparent resting surface ONLY. Rest + hover captures in
// both themes; every other state is byte-identical to default (pinned
// computationally below, and by the shared class constants in the component).
// ---------------------------------------------------------------------------

describe("Select ghost (visual)", () => {
  it("select-ghost-rest-value-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness ghost />
        </SelectFrame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-ghost-rest-value-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness ghost />
        </SelectFrame>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("select-ghost-hover-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness ghost />
        </SelectFrame>
      </TestWrapper>,
    );
    await captureHover(screen.container);
  });

  it("select-ghost-hover-light", async () => {
    document.documentElement.style.colorScheme = "light";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness ghost />
        </SelectFrame>
      </TestWrapper>,
    );
    await captureHover(screen.container);
  });
});

// ---------------------------------------------------------------------------
// Sizes — one dark capture proves the shared height scale (sm/md/lg).
// ---------------------------------------------------------------------------

describe("Select sizes (visual)", () => {
  it("select-sizes-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <div style={{ width: FRAME_WIDTH, display: "flex", flexDirection: "column", gap: 8 }}>
          <Harness size="sm" />
          <Harness size="md" />
          <Harness size="lg" />
        </div>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});

// ---------------------------------------------------------------------------
// Computed pins — the actual regression guards where the screenshot
// comparator's tolerance is proven blind at 2px scale (see the candidates
// file's round-4 investigation).
// ---------------------------------------------------------------------------

/** Radii of a rounded-b-md reference for the attached-edge pin. */
async function renderOpen(value = "banana-canonical") {
  document.documentElement.style.colorScheme = "dark";
  const screen = await render(
    <TestWrapper>
      <SelectFrame height={OPEN_FRAME_HEIGHT}>
        <Harness value={value} />
      </SelectFrame>
      <div data-testid="interactive-bg-reference" style={{ backgroundColor: "var(--interactive-bg)" }} />
      <div data-testid="surface-input-reference" className="bg-surface-input" />
      <div data-testid="rounded-md-reference" className="rounded-md" />
    </TestWrapper>,
  );
  await openSelect(screen.container);
  return screen;
}

describe("Select — shared seam/offset geometry (computed)", () => {
  it("select-shared-seam-and-offset-computed", async () => {
    const screen = await renderOpen();
    const trigger = screen.container.querySelector<HTMLElement>('[role="combobox"]')!;
    const panel = screen.container.querySelector<HTMLElement>(".glass-panel")!;

    // Seam: the open fill stops short of the border by the shared value
    // (parsed float to tolerate subpixel noise from the calc resolution —
    // same approach as the candidates file's seam pin).
    const afterHeight = parseFloat(window.getComputedStyle(trigger, "::after").height);
    const seam = trigger.clientHeight - afterHeight;

    // Offset: the trigger→panel gap (Floating UI owns it; the panel adds no
    // margin — proved by the offset matching the raw rect delta, not a
    // margin-derived delta).
    const panelMarginTop = window.getComputedStyle(panel).marginTop;
    const offset = panel.getBoundingClientRect().top - trigger.getBoundingClientRect().bottom;

    // THE coupling ruling: one shared 2px value controls both. Asserted as
    // pairwise equality + the value, so any drift between the two breaks
    // this pin even if both silently changed to the same wrong number.
    expect(panelMarginTop).toBe("0px");
    expect(seam).toBe(offset);
    expect(seam).toBe(2);
  });
});

describe("Select — panel structure (computed)", () => {
  it("select-open-panel-rail-full-height-computed", async () => {
    const screen = await renderOpen();
    const panel = screen.container.querySelector<HTMLElement>(".glass-panel")!;
    const rail = screen.container.querySelector<HTMLElement>(".glass-panel > [aria-hidden]")!;
    // The rail column spans the panel's own padding-box height exactly —
    // "one single border stretching the full height".
    expect(rail.clientHeight).toBe(panel.clientHeight);
    expect(rail.clientWidth).toBe(2);
  });

  it("select-open-panel-square-attached-edge-computed", async () => {
    const screen = await renderOpen();
    const panel = screen.container.querySelector<HTMLElement>(".glass-panel")!;
    const ref = screen.container.querySelector("[data-testid='rounded-md-reference']")!;
    // Top edge square (attached), bottom edge carries rounded-md's radius —
    // compared against a reference element so the pin tracks the token.
    const style = window.getComputedStyle(panel);
    expect(style.borderTopLeftRadius).toBe("0px");
    expect(style.borderTopRightRadius).toBe("0px");
    expect(style.borderBottomLeftRadius).toBe(
      ref ? window.getComputedStyle(ref).borderBottomLeftRadius : "",
    );
  });
});

describe("Select — M1 selection via MenuItem (computed)", () => {
  it("select-selected-row-overlay-computed", async () => {
    const screen = await renderOpen();
    const selected = screen.container.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="true"]',
    )!;
    const interactiveBgRef = screen.container.querySelector(
      '[data-testid="interactive-bg-reference"]',
    ) as HTMLElement;

    // The selected row's own --spread-bg-rest override (Button.tsx) wins over
    // the panel's inherited transparent, so its 2px bar overlays the rail —
    // M1's "border darkens at the selected row".
    expect(window.getComputedStyle(selected, "::after").width).toBe("2px");
    expect(window.getComputedStyle(selected, "::after").backgroundColor).toBe(
      window.getComputedStyle(interactiveBgRef).backgroundColor,
    );
  });
});

describe("Select — icon follows currentColor (computed)", () => {
  it("select-icon-current-color-computed", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        {/* Colored wrapper: a custom trigger text color must flow through
            the icon's stroke via currentColor (the retokening contract). */}
        <div style={{ color: "var(--danger)" }}>
          <SelectFrame>
            <Harness />
          </SelectFrame>
        </div>
      </TestWrapper>,
    );
    await restPointer(screen.container);
    const trigger = screen.container.querySelector<HTMLElement>('[role="combobox"]')!;
    const stroke = screen.container.querySelector<SVGPathElement>('[role="combobox"] svg path')!;
    expect(window.getComputedStyle(stroke).stroke).toBe(window.getComputedStyle(trigger).color);
  });
});

describe("Select — ghost resting surface (computed)", () => {
  it("select-ghost-transparent-rest-computed", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness ghost />
        </SelectFrame>
        <Harness />
        <div data-testid="surface-input-reference" className="bg-surface-input" />
      </TestWrapper>,
    );
    await restPointer(screen.container);
    const ghostTrigger = screen.container.querySelectorAll<HTMLElement>('[role="combobox"]')[0];
    const defaultTrigger = screen.container.querySelectorAll<HTMLElement>('[role="combobox"]')[1];
    const surfaceInputRef = screen.container.querySelector(
      '[data-testid="surface-input-reference"]',
    ) as HTMLElement;

    // Ghost: transparent RESTING surface. Default: the surface-input chrome —
    // both pinned against references, not hardcoded colors. Every other
    // visual property is the same class constants in the component itself.
    expect(window.getComputedStyle(ghostTrigger).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(window.getComputedStyle(defaultTrigger).backgroundColor).toBe(
      window.getComputedStyle(surfaceInputRef).backgroundColor,
    );
  });

  it("select-ghost-keeps-full-strength-rule-computed", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness ghost />
        </SelectFrame>
        <div data-testid="interactive-border-reference" style={{ backgroundColor: "var(--interactive-border)" }} />
      </TestWrapper>,
    );
    await restPointer(screen.container);
    const trigger = screen.container.querySelector<HTMLElement>('[role="combobox"]')!;
    const ruleRef = screen.container.querySelector(
      '[data-testid="interactive-border-reference"]',
    ) as HTMLElement;

    // Ghost retains the full-strength 2px bottom rule (not a hairline, not
    // dimmed) — same border geometry/color as the default trigger.
    expect(window.getComputedStyle(trigger).borderBottomWidth).toBe("2px");
    expect(window.getComputedStyle(trigger).borderBottomColor).toBe(
      window.getComputedStyle(ruleRef).backgroundColor,
    );
  });
});

describe("Select — spread timing (computed)", () => {
  it("select-trigger-timing-computed", async () => {
    document.documentElement.style.colorScheme = "dark";
    const screen = await render(
      <TestWrapper>
        <SelectFrame>
          <Harness />
        </SelectFrame>
      </TestWrapper>,
    );
    const el = screen.container.querySelector<HTMLElement>('[role="combobox"]')!;

    // Rest: the shared 400ms exit default (Button-family, untouched).
    const style = window.getComputedStyle(el, "::after");
    const properties = style.transitionProperty.split(", ");
    const idx = properties.indexOf("top");
    expect(style.transitionDuration.split(", ")[idx]).toBe("0.4s");

    // Hover: the trigger stays on Button's 250ms short-axis default — NOT
    // MenuItem's 300ms long-axis tune (the trigger and a menu row sweep very
    // different distances).
    await page.elementLocator(el).hover();
    await waitForAnimationFrame();
    const hoverStyle = window.getComputedStyle(el, "::after");
    const hoverIdx = hoverStyle.transitionProperty.split(", ").indexOf("top");
    expect(hoverStyle.transitionDuration.split(", ")[hoverIdx]).toBe("0.25s");
  });
});
