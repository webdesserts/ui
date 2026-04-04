/**
 * CSS perspective platform assumptions that Scene depends on.
 *
 * Validates whether CSS perspective on a flex stage container is compatible
 * with:
 * 1. Flex child layout (does perspective change computed positions?)
 * 2. position:absolute children with translateZ
 * 3. motion layout FLIP animations inside a perspective container
 *
 * These are platform invariants — if any of them regress in a browser update,
 * Scene's depth deck behavior will silently break.
 */

import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import React, { useState } from "react";
import { motion } from "motion/react";
import { TestWrapper } from "./test-wrapper";
import { waitForAnimationFrame } from "./utils/animation";

// ---------------------------------------------------------------------------
// Q1: Does perspective on a flex parent affect flex child layout?
// ---------------------------------------------------------------------------

describe("CSS perspective: flex child layout", () => {
  test("perspective on flex container does NOT shift flex children layout", async () => {
    // A flex container with two children. We add perspective mid-render via
    // rerender and check that the children's layout hasn't changed.

    function FlexContainer({ withPerspective }: { withPerspective: boolean }) {
      return (
        <div
          data-testid="flex-container"
          style={{
            display: "flex",
            flexDirection: "row",
            width: 600,
            height: 200,
            ...(withPerspective ? { perspective: "800px" } : {}),
          }}
        >
          <div data-testid="child-a" style={{ flex: "1 1 0", background: "red" }} />
          <div data-testid="child-b" style={{ flex: "1 1 0", background: "blue" }} />
        </div>
      );
    }

    // Render without perspective first, capture layout
    const { getByTestId, rerender } = await render(
      <TestWrapper fullPage>
        <FlexContainer withPerspective={false} />
      </TestWrapper>,
    );

    const aWithout = getByTestId("child-a").element().getBoundingClientRect();
    const bWithout = getByTestId("child-b").element().getBoundingClientRect();

    // Add perspective — layout should not change
    await rerender(
      <TestWrapper fullPage>
        <FlexContainer withPerspective />
      </TestWrapper>,
    );

    const aWith = getByTestId("child-a").element().getBoundingClientRect();
    const bWith = getByTestId("child-b").element().getBoundingClientRect();

    // Children should be at the same positions regardless of perspective
    expect(aWith.left).toBeCloseTo(aWithout.left, 0);
    expect(aWith.width).toBeCloseTo(aWithout.width, 0);
    expect(bWith.left).toBeCloseTo(bWithout.left, 0);
    expect(bWith.width).toBeCloseTo(bWithout.width, 0);
  });
});

// ---------------------------------------------------------------------------
// Q2: position:absolute + translateZ inside perspective container
// ---------------------------------------------------------------------------

describe("CSS perspective: translateZ on absolute children", () => {
  test("translateZ(-200px) shrinks an absolute child visually (perspective projection)", async () => {
    // An absolute child with translateZ applied inside a perspective container
    // should appear smaller due to perspective projection.
    // We detect this by comparing getBoundingClientRect() sizes — the projected
    // size should be smaller than the element's natural width.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <div
          style={{
            position: "relative",
            width: 600,
            height: 400,
            perspective: "400px",
            transformStyle: "preserve-3d",
          }}
        >
          {/* Absolute child at the center of the container */}
          <div
            data-testid="natural"
            style={{
              position: "absolute",
              top: 100,
              left: 200,
              width: 200,
              height: 100,
              background: "red",
            }}
          />
          <div
            data-testid="pushed-back"
            style={{
              position: "absolute",
              top: 100,
              left: 200,
              width: 200,
              height: 100,
              background: "blue",
              transform: "translateZ(-100px)",
            }}
          />
        </div>
      </TestWrapper>,
    );

    const natural = getByTestId("natural").element().getBoundingClientRect();
    const pushedBack = getByTestId("pushed-back").element().getBoundingClientRect();

    // The pushed-back element should appear smaller due to perspective
    // (perspective=400px, translateZ=-100px → scale = 400/(400+100) = 0.8)
    expect(pushedBack.width).toBeLessThan(natural.width);
    expect(pushedBack.height).toBeLessThan(natural.height);
  });

  test("translateZ(-200px) shifts element toward perspective-origin (peeking)", async () => {
    // When perspective-origin is to the right (near the right focused column),
    // translateZ should shift unfocused elements toward the origin (left),
    // creating the "peeking left" effect for the depth deck.
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <div
          style={{
            position: "relative",
            width: 600,
            height: 400,
            // Origin near right edge — unfocused columns should peek toward left
            perspective: "600px",
            perspectiveOrigin: "500px 200px",
            transformStyle: "preserve-3d",
          }}
        >
          <div
            data-testid="natural"
            style={{
              position: "absolute",
              top: 100,
              left: 50,
              width: 200,
              height: 100,
              background: "red",
            }}
          />
          <div
            data-testid="pushed-back"
            style={{
              position: "absolute",
              top: 100,
              left: 50,
              width: 200,
              height: 100,
              background: "blue",
              transform: "translateZ(-200px)",
            }}
          />
        </div>
      </TestWrapper>,
    );

    const natural = getByTestId("natural").element().getBoundingClientRect();
    const pushedBack = getByTestId("pushed-back").element().getBoundingClientRect();

    // Pushed-back element should shift left (toward perspective origin on the right)
    // Actually: perspective-origin on the right means elements shift LEFT when pushed back
    // The element at left:50 pushed back should appear at a left position closer to the origin
    // Since origin is at x=500 and element is at x=50, pushed back moves element TOWARD x=500
    // Wait — perspective-origin on right means "vanishing point is on the right"
    // Elements pushed back should move toward the vanishing point (right), so left increases
    // Let's just check that the center shifts (not exactly which direction — that depends on
    // whether the element is left or right of the perspective-origin).
    const naturalCenter = natural.left + natural.width / 2;
    const pushedCenter = pushedBack.left + pushedBack.width / 2;

    // The center should shift toward the perspective origin (500px from left)
    // Element is at ~50+100=150px center, origin at 500px — shift should be rightward
    expect(pushedCenter).toBeGreaterThan(naturalCenter);
  });
});

// ---------------------------------------------------------------------------
// Q3: motion layout FLIP inside perspective container
// ---------------------------------------------------------------------------

describe("CSS perspective: motion layout FLIP in perspective container", () => {
  test("motion layout FLIP works correctly inside a perspective container", async () => {
    // A motion.div with layout={true} inside a perspective container.
    // After a layout change, motion should correctly FLIP-animate from old
    // to new position. With duration=0, it should snap to final position.

    function PerspectiveScene({ wide }: { wide: boolean }) {
      return (
        <div
          style={{
            position: "relative",
            width: 600,
            height: 200,
            perspective: "800px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              width: "100%",
              height: "100%",
            }}
          >
            <motion.div
              layout
              data-testid="flex-child"
              transition={{ duration: 0 }}
              style={{
                flex: wide ? "2 1 0" : "1 1 0",
                background: "red",
                height: "100%",
              }}
            />
            <motion.div
              layout
              transition={{ duration: 0 }}
              style={{
                flex: "1 1 0",
                background: "blue",
                height: "100%",
              }}
            />
          </div>
        </div>
      );
    }

    function TestScene() {
      const [wide, setWide] = useState(false);
      return (
        <div>
          <button data-testid="toggle" onClick={() => setWide((w) => !w)}>
            Toggle
          </button>
          <PerspectiveScene wide={wide} />
        </div>
      );
    }

    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <TestScene />
      </TestWrapper>,
    );

    const flexChild = getByTestId("flex-child").element() as HTMLElement;
    const initialWidth = flexChild.getBoundingClientRect().width;

    // Toggle: flex-child should grow to 2x width (600 * 2/3 = 400px)
    await getByTestId("toggle").click();
    await waitForAnimationFrame();

    const newWidth = flexChild.getBoundingClientRect().width;

    // After the layout change, the element should have a larger width
    expect(newWidth).toBeGreaterThan(initialWidth);
    // And the width should be correct (approx 2/3 of 600 = 400)
    expect(newWidth).toBeGreaterThan(300);
  });
});
