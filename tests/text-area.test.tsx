import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { TestWrapper } from "./test-wrapper";
import { TextArea } from "@/src";

/** Auto-grow contract of TextArea: from `rows` lines up to `maxRows`, then scroll. */

function field(): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>("[data-ui-text-area] textarea")!;
}

async function renderArea(props: React.ComponentProps<typeof TextArea> = {}) {
  await render(
    <TestWrapper>
      <div style={{ width: 240 }}>
        <TextArea aria-label="Message" {...props} />
      </div>
    </TestWrapper>,
  );
  return field();
}

describe("TextArea — auto-grow", () => {
  it("grows with each line up to maxRows, then scrolls", async () => {
    const el = await renderArea({ maxRows: 3 });
    const oneLine = el.getBoundingClientRect().height;

    await userEvent.type(el, "a{Shift>}{Enter}{/Shift}b");
    const twoLines = el.getBoundingClientRect().height;
    expect(twoLines).toBeGreaterThan(oneLine);

    await userEvent.type(el, "{Shift>}{Enter}{/Shift}c{Shift>}{Enter}{/Shift}d{Shift>}{Enter}{/Shift}e");
    const capped = el.getBoundingClientRect().height;
    expect(capped).toBeCloseTo(oneLine + 2 * (twoLines - oneLine), 0);
    expect(el.scrollHeight).toBeGreaterThan(el.clientHeight);
  });

  it("keeps its rows height without autoGrow", async () => {
    const el = await renderArea({ rows: 2, autoGrow: false });
    const before = el.getBoundingClientRect().height;
    await userEvent.type(el, "1{Shift>}{Enter}{/Shift}2{Shift>}{Enter}{/Shift}3{Shift>}{Enter}{/Shift}4");
    expect(el.getBoundingClientRect().height).toBe(before);
  });

  it("uses the translucent surface when glass", async () => {
    await renderArea({ glass: true });
    expect(document.querySelector("[data-ui-text-area]")!.className).toContain("bg-surface-input/65");
  });
});
