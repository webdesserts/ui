import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Heading } from "../src";
import { TestWrapper } from "./test-wrapper";

describe("Heading", () => {
  test("size xl defaults to h1", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Heading size="xl" data-testid="heading">
          Title
        </Heading>
      </TestWrapper>,
    );
    expect(getByTestId("heading").element().tagName).toBe("H1");
  });

  test("size lg defaults to h1", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Heading size="lg" data-testid="heading">
          Title
        </Heading>
      </TestWrapper>,
    );
    expect(getByTestId("heading").element().tagName).toBe("H1");
  });

  test("size md defaults to h2", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Heading size="md" data-testid="heading">
          Title
        </Heading>
      </TestWrapper>,
    );
    expect(getByTestId("heading").element().tagName).toBe("H2");
  });

  test("size sm defaults to h3", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Heading size="sm" data-testid="heading">
          Title
        </Heading>
      </TestWrapper>,
    );
    expect(getByTestId("heading").element().tagName).toBe("H3");
  });

  test("no size prop defaults to lg (h1)", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Heading data-testid="heading">Title</Heading>
      </TestWrapper>,
    );
    expect(getByTestId("heading").element().tagName).toBe("H1");
  });

  test("`as` overrides the element without changing the size classes", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Heading size="xl" as="h4" data-testid="heading">
          Title
        </Heading>
      </TestWrapper>,
    );
    const el = getByTestId("heading").element();
    expect(el.tagName).toBe("H4");
    expect(el.className).toContain("text-heading-xl");
  });

  test("muted swaps to the muted text color class", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Heading muted data-testid="heading">
          Title
        </Heading>
      </TestWrapper>,
    );
    const el = getByTestId("heading").element();
    expect(el.className).toContain("text-text-muted");
    expect(el.className).not.toContain("text-text-primary");
  });

  test("default (not muted) uses the primary text color class", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Heading data-testid="heading">Title</Heading>
      </TestWrapper>,
    );
    expect(getByTestId("heading").element().className).toContain("text-text-primary");
  });

  test("className passthrough merges onto the recipe classes", async () => {
    const { getByTestId } = await render(
      <TestWrapper>
        <Heading className="custom-class" data-testid="heading">
          Title
        </Heading>
      </TestWrapper>,
    );
    expect(getByTestId("heading").element().className).toContain("custom-class");
  });
});
