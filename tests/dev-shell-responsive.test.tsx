/**
 * Guards the dev shell's mobile layout (ui/t:15) — the shell's hamburger +
 * slide-in drawer nav, shipped in July, had zero tests exercising it at
 * phone width until this file.
 *
 * The overflow instrument asserts on BOTH `main.scrollWidth` and
 * `document.documentElement.scrollWidth`. `<main>` sets only
 * `overflow-y-auto`; per CSS Overflow Module 3, the other axis of a
 * one-axis-scrollable box computes to `auto` too, so `main` is a two-axis
 * scroll container — any page content wider than `main`'s box scrolls
 * *inside `main`'s own horizontal scrollbar* and never enlarges
 * `document.documentElement`. A document-only check is a proven false-pass
 * for exactly the failure this file exists to catch; `main` is the real
 * per-page signal, `document.documentElement` is a supplementary check for
 * overflow from `main`'s siblings (the top bar, the drawer, the outer flex
 * wrapper). Known instrument blind spot: `SelectCandidatesPage`'s five
 * `truncate` labels clip instead of overflowing, so a scrollWidth-based
 * audit cannot see a future long label silently ellipsizing.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import { TestWrapper } from "./test-wrapper";
import { App } from "@/dev/App";
import { waitForAnimationFrame } from "./utils/animation";

const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;
const DESKTOP_WIDTH = 1280;
const DESKTOP_HEIGHT = 800;

// Measured first real run: 368ms for all 12 pages sequentially (incl. the
// 1205-line ScenePage) under isolated execution. ~5.4x that, for headroom
// under full-suite contention (the flake-prone signature this suite already
// knows, ui/o:118).
const AUDIT_TIMEOUT_MS = 2_000;

afterEach(async () => {
  document.documentElement.style.colorScheme = "";
  await page.viewport(DESKTOP_WIDTH, DESKTOP_HEIGHT);
});

describe("mobile shell (390px)", () => {
  it(
    "every page renders without horizontal overflow at 390px",
    async () => {
      await page.viewport(MOBILE_WIDTH, MOBILE_HEIGHT);
      const screen = await render(
        <TestWrapper fullPage width={MOBILE_WIDTH} height={MOBILE_HEIGHT}>
          <App />
        </TestWrapper>,
      );

      const hamburger = screen.getByRole("button", { name: "Open navigation" }).element() as HTMLElement;
      const main = screen.getByRole("main").element() as HTMLElement;

      // Open the drawer once to enumerate its page buttons. The drawer is
      // always-mounted (see NavDrawer's doc comment in dev/App.tsx), so
      // these DOM node references stay valid across every later open/close
      // — no need to re-query by accessible name per page, which would risk
      // colliding with a page's own demo content.
      hamburger.click();
      await waitForAnimationFrame();
      const drawerNav = document.getElementById("mobile-nav-drawer");
      if (!drawerNav) throw new Error("nav#mobile-nav-drawer not found in the DOM");

      // Page buttons live inside NavSections' two section groups ("Tokens",
      // "Components" — dev/App.tsx's `sections` constant); the Color Mode
      // group and the drawer's own close button sit outside those two
      // headings' parent containers. A future page added to any existing
      // section is swept automatically — no test change needed.
      const sectionHeadings = Array.from(drawerNav.querySelectorAll("p")).filter(
        (p) => p.textContent === "Tokens" || p.textContent === "Components",
      );
      const pageButtons = sectionHeadings.flatMap(
        (heading) => Array.from(heading.parentElement!.querySelectorAll("button")) as HTMLButtonElement[],
      );
      expect(pageButtons.length).toBeGreaterThan(0);

      const failures: string[] = [];
      const audited: string[] = [];
      for (const [index, button] of pageButtons.entries()) {
        const label = button.textContent?.trim() || `(unlabeled button ${index})`;

        if (index > 0) {
          hamburger.click(); // reopen for every page after the first
          await waitForAnimationFrame();
        }
        button.click();
        await waitForAnimationFrame();

        const mainOverflow = main.scrollWidth > main.clientWidth + 1;
        const docOverflow =
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        const record = `${label}: main ${main.scrollWidth}/${main.clientWidth} document ${document.documentElement.scrollWidth}/${document.documentElement.clientWidth}`;
        audited.push(record);
        if (mainOverflow || docOverflow) {
          failures.push(record);
        }
      }

      // The full per-page numbers (pass or fail) are asserted into the
      // failure message here so a run always has them on record.
      expect(failures, `Overflow audit (all ${audited.length} pages):\n${audited.join("\n")}`).toEqual([]);
    },
    AUDIT_TIMEOUT_MS,
  );

  it("drawer interaction: open, Escape close, page-pick close, inert state", async () => {
    await page.viewport(MOBILE_WIDTH, MOBILE_HEIGHT);
    const screen = await render(
      <TestWrapper fullPage width={MOBILE_WIDTH} height={MOBILE_HEIGHT}>
        <App />
      </TestWrapper>,
    );

    const hamburger = screen.getByRole("button", { name: "Open navigation" }).element() as HTMLButtonElement;
    const drawerNav = document.getElementById("mobile-nav-drawer");
    if (!drawerNav) throw new Error("nav#mobile-nav-drawer not found in the DOM");
    // `inert` lives on the drawer's outer wrapper (the translated/backdrop
    // div), not on the `<nav>` itself — see NavDrawer in dev/App.tsx.
    const drawerWrapper = drawerNav.parentElement as HTMLElement & { inert: boolean };

    // Closed at rest.
    expect(hamburger.getAttribute("aria-expanded")).toBe("false");
    expect(drawerWrapper.inert).toBe(true);

    // Open: aria-expanded flips, drawer is no longer inert, focus moves in.
    hamburger.click();
    await waitForAnimationFrame();
    expect(hamburger.getAttribute("aria-expanded")).toBe("true");
    expect(drawerWrapper.inert).toBe(false);
    expect(drawerNav.contains(document.activeElement)).toBe(true);

    // Escape closes, and focus returns to the hamburger.
    await userEvent.keyboard("{Escape}");
    await waitForAnimationFrame();
    expect(hamburger.getAttribute("aria-expanded")).toBe("false");
    expect(drawerWrapper.inert).toBe(true);
    expect(document.activeElement).toBe(hamburger);

    // A page pick closes the drawer and switches main content.
    hamburger.click();
    await waitForAnimationFrame();
    const dividerButton = Array.from(drawerNav.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Divider",
    ) as HTMLButtonElement | undefined;
    if (!dividerButton) throw new Error('drawer button labeled "Divider" not found');
    dividerButton.click();
    await waitForAnimationFrame();
    expect(drawerWrapper.inert).toBe(true);
    await expect
      .element(screen.getByRole("heading", { level: 1, name: "Divider" }))
      .toBeInTheDocument();
  });
});

describe("desktop (1280px) — unchanged", () => {
  it("sidebar visible, mobile chrome hidden, main content present", async () => {
    await page.viewport(DESKTOP_WIDTH, DESKTOP_HEIGHT);
    const screen = await render(
      <TestWrapper fullPage width={DESKTOP_WIDTH} height={DESKTOP_HEIGHT}>
        <App />
      </TestWrapper>,
    );

    const container = screen.container as HTMLElement;
    // The desktop sidebar `<nav>` (no id) vs. the drawer's `<nav
    // id="mobile-nav-drawer">` — the only two `<nav>` elements in the tree.
    const sidebar = Array.from(container.querySelectorAll("nav")).find(
      (nav) => nav.id !== "mobile-nav-drawer",
    ) as HTMLElement | undefined;
    if (!sidebar) throw new Error("desktop sidebar <nav> not found");
    // A raw DOM query, not `getByRole` — at this viewport the hamburger is
    // `display: none`, which excludes it from the accessibility tree (the
    // very thing this test is confirming), so `getByRole` can't see it.
    // `aria-controls` is a stable, semantic identifier independent of the
    // `md:hidden` class the assertion below is itself proving is present.
    const hamburger = container.querySelector(
      'button[aria-controls="mobile-nav-drawer"]',
    ) as HTMLElement | null;
    if (!hamburger) throw new Error("hamburger button not found");
    const topBar = hamburger.parentElement?.parentElement as HTMLElement | null;
    if (!topBar) throw new Error("mobile top bar not found");
    // The drawer nav's parent is its outer wrapper (see NavDrawer in
    // dev/App.tsx). An id lookup, not a class selector, keeps this query
    // independent of the `md:hidden` class the assertion below is itself
    // proving is present.
    const drawerNav = document.getElementById("mobile-nav-drawer");
    if (!drawerNav) throw new Error("nav#mobile-nav-drawer not found in the DOM");
    const drawerWrapper = drawerNav.parentElement as HTMLElement | null;
    if (!drawerWrapper) throw new Error("mobile drawer wrapper not found");

    expect(getComputedStyle(sidebar).display).toBe("block");
    expect(getComputedStyle(topBar).display).toBe("none");
    expect(getComputedStyle(drawerWrapper).display).toBe("none");

    const main = screen.getByRole("main").element() as HTMLElement;
    expect(main.children.length).toBeGreaterThan(0);
  });
});
