import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { diff as blazediff } from "@blazediff/core";
import { Scene, SceneColumn, SceneObject } from "../../src";
import { TestWrapper } from "../test-wrapper";
import { wait } from "../utils/animation";

/**
 * Sentinels for ui/t:12 (design/ui/p:6). A 2026-07-22 investigation concluded
 * "backdrop-filter has never rendered in this repo's vitest screenshots" —
 * that conclusion was FALSIFIED by direct measurement on 2026-08-06 (full
 * record: "plans/ui/t:12 Backdrop-Filter Screenshots Plan"). Blur has rendered
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

// ---------------------------------------------------------------------------
// blur-live (ui/t:18): the same forced-none methodology as
// "comparator-blindness" above, but over a REAL Scene and with the assertion
// INVERTED — a zero delta is the failure mode this ticket exists to kill.
//
// The two sentinels above use a bare glass panel over a dot-grid with no
// Scene involved, so what they pin is the comparator's blindness to blur in
// general. This one pins what ui/t:18 actually changed. Scene's depth deck
// used to emit `filter: grayscale(0)` on every column node and every object
// node, focused ones included; any `filter` makes its element a Backdrop
// Root, so a glass surface inside a Scene had a backdrop root one or two
// nodes above it and blurred nothing at all. Measured on this exact fixture:
// with the release reverted, blur-on and blur-off render IDENTICALLY over
// the decked sibling (ratio 1.00000); with it in place, 0.206.
//
// It cannot use blazediff, for the reason "comparator-blindness" documents —
// the production comparator cannot see blur at this magnitude. It uses the
// non-blind `luminanceStdDev` metric from "blur-present-in-capture", over
// the MEASURED overlap of panel and decked sibling rather than a hardcoded
// band, so a geometry change surfaces as a legible non-vacuity failure
// instead of a silently-empty sample region.
// ---------------------------------------------------------------------------

const SCENE_WIDTH = 1000;
const SCENE_HEIGHT = 800;

/**
 * The WITHIN-COLUMN depth deck: three objects in one column, the middle one
 * sandwiched between two focused siblings and therefore decked — it keeps
 * its depth treatment (greyscale, opacity 0.8) and sits behind the lower
 * focused sibling, peeking up by peekOffset. The lower focused sibling holds
 * a real `.glass-panel` recipe element, so the panel and the decked object
 * genuinely overlap and the panel is genuinely in front.
 *
 * `duration={0}` because this is a REST-state question — the deck's settled
 * geometry — and the instant path removes a spring's worth of timing from a
 * screenshot test that already costs two renders.
 *
 * Content lives in child divs (not SceneObject's own style prop), matching
 * scene-within-column-deck.test.tsx's own fixture shape — the shape that
 * file's tests prove actually collapses the sandwiched anchor out of flow.
 */
function WithinColumnDeckScene({ blurOff }: { blurOff?: boolean }) {
  return (
    <Scene duration={0}>
      <SceneColumn name="col">
        <SceneObject name="obj-a" focused>
          <div data-testid="deck-content-a" style={{ width: 400, height: 150 }}>A</div>
        </SceneObject>
        <SceneObject name="obj-b" focused={false}>
          <div
            data-testid="decked-object"
            style={{
              width: 400,
              height: 250,
              backgroundImage: "repeating-linear-gradient(0deg, #fff 0 8px, #000 8px 16px)",
            }}
          />
        </SceneObject>
        <SceneObject name="obj-c" focused>
          <div
            data-testid="scene-panel"
            className="glass-panel rounded-md"
            style={{
              width: 400,
              height: 250,
              ...(blurOff ? { backdropFilter: "none", WebkitBackdropFilter: "none" } : {}),
            }}
          />
        </SceneObject>
      </SceneColumn>
    </Scene>
  );
}

/**
 * Left and right focused, middle decked — a decked COLUMN rather than a
 * decked object. Used only by the limitation sentinel below.
 */
function DeckedColumnScene({ blurOff }: { blurOff?: boolean }) {
  return (
    <Scene>
      <SceneColumn name="left">
        <SceneObject name="left-object" focused style={{ width: 200, height: 400 }}>
          content
        </SceneObject>
      </SceneColumn>
      <SceneColumn name="middle">
        <SceneObject name="middle-object" focused={false} style={{ width: 400, height: 500 }}>
          <div
            data-testid="decked-column-content"
            style={{
              width: 400,
              height: 500,
              backgroundImage: "repeating-linear-gradient(0deg, #fff 0 8px, #000 8px 16px)",
            }}
          />
        </SceneObject>
      </SceneColumn>
      <SceneColumn name="right">
        <SceneObject name="right-object" focused style={{ width: 400, height: 500 }}>
          <div
            data-testid="scene-panel"
            className="glass-panel rounded-md"
            style={{
              width: 400,
              height: 500,
              ...(blurOff ? { backdropFilter: "none", WebkitBackdropFilter: "none" } : {}),
            }}
          />
        </SceneObject>
      </SceneColumn>
    </Scene>
  );
}

/**
 * Renders one arm, settles it, and returns the capture plus the sample
 * region derived from where the panel and the decked element ACTUALLY
 * landed. Fractions are relative to the captured container, so the 2x device
 * scale factor never needs reconciling.
 */
async function captureDeckArm(
  scene: (props: { blurOff?: boolean }) => React.ReactElement,
  deckedTestId: string,
  blurOff: boolean,
  settleMs: number,
) {
  const SceneFixture = scene;
  await page.viewport(SCENE_WIDTH, SCENE_HEIGHT);
  const screen = await render(
    <TestWrapper fullPage width={SCENE_WIDTH} height={SCENE_HEIGHT}>
      <SceneFixture blurOff={blurOff} />
    </TestWrapper>,
  );
  await wait(settleMs);

  const container = screen.container as HTMLElement;
  const panel = screen.getByTestId("scene-panel").element() as HTMLElement;
  const decked = screen.getByTestId(deckedTestId).element() as HTMLElement;
  const deckedObjectNode = decked.closest("[data-ui-scene-object]") as HTMLElement;

  const containerRect = container.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const deckedRect = decked.getBoundingClientRect();
  // Inset so the sample never straddles either box's own edge antialiasing.
  const pad = 10;
  const left = Math.max(panelRect.left, deckedRect.left) + pad;
  const right = Math.min(panelRect.right, deckedRect.right) - pad;
  const top = Math.max(panelRect.top, deckedRect.top) + pad;
  const bottom = Math.min(panelRect.bottom, deckedRect.bottom) - pad;

  const measurements = {
    backdropFilter: getComputedStyle(panel).backdropFilter,
    deckedOpacity: Number(getComputedStyle(deckedObjectNode).opacity),
    topmostOverOverlap: document.elementFromPoint((left + right) / 2, (top + bottom) / 2),
    panelIsTopmost:
      document.elementFromPoint((left + right) / 2, (top + bottom) / 2) === panel,
    overlapWidth: right - left,
    overlapHeight: bottom - top,
    xFrac: [
      (left - containerRect.left) / containerRect.width,
      (right - containerRect.left) / containerRect.width,
    ] as [number, number],
    yFrac: [
      (top - containerRect.top) / containerRect.height,
      (bottom - containerRect.top) / containerRect.height,
    ] as [number, number],
  };

  const base64 = await page.screenshot({ element: container, save: false });
  await screen.unmount();
  return { base64, ...measurements };
}

// Measured on this exact recipe: 1.00000 with the release reverted, 0.206
// with it in place (re-measured 0.2032 post ui/t:14's viewport-scale fix —
// consistent nudge from anti-aliasing at a different render scale, not a
// regression). 0.5 separates two clusters an order of magnitude apart — not
// a threshold that needs tuning.
const BLUR_LIVE_MAX_RATIO = 0.5;

describe("blur-live: a glass panel in a focused Scene object samples the decked sibling behind it (ui/t:18)", () => {
  it("blur-live-over-decked-sibling: forcing backdrop-filter off changes the render, i.e. the blur has something to sample", async () => {
    document.documentElement.style.colorScheme = "dark";

    const on = await captureDeckArm(WithinColumnDeckScene, "decked-object", false, 300);
    const off = await captureDeckArm(WithinColumnDeckScene, "decked-object", true, 300);

    // Non-vacuity. Without these a zero delta could equally mean "the panel
    // has no backdrop-filter in either arm", "the deck never engaged", "the
    // panel isn't actually in front", or "the sample region is empty" — none
    // of which say anything about backdrop roots.
    expect(on.backdropFilter, "ON arm must carry a real backdrop-filter").not.toBe("none");
    expect(off.backdropFilter, "OFF arm must genuinely have none").toBe("none");
    expect(on.panelIsTopmost, "the panel must be painted in FRONT of the decked sibling").toBe(true);
    expect(on.overlapWidth, "panel and decked sibling must actually overlap horizontally").toBeGreaterThan(100);
    expect(on.overlapHeight, "panel and decked sibling must actually overlap vertically").toBeGreaterThan(100);
    expect(off.xFrac, "both arms must be measuring the same region").toEqual(on.xFrac);
    expect(off.yFrac, "both arms must be measuring the same region").toEqual(on.yFrac);

    const imageOn = await decodePng(on.base64);
    const imageOff = await decodePng(off.base64);
    expect(imageOn.width).toBe(imageOff.width);
    expect(imageOn.height).toBe(imageOff.height);

    const stdDevOn = luminanceStdDev(imageOn, on.xFrac, on.yFrac);
    const stdDevOff = luminanceStdDev(imageOff, off.xFrac, off.yFrac);

    // Control arm: with blur forced off the decked sibling's stripes must read
    // through the panel's own translucency as genuinely non-flat. If this
    // fails the instrument is broken and the ratio below proves nothing.
    expect(stdDevOff, "blur-off arm must read the decked sibling's stripes as non-flat").toBeGreaterThan(10);

    expect(
      stdDevOn / stdDevOff,
      `blur must measurably flatten the decked sibling behind the panel (on=${stdDevOn.toFixed(4)} off=${stdDevOff.toFixed(4)})`,
    ).toBeLessThan(BLUR_LIVE_MAX_RATIO);
  });

  it("deck-opacity-confirmed: the sampled sibling is at depth opacity 0.8 — opacity<1 on a SIBLING does not block sampling", async () => {
    // Criterion 4's empirical half. An ancestor with opacity < 1 DOES root the
    // backdrop (measured: 0.99 on an ancestor takes the ratio to 0.967), but
    // the deck only ever writes opacity < 1 on a DECKED element, which is a
    // sibling of the focused one, never an ancestor of its panel. The test
    // above shows a sibling at 0.8 being sampled normally; this pins the
    // precondition that makes that mean what it says — if the deck ever
    // stopped dimming decked siblings, the test above would keep passing
    // while no longer proving anything about opacity at all.
    document.documentElement.style.colorScheme = "dark";
    const on = await captureDeckArm(WithinColumnDeckScene, "decked-object", false, 300);
    expect(on.deckedOpacity, "the decked sibling must be genuinely translucent").toBeCloseTo(0.8, 2);
  });

  it("cross-column-deck-limitation: a decked COLUMN is still NOT sampled — preserve-3d, not the filter, is what blocks it", async () => {
    // KNOWN LIMITATION, pinned deliberately (same spirit as
    // "comparator-blindness" above: a red here is GOOD news, not a flake).
    //
    // ui/t:18 removed the identity filter, which is what blocked sampling
    // WITHIN a column. It does not make a glass panel sample a decked
    // neighbouring COLUMN, because the depth deck's perspective projection
    // needs `transform-style: preserve-3d` on the scene viewport, the stage
    // and every column anchor — and backdrop-filter does not sample across a
    // 3D rendering context. Established by leave-one-out ablation on the live
    // DOM: no single one of those three levels restores sampling on its own;
    // only flattening ALL of them together does. Removing perspective is
    // irrelevant either way. Restoring cross-column sampling therefore means
    // restructuring how the deck renders depth, which is a different ticket.
    //
    // The exact ratios below are NOT a stable baseline — do not treat them as
    // a target to reproduce. Two independent runs landed on different
    // numbers (this branch's own ablation: single-level ~0.806, all-three
    // ~0.157; the ui/t:18 claim gate's independent reproduction: single-level
    // 1.00000, all-three 0.02702) because flattening `transform-style` also
    // removes perspective foreshortening, which changes the fixture's
    // measured overlap region as a side effect (335x424 vs 368x480 across the
    // gate's own arms) — a confounded leave-one-out, not a repeatable
    // measurement. Both runs land on the same side of BLUR_LIVE_MAX_RATIO in
    // both the single-level and all-three cases, which is the only claim
    // this test (and the qualitative statement above) relies on.
    //
    // If this ever flips green, cross-column glass has started working —
    // revisit this file and the ticket rather than deleting the test.
    document.documentElement.style.colorScheme = "dark";

    const on = await captureDeckArm(DeckedColumnScene, "decked-column-content", false, 1200);
    const off = await captureDeckArm(DeckedColumnScene, "decked-column-content", true, 1200);

    expect(on.backdropFilter, "ON arm must carry a real backdrop-filter").not.toBe("none");
    expect(off.backdropFilter, "OFF arm must genuinely have none").toBe("none");
    expect(on.panelIsTopmost, "the panel must be painted in FRONT of the decked column").toBe(true);
    expect(on.overlapWidth).toBeGreaterThan(100);
    expect(on.overlapHeight).toBeGreaterThan(100);

    const stdDevOn = luminanceStdDev(await decodePng(on.base64), on.xFrac, on.yFrac);
    const stdDevOff = luminanceStdDev(await decodePng(off.base64), off.xFrac, off.yFrac);
    expect(stdDevOff, "the decked column's stripes must be visible through the panel").toBeGreaterThan(10);
    expect(
      stdDevOn / stdDevOff,
      `cross-column sampling is expected to be blocked by preserve-3d (on=${stdDevOn.toFixed(4)} off=${stdDevOff.toFixed(4)})`,
    ).toBeGreaterThan(BLUR_LIVE_MAX_RATIO);
  });
});
