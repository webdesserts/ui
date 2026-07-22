import { describe, it, expect, afterEach } from "vitest";
import type { CSSProperties } from "react";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";

/**
 * Glass panel comparison fixtures (ui#6 Slice 1a, "Glass Parity Plan
 * (ui#6)"). Every shipped glass example (dev site + the Button/IconButton/
 * ButtonGroup fixtures) is a small control in a ~1rem crop; this renders
 * candidate treatments at TaskDetail's real proportions instead — a
 * near-full-height wide column — over two backdrop scenarios, so
 * alpha/blur/border legibility at panel scale can be judged visually before
 * any token changes land (Slice 1b). Candidate values are literal inline
 * overrides, not new custom properties — nothing here should be adopted
 * as-is until Michael picks a candidate from these baselines.
 */

const PANEL_WIDTH = 1000;
const PANEL_HEIGHT = 960;

afterEach(async () => {
  document.documentElement.style.colorScheme = "";
  // page.viewport() sets the actual iframe viewport (not just a CSS box),
  // and it leaks across tests/files without an explicit reset — see
  // scene-mobile.test.tsx. The real viewport must be >= the fullPage
  // container so the panel-height screenshot (960px) isn't clipped by the
  // project's default 800px viewport.
  await page.viewport(1280, 800);
});

// ---------------------------------------------------------------------------
// Candidate glass treatments
// ---------------------------------------------------------------------------

type GlassCandidate = { className?: string; style?: CSSProperties };

const CANDIDATES: Record<
  "baseline" | "baselineBorder" | "strongerAlphaBlur" | "strongerAlphaBorder",
  { light: GlassCandidate; dark: GlassCandidate }
> = {
  // Current control-grade tokens (--glass-bg / --glass-blur), unchanged.
  baseline: {
    light: { className: "bg-glass-bg backdrop-blur-[var(--glass-blur)]" },
    dark: { className: "bg-glass-bg backdrop-blur-[var(--glass-blur)]" },
  },
  // Baseline fill plus the voice-chat-prototype's glass panel border, verbatim
  // (settings-modal.tsx:133 / profile-panel.tsx:16): a 1px solid border in
  // --color-rule-subtle. Michael recalled the prototype giving glass panels
  // "a very slight transparent border to help distinguish them from their
  // outer content" — his leaned-toward direction after the first round.
  baselineBorder: {
    light: { className: "bg-glass-bg border border-rule-subtle backdrop-blur-[var(--glass-blur)]" },
    dark: { className: "bg-glass-bg border border-rule-subtle backdrop-blur-[var(--glass-blur)]" },
  },
  // Panel-grade alpha/blur, no border — isolates the fill vector. Raises
  // lightness, not just alpha: --glass-bg's lightness (15/96) sits within ~5
  // units of --surface-base's (10/95) in both modes, so alpha alone barely
  // moves the blended result against a same-hue backdrop (confirmed empirically
  // — a bump-alpha-only draft of this candidate produced a max 9/255 delta
  // from baseline, i.e. visually indistinguishable). A wider lightness gap is
  // required for "stronger" to actually read as stronger.
  strongerAlphaBlur: {
    light: { style: { background: "lch(82 7 30 / 0.75)", backdropFilter: "blur(16px)" } },
    dark: { style: { background: "lch(32 8 315 / 0.6)", backdropFilter: "blur(16px)" } },
  },
  // Same stronger fill, plus a panel-scale (2px vs Button's 1px) full-perimeter
  // border using the existing --color-rule-subtle — tests whether a border
  // reads as a "stray outline" at panel scale, per the plan's open question.
  strongerAlphaBorder: {
    light: {
      className: "shadow-[inset_0_0_0_2px_var(--color-rule-subtle)]",
      style: { background: "lch(82 7 30 / 0.75)", backdropFilter: "blur(16px)" },
    },
    dark: {
      className: "shadow-[inset_0_0_0_2px_var(--color-rule-subtle)]",
      style: { background: "lch(32 8 315 / 0.6)", backdropFilter: "blur(16px)" },
    },
  },
};

// ---------------------------------------------------------------------------
// Fixture — a wide glass column over a backdrop, with a strip of backdrop
// left exposed (and, for the "with cards" backdrop, straddled by a couple of
// cards) so blur/alpha legibility can be judged against both the exposed and
// covered backdrop in the same frame.
// ---------------------------------------------------------------------------

function RaisedCards() {
  const card = "bg-surface-raised rounded-md";
  return (
    <>
      <div className={card} style={{ position: "absolute", left: 20, top: 40, width: 180, height: 110 }} />
      <div className={card} style={{ position: "absolute", left: 20, top: 170, width: 180, height: 110 }} />
      <div className={card} style={{ position: "absolute", left: 100, top: 300, width: 200, height: 110 }} />
      <div className={card} style={{ position: "absolute", left: 100, top: 430, width: 200, height: 110 }} />
    </>
  );
}

function GlassPanel({ candidate }: { candidate: GlassCandidate }) {
  return (
    <div
      className={`rounded-md p-6 ${candidate.className ?? ""}`}
      style={{ position: "absolute", inset: "40px 40px 40px 220px", ...candidate.style }}
    >
      <div className="text-text-primary" style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
        Task detail panel
      </div>
      <div className="text-text-secondary" style={{ fontFamily: "monospace", fontSize: 13 }}>
        Comparison fixture: candidate glass treatment at panel scale.
      </div>
    </div>
  );
}

function Fixture({ candidate, cards }: { candidate: GlassCandidate; cards?: boolean }) {
  return (
    <div className="dot-grid bg-surface-base" style={{ position: "relative", width: "100%", height: "100%" }}>
      {cards && <RaisedCards />}
      <GlassPanel candidate={candidate} />
    </div>
  );
}

async function renderFixture(candidate: GlassCandidate, cards: boolean) {
  await page.viewport(PANEL_WIDTH, PANEL_HEIGHT);
  const screen = await render(
    <TestWrapper fullPage width={PANEL_WIDTH} height={PANEL_HEIGHT}>
      <Fixture candidate={candidate} cards={cards} />
    </TestWrapper>,
  );
  await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
}

// ---------------------------------------------------------------------------
// Flat dot-grid backdrop
// ---------------------------------------------------------------------------

describe("Glass panel flat dot-grid backdrop", () => {
  it("glass-panel-baseline-dotgrid-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderFixture(CANDIDATES.baseline.dark, false);
  });

  it("glass-panel-baseline-dotgrid-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderFixture(CANDIDATES.baseline.light, false);
  });

  it("glass-panel-baseline-border-dotgrid-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderFixture(CANDIDATES.baselineBorder.dark, false);
  });

  it("glass-panel-baseline-border-dotgrid-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderFixture(CANDIDATES.baselineBorder.light, false);
  });

  it("glass-panel-stronger-alpha-blur-dotgrid-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderFixture(CANDIDATES.strongerAlphaBlur.dark, false);
  });

  it("glass-panel-stronger-alpha-blur-dotgrid-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderFixture(CANDIDATES.strongerAlphaBlur.light, false);
  });

  it("glass-panel-stronger-alpha-border-dotgrid-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderFixture(CANDIDATES.strongerAlphaBorder.dark, false);
  });

  it("glass-panel-stronger-alpha-border-dotgrid-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderFixture(CANDIDATES.strongerAlphaBorder.light, false);
  });
});

// ---------------------------------------------------------------------------
// dot-grid + raised cards backdrop (depth-decked board rows)
// ---------------------------------------------------------------------------

describe("Glass panel dot-grid with cards backdrop", () => {
  it("glass-panel-baseline-dotgrid-cards-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderFixture(CANDIDATES.baseline.dark, true);
  });

  it("glass-panel-baseline-dotgrid-cards-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderFixture(CANDIDATES.baseline.light, true);
  });

  it("glass-panel-baseline-border-dotgrid-cards-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderFixture(CANDIDATES.baselineBorder.dark, true);
  });

  it("glass-panel-baseline-border-dotgrid-cards-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderFixture(CANDIDATES.baselineBorder.light, true);
  });

  it("glass-panel-stronger-alpha-blur-dotgrid-cards-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderFixture(CANDIDATES.strongerAlphaBlur.dark, true);
  });

  it("glass-panel-stronger-alpha-blur-dotgrid-cards-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderFixture(CANDIDATES.strongerAlphaBlur.light, true);
  });

  it("glass-panel-stronger-alpha-border-dotgrid-cards-dark", async () => {
    document.documentElement.style.colorScheme = "dark";
    await renderFixture(CANDIDATES.strongerAlphaBorder.dark, true);
  });

  it("glass-panel-stronger-alpha-border-dotgrid-cards-light", async () => {
    document.documentElement.style.colorScheme = "light";
    await renderFixture(CANDIDATES.strongerAlphaBorder.light, true);
  });
});
