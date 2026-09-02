import { describe, test, expect } from "vitest";
import { useState } from "react";
import { render } from "vitest-browser-react";
import { Scene, SceneObject, SceneColumn } from "../src";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame, wait } from "./utils/animation";

// ---------------------------------------------------------------------------
// Backdrop roots (ui/t:18). A glass surface's `backdrop-filter` samples the
// content behind it only as far back as its nearest BACKDROP ROOT — and per
// the Filter Effects spec an ancestor forms one as soon as it carries a
// `filter`, however visually inert that filter is. Scene's depth deck emitted
// `filter: grayscale(0)` on EVERY column and object node including focused
// ones, so every glass surface inside a Scene had a backdrop root two nodes
// above it and sampled nothing but its own column.
//
// Measured directly, isolated fixture, 2026-09-02 (blur-on vs blur-off
// luminance-stdDev ratio over the same overlapped region; ~0.03 = blur is
// sampling the content behind, ~0.97 = it is sampling nothing):
//
//   ancestor carries                ratio     verdict
//   ------------------------------  --------  --------
//   nothing                         0.02910   samples
//   filter: none                    0.02910   samples
//   filter: grayscale(0)            0.96509   BLOCKED
//   will-change: filter             1.00000   BLOCKED
//   will-change: opacity            1.00000   BLOCKED
//   opacity: 0.99                   0.96736   BLOCKED
//   isolation: isolate              0.02910   samples
//   contain: paint                  0.02910   samples
//   transform: translateZ(0)        0.03015   samples
//   will-change: transform          0.03015   samples
//
// Two consequences this file pins. `filter: grayscale(0)` really is the bug
// (an identity filter is still a backdrop root), and `will-change` naming
// filter or opacity would reintroduce it even with the filter released —
// which is why the will-change pin below is not busywork. `isolation:
// isolate` (the column content wrapper's click-targeting fix) and the
// column's own 3D transform are confirmed harmless and stay untouched.
// ---------------------------------------------------------------------------

/** Properties that make an element a backdrop root for its descendants. */
const BACKDROP_ROOTING_WILL_CHANGE = ["filter", "opacity", "mask", "backdrop-filter"];

function ancestorChain(from: HTMLElement, toInclusive: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let el: HTMLElement | null = from;
  while (el) {
    chain.push(el);
    if (el === toInclusive) return chain;
    el = el.parentElement;
  }
  throw new Error("ancestorChain: never reached the stage — fixture shape changed");
}

function describeEl(el: HTMLElement): string {
  const attrs = Array.from(el.attributes)
    .filter((a) => a.name.startsWith("data-ui") || a.name === "data-testid")
    .map((a) => `${a.name}="${a.value}"`)
    .join(" ");
  return `<${el.tagName.toLowerCase()}${attrs ? " " + attrs : ""}>`;
}

/**
 * Left and right focused, middle decked — the suite's dominant sibling-reflow
 * shape. The right column carries a real `.glass-panel` recipe element so the
 * chain under test is the production one (panel -> object -> anchor -> column
 * content -> column -> column anchor -> stage), not a synthetic stand-in.
 */
function GlassStackDemo({ midFocused = false }: { midFocused?: boolean }) {
  return (
    <Scene>
      <SceneColumn name="left">
        <SceneObject name="left-object" focused style={{ width: 200, height: 300 }}>
          content
        </SceneObject>
      </SceneColumn>
      <SceneColumn name="middle">
        <SceneObject name="middle-object" focused={midFocused} style={{ width: 200, height: 300 }}>
          content
        </SceneObject>
      </SceneColumn>
      <SceneColumn name="right">
        <SceneObject name="right-object" focused style={{ width: 200, height: 300 }}>
          <div data-testid="panel" className="glass-panel rounded-md" style={{ width: 200, height: 300 }} />
        </SceneObject>
      </SceneColumn>
    </Scene>
  );
}

describe("Scene backdrop roots: nothing between a glass panel and the stage roots the backdrop", () => {
  test("no-identity-filter: no ancestor of a focused column's glass panel carries a filter at rest", async () => {
    const screen = await render(
      <TestWrapper fullPage>
        <GlassStackDemo />
      </TestWrapper>,
    );
    await wait(1200);

    const panel = screen.getByTestId("panel").element() as HTMLElement;
    const stage = document.querySelector("[data-ui-scene-stage]") as HTMLElement;
    const chain = ancestorChain(panel, stage);

    // Non-vacuity, three ways. The panel must genuinely be a backdrop-filter
    // element (otherwise there is no backdrop root question to ask); the
    // chain must genuinely contain the two nodes that used to carry the
    // identity filter (otherwise a selector slip passes this test while the
    // bug is untouched); and the DECKED column must still carry a real,
    // non-identity filter (otherwise the depth machinery is simply off and
    // "no filters anywhere" is meaningless).
    expect(getComputedStyle(panel).backdropFilter, "fixture panel must carry a real backdrop-filter").not.toBe("none");
    expect(
      chain.some((el) => el.hasAttribute("data-ui-scene-object")),
      "chain must include the object node (a former identity-filter emitter)",
    ).toBe(true);
    expect(
      chain.some((el) => el.hasAttribute("data-ui-scene-column")),
      "chain must include the column node (a former identity-filter emitter)",
    ).toBe(true);
    const deckedColumn = document
      .querySelector('[data-ui-scene-column-anchor="middle"]')!
      .querySelector("[data-ui-scene-column]") as HTMLElement;
    expect(getComputedStyle(deckedColumn).filter, "the decked column must still be greyed — depth treatment is alive").toBe(
      "grayscale(0.25)",
    );

    const offenders = chain
      .filter((el) => getComputedStyle(el).filter !== "none")
      .map((el) => `${describeEl(el)} filter=${getComputedStyle(el).filter}`);
    expect(offenders, "no element between the glass panel and the stage may carry a filter").toEqual([]);
  });

  test("will-change-clean: no ancestor of the glass panel carries a backdrop-rooting will-change at rest", async () => {
    const screen = await render(
      <TestWrapper fullPage>
        <GlassStackDemo />
      </TestWrapper>,
    );
    await wait(1200);

    const panel = screen.getByTestId("panel").element() as HTMLElement;
    const stage = document.querySelector("[data-ui-scene-stage]") as HTMLElement;
    const chain = ancestorChain(panel, stage);

    expect(getComputedStyle(panel).backdropFilter, "fixture panel must carry a real backdrop-filter").not.toBe("none");
    expect(chain.length, "chain must span the full panel-to-stage path").toBeGreaterThan(4);

    // What Motion actually leaves, measured: nothing. `will-change` appears
    // nowhere in src/ by hand, and Motion 12.42.2 does not leave a residual
    // `will-change` on a node it has sprung `filter`/`opacity` through — the
    // whole chain reads the initial `auto`, at rest AND mid-spring (sampled
    // frame-by-frame across a full focus toggle). So no clear was needed;
    // this criterion is a pin on that measured cleanliness, not on a fix.
    const offenders = chain
      .map((el) => ({ el, willChange: getComputedStyle(el).willChange }))
      .filter(({ willChange }) =>
        willChange
          .split(",")
          .map((s) => s.trim())
          .some((prop) => BACKDROP_ROOTING_WILL_CHANGE.includes(prop)),
      )
      .map(({ el, willChange }) => `${describeEl(el)} will-change=${willChange}`);
    expect(offenders, "no element between the glass panel and the stage may name a backdrop-rooting will-change").toEqual(
      [],
    );
  });

  test("will-change-clean holds mid-spring too, not only at rest", async () => {
    function Demo() {
      const [midFocused, setMidFocused] = useState(true);
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidFocused((v) => !v)}>
            toggle
          </button>
          <GlassStackDemo midFocused={midFocused} />
        </TestWrapper>
      );
    }
    const screen = await render(<Demo />);
    await wait(900);

    const panel = screen.getByTestId("panel").element() as HTMLElement;
    const stage = document.querySelector("[data-ui-scene-stage]") as HTMLElement;

    (screen.getByTestId("toggle").element() as HTMLElement).click();

    const offenders = new Set<string>();
    for (let frame = 0; frame < 30; frame++) {
      await waitForAnimationFrame();
      for (const el of ancestorChain(panel, stage)) {
        const willChange = getComputedStyle(el).willChange;
        if (
          willChange
            .split(",")
            .map((s) => s.trim())
            .some((prop) => BACKDROP_ROOTING_WILL_CHANGE.includes(prop))
        ) {
          offenders.add(`${describeEl(el)} will-change=${willChange}`);
        }
      }
    }
    expect([...offenders], "a mid-spring will-change would root the backdrop for the rest of the transition").toEqual([]);
  });

  test("deck-opacity-confirmed: the decked column's opacity<1 sits on a SIBLING subtree, never on the panel's chain", async () => {
    // Criterion 4's structural half. An ancestor with opacity < 1 DOES root
    // the backdrop (measured, see this file's header table), so the question
    // is whether the depth deck's own `opacity: 0.8` can ever land on the
    // focused panel's ancestor chain. It cannot: depth opacity is only ever
    // written on an in-between column, and an in-between column is a SIBLING
    // of the focused one. The empirical other half — that a decked sibling at
    // opacity 0.8 is still sampled by the focused column's blur — is proven
    // by pixels in tests/visual/backdrop-filter-capture.test.tsx
    // ("blur-live-over-decked-sibling").
    const screen = await render(
      <TestWrapper fullPage>
        <GlassStackDemo />
      </TestWrapper>,
    );
    await wait(1200);

    const panel = screen.getByTestId("panel").element() as HTMLElement;
    const stage = document.querySelector("[data-ui-scene-stage]") as HTMLElement;
    const chain = ancestorChain(panel, stage);

    const deckedColumn = document
      .querySelector('[data-ui-scene-column-anchor="middle"]')!
      .querySelector("[data-ui-scene-column]") as HTMLElement;

    // The deck's opacity is real (non-vacuity) ...
    expect(Number(getComputedStyle(deckedColumn).opacity)).toBeCloseTo(0.8, 2);
    // ... and it is not on the panel's chain ...
    expect(chain).not.toContain(deckedColumn);
    // ... and nothing on the panel's chain is translucent either.
    const translucent = chain
      .filter((el) => Number(getComputedStyle(el).opacity) < 1)
      .map((el) => `${describeEl(el)} opacity=${getComputedStyle(el).opacity}`);
    expect(translucent, "an ancestor with opacity<1 would root the backdrop").toEqual([]);
  });
});

describe("Scene backdrop roots: releasing the filter keeps the depth transition smooth", () => {
  /**
   * THE SMOOTH RULING (Michael, 2026-w31): sibling-reflow focus changes
   * animate smoothly rather than snap, "on the principle that Scene's whole
   * purpose is smooth visual continuity" — he ruled this way overturning a
   * snap recommendation. Releasing the identity filter at rest must not buy
   * criterion 1 by turning the depth treatment into a two-state toggle.
   *
   * No existing helper samples filter/opacity over time (the camera-toggle
   * helper records cameraX retargets; the flip tests read layout boxes), so
   * this walks the real left/middle/right fixture frame by frame through a
   * genuine sibling-reflow focus toggle.
   *
   * Why "intermediate values" rather than a per-frame step bound: under full
   * suite contention the browser drops frames, which legitimately widens any
   * single step. A snap is not a large step, it is the ABSENCE of
   * intermediate values — a two-state toggle emits only the endpoints, no
   * matter how the sampler is scheduled. The generous step bound below is a
   * second, independent guard against a fix that ramps only at the very end.
   */
  const RANGE = 0.25; // depth-1 grayscale
  const MIN_INTERMEDIATE_SAMPLES = 5;
  const MAX_SINGLE_STEP = RANGE * 0.6;

  function readGrayscale(el: HTMLElement): number {
    const filter = getComputedStyle(el).filter;
    if (filter === "none") return 0;
    const match = /grayscale\(([\d.e-]+)\)/.exec(filter);
    if (!match) throw new Error(`unexpected filter value: ${filter}`);
    return Number(match[1]);
  }

  async function sampleToggle(direction: "unfocus" | "refocus") {
    function Demo() {
      const [midFocused, setMidFocused] = useState(direction === "unfocus");
      return (
        <TestWrapper fullPage>
          <button data-testid="toggle" onClick={() => setMidFocused((v) => !v)}>
            toggle
          </button>
          <GlassStackDemo midFocused={midFocused} />
        </TestWrapper>
      );
    }
    const screen = await render(<Demo />);
    await wait(900); // full initial settle before the toggle under test

    const columnNode = document
      .querySelector('[data-ui-scene-column-anchor="middle"]')!
      .querySelector("[data-ui-scene-column]") as HTMLElement;

    (screen.getByTestId("toggle").element() as HTMLElement).click();

    const grayscales: number[] = [];
    const opacities: number[] = [];
    for (let frame = 0; frame < 40; frame++) {
      await waitForAnimationFrame();
      grayscales.push(readGrayscale(columnNode));
      opacities.push(Number(getComputedStyle(columnNode).opacity));
    }
    return { grayscales, opacities };
  }

  function assertRamped(samples: number[], lo: number, hi: number, label: string) {
    const strictlyBetween = samples.filter((v) => v > lo + (hi - lo) * 0.04 && v < hi - (hi - lo) * 0.04);
    expect(
      strictlyBetween.length,
      `${label}: a snap emits only the endpoints; saw ${strictlyBetween.length} intermediate samples in ${JSON.stringify(samples)}`,
    ).toBeGreaterThanOrEqual(MIN_INTERMEDIATE_SAMPLES);
    let worstStep = 0;
    for (let i = 1; i < samples.length; i++) worstStep = Math.max(worstStep, Math.abs(samples[i] - samples[i - 1]));
    expect(worstStep, `${label}: largest single-frame step in ${JSON.stringify(samples)}`).toBeLessThan(
      (MAX_SINGLE_STEP / RANGE) * (hi - lo),
    );
  }

  test("unfocus: the column's own greyscale and opacity ramp continuously", async () => {
    const { grayscales, opacities } = await sampleToggle("unfocus");
    assertRamped(grayscales, 0, 0.25, "greyscale");
    assertRamped(opacities, 0.8, 1, "opacity");
  });

  test("refocus: the column's own greyscale and opacity ramp continuously", async () => {
    const { grayscales, opacities } = await sampleToggle("refocus");
    assertRamped(grayscales, 0, 0.25, "greyscale");
    assertRamped(opacities, 0.8, 1, "opacity");
  });
});
