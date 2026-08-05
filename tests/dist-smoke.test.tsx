/**
 * Nothing else in this suite imports from the built dist/ output — every
 * other test resolves against src/ directly (ui#29 dispatch 2 plan
 * §Verification, "nothing in this repo tests the built dist/ today").
 * This is a deliberately minimal smoke test, not a full re-run of the
 * component suite against dist/: it exists to catch a build-shape
 * regression (an export the package.json exports field promises but the
 * actual build doesn't produce, a runtime import the bundler failed to
 * externalize correctly, etc.) that src/-only tests structurally cannot
 * see, since they never exercise the built artifact at all.
 */
import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { Button } from "../dist/index.js";
import { TestWrapper } from "./test-wrapper";

describe("dist/ build smoke test", () => {
  it("mounts a representative exported component from the built output without throwing", async () => {
    const screen = await render(
      <TestWrapper>
        <Button>Built from dist</Button>
      </TestWrapper>,
    );
    await expect.element(page.getByText("Built from dist")).toBeInTheDocument();
  });
});
