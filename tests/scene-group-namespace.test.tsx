/**
 * ui#26 — Tailwind group-namespace collision regression pin.
 *
 * SceneObject's focus-ring anchor carried a bare Tailwind `group` class
 * (ui#21, commit 86df8f7) so its own `group-focus-visible:` ring variant
 * could target the panel below. Tailwind's bare `group-*:` variant compiles
 * to `:where(.group):hover &` — it matches ANY ancestor with class `.group`,
 * not just the nearest one. Since the anchor wraps a SceneObject's entire
 * panel and all consumer content, hovering ANYWHERE inside a SceneObject's
 * rendered card set `:hover` on the anchor, which then falsely activated any
 * unrelated consumer's own bare-group-hover pairing nested anywhere in that
 * subtree — the production symptom (feed #2360-#2363, ui#p26): hovering
 * anywhere on an agent-task chat column popped EVERY reply tooltip, not just
 * the one under the cursor. ui#26 fixed the leak by naming the anchor's
 * group (`group/scene-object`), narrowing its variants to match only that
 * specific ancestor. This test pins the fix: a consumer's own bare
 * `group`/`group-hover:` pairing, nested inside a focused SceneObject, must
 * fire only from its own local hover — never from hovering elsewhere inside
 * the SceneObject.
 */

import { describe, test, expect } from "vitest";
import { render } from "vitest-browser-react";
import { Scene, SceneColumn, SceneObject } from "../src";
import { TestWrapper } from "./test-wrapper";
import { waitForSceneSettled } from "./utils/animation";

describe("SceneObject Tailwind group namespace (ui#26): consumer bare-group isolation", () => {
  test("hovering elsewhere in the SceneObject does not leak into a nested consumer's own bare group-hover", async () => {
    const { getByTestId } = await render(
      <TestWrapper fullPage>
        <Scene duration={0}>
          <SceneColumn name="stack-col">
            <SceneObject name="host" focused style={{ width: 400 }}>
              <div style={{ height: 100 }} data-testid="host-empty-area">
                no consumer group here
              </div>
              <div className="group" data-testid="consumer-trigger" style={{ height: 40 }}>
                <span className="opacity-0 group-hover:opacity-100" data-testid="consumer-target">
                  tooltip
                </span>
              </div>
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );

    const scene = getByTestId("scene").element() as HTMLElement;
    await waitForSceneSettled(scene, { timeoutMs: 2000 });

    // Non-vacuity precondition: the anchor actually carries the named
    // group — proves the rename landed, so a false pass can't happen
    // simply because the group class vanished entirely.
    const anchor = scene.querySelector('[data-scene-id="host"]') as HTMLElement;
    expect(anchor.className).toContain("group/scene-object");

    const target = getByTestId("consumer-target").element() as HTMLElement;
    expect(getComputedStyle(target).opacity).toBe("0");

    // The collision case from the production bug: hovering a point inside
    // the SceneObject's own subtree that is OUTSIDE the consumer's local
    // group box must NOT activate the consumer's bare group-hover.
    await getByTestId("host-empty-area").hover();
    expect(getComputedStyle(target).opacity).toBe("0");

    // The consumer's own local bare-group pairing still fires normally on
    // its own hover — proves this test isn't just universally suppressing
    // hover.
    await getByTestId("consumer-trigger").hover();
    expect(getComputedStyle(target).opacity).toBe("1");
  });
});
