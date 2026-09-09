import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { TestWrapper } from "./test-wrapper";
import { Select } from "@/src";
import type { SelectOption } from "@/src";

/**
 * Focused interaction tests for the exported Select component (ui/t:7).
 * These pin the accessible/keyboard contract from the reviewed plan:
 * truthful combobox semantics, real-DOM option focus on open, one-shot
 * Enter selection with focus return, Escape/Tab/outside dismissal,
 * and the disabled/empty closed states. Visual geometry lives in
 * tests/visual/select.test.tsx; the historical candidate record stays
 * untouched at tests/visual/select-trigger-candidates.test.tsx.
 */

const FRUITS: SelectOption[] = [
  { value: "apple-canonical", label: "Apple" },
  { value: "banana-canonical", label: "Banana" },
  { value: "cherry-canonical", label: "Cherry" },
];

function Harness({
  options = FRUITS,
  value = "banana-canonical",
  onChange = () => {},
  placeholder,
  disabled,
  ghost,
  ...rest
}: {
  options?: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ghost?: boolean;
} & Record<string, unknown>) {
  return (
    <TestWrapper>
      <div style={{ width: 240 }}>
        <Select
          data-testid="select"
          aria-label="Fruit"
          value={value}
          options={options}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          ghost={ghost}
          {...rest}
        />
      </div>
    </TestWrapper>
  );
}

const trigger = () => page.getByRole("combobox", { name: "Fruit" });
const listbox = () => page.getByRole("listbox");

/** Element screenshot of the trigger's DOM node (not a locator-based role query). */
function triggerElement(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
}

afterEach(() => {
  document.documentElement.style.colorScheme = "";
});

describe("Select — controlled trigger semantics", () => {
  it("renders the selected option's LABEL (not the canonical value) and starts closed", async () => {
    await render(<Harness />);
    const el = triggerElement();
    expect(el.textContent).toContain("Banana");
    expect(el.textContent).not.toContain("banana-canonical");
    expect(el.getAttribute("aria-expanded")).toBe("false");
    expect(el.getAttribute("aria-haspopup")).toBe("listbox");
    expect(el.getAttribute("type")).toBe("button");
    expect(el.getAttribute("role")).toBe("combobox");
  });

  it("shows the placeholder when no option matches the value, without making it the accessible name", async () => {
    await render(<Harness value="missing" placeholder="Pick one…" />);
    const el = triggerElement();
    expect(el.textContent).toContain("Pick one…");
    expect(el.getAttribute("aria-label")).toBe("Fruit");
  });

  it("aria-label and aria-labelledby from the consumer reach the trigger", async () => {
    await render(
      <TestWrapper>
        <Select
          aria-label="Feed"
          value="main"
          options={[{ value: "main", label: "Main" }]}
          onChange={() => {}}
        />
      </TestWrapper>,
    );
    expect(triggerElement().getAttribute("aria-label")).toBe("Feed");
    // aria-labelledby composes too (a consumer naming via visible heading).
    const screen = await render(
      <TestWrapper>
        <h2 id="select-name">Environment</h2>
        <Select
          aria-labelledby="select-name"
          value="prod"
          options={[{ value: "prod", label: "Production" }]}
          onChange={() => {}}
        />
      </TestWrapper>,
    );
    expect(
      screen.container.querySelector('[role="combobox"]')!.getAttribute("aria-labelledby"),
    ).toBe("select-name");
  });

  it("internal ARIA/keyboard wiring is protected: a caller-cast override cannot take it", async () => {
    // SelectProps omits these fields, so a consumer must fight the type system
    // to send them — this cast stands in for that mistake at runtime.
    const hostile = {
      type: "submit",
      role: "textbox",
      "aria-expanded": "never",
      "aria-haspopup": "menu",
    } as const;
    await render(<Harness {...hostile} />);
    const el = triggerElement();
    expect(el.getAttribute("type")).toBe("button");
    expect(el.getAttribute("role")).toBe("combobox");
    expect(el.getAttribute("aria-expanded")).toBe("false");
    expect(el.getAttribute("aria-haspopup")).toBe("listbox");
  });
});

describe("Select — open and option focus", () => {
  it("click opens the listbox and moves REAL DOM focus to the selected option", async () => {
    await render(<Harness />);
    await trigger().click();
    await expect.element(listbox()).toBeInTheDocument();
    const options = document.querySelectorAll('[role="option"]');
    expect(options.length).toBe(3);
    expect(document.activeElement).toBe(options[1]); // "Banana" is selected
  });

  it("opening with an unmatched value focuses the FIRST option", async () => {
    await render(<Harness value="missing" placeholder="Pick one…" />);
    await trigger().click();
    await expect.element(listbox()).toBeInTheDocument();
    expect(document.activeElement).toBe(document.querySelectorAll('[role="option"]')[0]);
  });

  it("options carry aria-selected and type=button; M1 selection is the selected prop, no glyph", async () => {
    await render(<Harness />);
    await trigger().click();
    await expect.element(listbox()).toBeInTheDocument();
    const options = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(options.every((o) => o.getAttribute("type") === "button")).toBe(true);
  });
});

describe("Select — selection", () => {
  it("clicking an option calls onChange ONCE with the canonical value, closes, returns focus to the trigger", async () => {
    const onChange = vi.fn();
    const screen = await render(<Harness value="banana-canonical" onChange={onChange} />);
    await trigger().click();
    await expect.element(listbox()).toBeInTheDocument();
    await page.getByRole("option", { name: "Cherry" }).click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("cherry-canonical");
    expect(listbox().query()).toBeNull();
    expect(document.activeElement).toBe(triggerElement());
  });

  it("Enter on the focused option selects once and returns focus", async () => {
    const onChange = vi.fn();
    await render(<Harness value="banana-canonical" onChange={onChange} />);
    await trigger().click();
    await expect.element(listbox()).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("banana-canonical");
    expect(listbox().query()).toBeNull();
    expect(document.activeElement).toBe(triggerElement());
  });

  it("ArrowDown/ArrowUp/Home/End move real DOM focus among options", async () => {
    await render(<Harness value="banana-canonical" />);
    await trigger().click();
    await expect.element(listbox()).toBeInTheDocument();
    const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];

    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(options()[2]);
    await userEvent.keyboard("{ArrowUp}");
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(options()[0]);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(options()[2]);
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(options()[0]);
  });
});

describe("Select — dismissal", () => {
  it("Escape closes without changing the value and returns focus to the trigger", async () => {
    const onChange = vi.fn();
    await render(<Harness value="banana-canonical" onChange={onChange} />);
    await trigger().click();
    await expect.element(listbox()).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(listbox().query()).toBeNull();
    expect(document.activeElement).toBe(triggerElement());
    expect(triggerElement().getAttribute("aria-expanded")).toBe("false");
  });

  it("Tab closes without trapping and continues normal sequential navigation", async () => {
    const onChange = vi.fn();
    const screen = await render(
      <TestWrapper>
        <div style={{ width: 240 }}>
          <Select
            aria-label="Fruit"
            value="banana-canonical"
            options={FRUITS}
            onChange={onChange}
          />
          <button data-testid="after">After</button>
        </div>
      </TestWrapper>,
    );
    await trigger().click();
    await expect.element(listbox()).toBeInTheDocument();
    await userEvent.keyboard("{Tab}");
    expect(onChange).not.toHaveBeenCalled();
    expect(listbox().query()).toBeNull();
    // Focus advanced to the next element in DOM order — not forced back.
    expect(document.activeElement).toBe(
      screen.container.querySelector('[data-testid="after"]'),
    );
  });

  it("outside pointer interaction closes without changing the value", async () => {
    const onChange = vi.fn();
    const screen = await render(
      <TestWrapper>
        <div style={{ width: 240 }}>
          <Select
            aria-label="Fruit"
            value="banana-canonical"
            options={FRUITS}
            onChange={onChange}
          />
          {/* Below the open panel (~132px) so the click target isn't covered —
              the panel legitimately intercepts pointer events over it. */}
          <div style={{ height: 200 }} />
          <button data-testid="elsewhere">Elsewhere</button>
        </div>
      </TestWrapper>,
    );
    await trigger().click();
    await expect.element(listbox()).toBeInTheDocument();
    await page.getByTestId("elsewhere").click();
    expect(onChange).not.toHaveBeenCalled();
    expect(listbox().query()).toBeNull();
  });
});

describe("Select — disabled and empty states", () => {
  it("disabled Select does not open and stays aria-expanded=false", async () => {
    await render(<Harness disabled />);
    await trigger().click();
    expect(listbox().query()).toBeNull();
    expect(triggerElement().getAttribute("aria-expanded")).toBe("false");
  });

  it("with no options, open requests are ignored, no listbox renders, aria-expanded stays false", async () => {
    const onChange = vi.fn();
    await render(<Harness options={[]} value="" onChange={onChange} placeholder="Empty" />);
    await trigger().click();
    expect(listbox().query()).toBeNull();
    expect(document.querySelector('[role="option"]')).toBeNull();
    expect(triggerElement().getAttribute("aria-expanded")).toBe("false");
  });
});
