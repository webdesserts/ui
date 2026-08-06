import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { diff as blazediff } from "@blazediff/core";
import { TestWrapper } from "../test-wrapper";

/**
 * Sentinels for ui#12 (ui#p6). A 2026-07-22 investigation concluded
 * "backdrop-filter has never rendered in this repo's vitest screenshots" —
 * that conclusion was FALSIFIED by direct measurement on 2026-08-06 (full
 * record: "plans/ui#12 Backdrop-Filter Screenshots Plan"). Blur has rendered
 * through the standard capture path since the visual-testing suite's
 * founding commit; the committed glass baselines already carry the same
 * blur gradient this file measures. The real gap is that the suite's
 * comparator (@blazediff/core, the same "pixelmatch" comparator
 * `toMatchScreenshot` uses) is structurally incapable of flagging a
 * production-magnitude (8px, low-contrast dark-mode) blur difference — an
 * 8px blur against dark colors never crosses its per-pixel color-distance
 * threshold anywhere in a 2.16-megapixel capture. This file pins both
 * halves of that finding as permanent regression sentinels rather than
 * leaving them as one-off investigation results:
 *
 * - "blur-present-in-capture" fails if the capture path itself ever stops
 *   rendering blur (the thing the 2026-07-22 investigation believed was
 *   already true).
 * - "comparator-blindness" fails if the comparator ever becomes able to see
 *   blur at this magnitude (see the comment on that assertion for why a
 *   flip there is a revisit signal, not noise).
 *
 * Fixture: verbatim reproduction of glass-panel.test.tsx's RaisedCards +
 * GlassPanel (dark, cards=true, the `baselineBorder`/`.glass-panel`
 * candidate) at that file's own PANEL_WIDTH/PANEL_HEIGHT — the exact
 * production recipe and geometry the 2026-08-06 probe used, per the plan's
 * binding re-gate note (an exaggerated blur radius could cross the
 * comparator's threshold and either spuriously fail sentinel (b) or guard
 * an artificial risk instead of the real one).
 */

const WIDTH = 1000;
const HEIGHT = 960;

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

function GlassPanel({ blurOff }: { blurOff?: boolean }) {
  return (
    <div
      data-testid="glass-panel"
      className="rounded-md p-6 glass-panel"
      style={{
        position: "absolute",
        inset: "40px 40px 40px 220px",
        ...(blurOff ? { backdropFilter: "none", WebkitBackdropFilter: "none" } : {}),
      }}
    >
      <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
        Task detail panel
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 13 }}>Comparison fixture: candidate glass treatment.</div>
    </div>
  );
}

function Fixture({ blurOff }: { blurOff?: boolean }) {
  return (
    <div className="dot-grid bg-surface-base" style={{ position: "relative", width: "100%", height: "100%" }}>
      <RaisedCards />
      <GlassPanel blurOff={blurOff} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capture decode + metric
// ---------------------------------------------------------------------------

async function decodePng(base64: string): Promise<ImageData> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Population standard deviation of pixel luminance across a fractional
 * region of the image (fractions, not pixels, so a capture-dimension
 * surprise never needs reconciling mid-test). High = the dot-grid backdrop
 * still resolved; near-zero = smoothed away by blur.
 */
function luminanceStdDev(image: ImageData, xFrac: [number, number], yFrac: [number, number]): number {
  const { width, height, data } = image;
  const x0 = Math.round(xFrac[0] * width);
  const x1 = Math.round(xFrac[1] * width);
  const y0 = Math.round(yFrac[0] * height);
  const y1 = Math.round(yFrac[1] * height);
  const samples: number[] = [];
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const luminance = (data[i] + data[i + 1] + data[i + 2]) / 3;
      samples.push(luminance);
      sum += luminance;
    }
  }
  const mean = sum / samples.length;
  const variance = samples.reduce((acc, v) => acc + (v - mean) ** 2, 0) / samples.length;
  return Math.sqrt(variance);
}

// Control: dot-grid backdrop below all four raised cards (y >= 550), left of
// the panel (x < 220) — untouched by the panel in every condition. Panel:
// dot-grid interior at the same row band but inside the panel and clear of
// any card (cards only reach x <= 300; panel starts at x = 220).
const CONTROL_X: [number, number] = [0.05, 0.15];
const PANEL_X: [number, number] = [0.5, 0.8];
const SAMPLE_Y: [number, number] = [0.6, 0.9];

// The control region's dot-grid pattern reads a small but non-zero stdev
// (~3.6 observed); panel/control collapses to effectively 0 when blur is
// rendering (~1e-10, i.e. the panel interior goes perfectly flat). 0.5 sits
// with wide margin below "no blur" (ratio ~1, panel as noisy as control)
// and wide margin above the observed blurred reading.
const BLUR_PRESENT_MAX_RATIO = 0.5;

describe("backdrop-filter capture sentinels (ui#12)", () => {
  it("blur-present-in-capture: the panel region reads meaningfully flatter than its own in-capture control", async () => {
    document.documentElement.style.colorScheme = "dark";
    await page.viewport(WIDTH, HEIGHT);
    const screen = await render(
      <TestWrapper fullPage width={WIDTH} height={HEIGHT}>
        <Fixture />
      </TestWrapper>,
    );
    const base64 = await page.screenshot({ element: screen.container, save: false });
    await screen.unmount();

    const image = await decodePng(base64);
    const control = luminanceStdDev(image, CONTROL_X, SAMPLE_Y);
    const panel = luminanceStdDev(image, PANEL_X, SAMPLE_Y);

    // Control-arm sanity: the dot-grid backdrop outside the panel must read
    // as non-flat regardless of the panel's own state. If this assertion
    // fails, the decode/sampling instrument itself is broken — don't trust
    // the panel reading below until this is fixed.
    expect(control, "control region (dot-grid outside the panel) must read non-flat").toBeGreaterThan(1);
    expect(panel / control, "panel region should read meaningfully flatter than its control (blur present)").toBeLessThan(
      BLUR_PRESENT_MAX_RATIO,
    );
  });

  it("comparator-blindness: the production comparator reports zero diff between blur-on and blur-off captures", async () => {
    document.documentElement.style.colorScheme = "dark";
    await page.viewport(WIDTH, HEIGHT);

    const screenOn = await render(
      <TestWrapper fullPage width={WIDTH} height={HEIGHT}>
        <Fixture />
      </TestWrapper>,
    );
    const panelOnEl = screenOn.getByTestId("glass-panel").element() as HTMLElement;
    const computedOn = getComputedStyle(panelOnEl).backdropFilter;
    const base64On = await page.screenshot({ element: screenOn.container, save: false });
    await screenOn.unmount();

    const screenOff = await render(
      <TestWrapper fullPage width={WIDTH} height={HEIGHT}>
        <Fixture blurOff />
      </TestWrapper>,
    );
    const panelOffEl = screenOff.getByTestId("glass-panel").element() as HTMLElement;
    const computedOff = getComputedStyle(panelOffEl).backdropFilter;
    const base64Off = await page.screenshot({ element: screenOff.container, save: false });
    await screenOff.unmount();

    // Non-vacuity: the OFF arm must genuinely have no backdrop-filter
    // applied, and the ON arm must genuinely have one — otherwise a zero
    // diff below would prove nothing about the comparator at all.
    expect(computedOff, "OFF arm must compute to no backdrop-filter").toBe("none");
    expect(computedOn, "ON arm must compute to a real backdrop-filter").not.toBe("none");

    const imageOn = await decodePng(base64On);
    const imageOff = await decodePng(base64Off);
    expect(imageOn.width).toBe(imageOff.width);
    expect(imageOn.height).toBe(imageOff.height);

    const mismatchedPixels = blazediff(imageOn.data, imageOff.data, undefined, imageOn.width, imageOn.height, {
      // Mirrors @vitest/browser's resolved toMatchScreenshot defaults
      // exactly (defaultOptions.screenshotOptions / the pixelmatch
      // comparator's own defaults — comparatorOptions is `{}` by default,
      // so nothing here is a repo-specific override).
      threshold: 0.1,
      alpha: 0.1,
      aaColor: [255, 255, 0],
      diffColor: [255, 0, 0],
      includeAA: false,
      diffMask: false,
    });

    // A red HERE means the comparator learned to see this magnitude of
    // blur — which is a genuinely good thing (revisit whether the
    // computed-style pins in glass-panel.test.tsx are still the right
    // guard, since real screenshot coverage for blur would become
    // possible), not a flake to chase. It's asserted as an exact zero, not
    // "under some ratio," because that's what was actually measured: zero
    // mismatched pixels across the full 2,160,000-pixel image, not a
    // marginal reading close to a threshold. That's consistent with the
    // 2026-07-22 investigation's own finding of byte-identical determinism
    // across 6 independent setups, and it has a concrete mechanism behind
    // it rather than being a coincidence: the design system's real 8px
    // blur, composited against this fixture's dark, low-contrast colors,
    // never produces a per-pixel color delta that crosses the comparator's
    // 0.1 threshold anywhere in the image (confirmed directly, 2026-08-06
    // probe — see the plan's §3 PROBE VERDICT for the full numbers).
    expect(mismatchedPixels).toBe(0);
  });
});
