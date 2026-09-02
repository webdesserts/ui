import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Divider } from "../src";
import { TestWrapper } from "./test-wrapper";

describe("Divider", () => {
  test("renders an <hr>", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Divider data-testid="divider" />
      </TestWrapper>,
    );
    expect(getByTestId("divider").element().tagName).toBe("HR");
  });

  test("default variant uses border-rule-default", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Divider data-testid="divider" />
      </TestWrapper>,
    );
    const el = getByTestId("divider").element();
    expect(el.className).toContain("border-rule-default");
    expect(el.className).not.toContain("border-rule-subtle");
  });

  test("subtle variant uses border-rule-subtle", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Divider variant="subtle" data-testid="divider" />
      </TestWrapper>,
    );
    const el = getByTestId("divider").element();
    expect(el.className).toContain("border-rule-subtle");
    expect(el.className).not.toContain("border-rule-default");
  });

  test("is horizontal (border-b, no border-t)", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Divider data-testid="divider" />
      </TestWrapper>,
    );
    const el = getByTestId("divider").element();
    expect(el.className).toContain("border-b");
    expect(el.className).toContain("border-t-0");
  });

  test("className passthrough merges onto the recipe classes", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Divider className="custom-class" data-testid="divider" />
      </TestWrapper>,
    );
    expect(getByTestId("divider").element().className).toContain("custom-class");
  });
});
