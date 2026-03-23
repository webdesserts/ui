import { useState } from "react";
import { Scene, SceneObject, useCamera } from "../../src";
import { Button } from "../../src";

type FocusTarget = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "all";

function CameraDebug() {
  const camera = useCamera();
  return (
    <p className="text-xs text-text-muted font-mono">
      Camera: {Math.round(camera.bounds.left)},{Math.round(camera.bounds.top)}{" "}
      {Math.round(camera.bounds.width)}x{Math.round(camera.bounds.height)}
      {camera.transitioning && " (moving)"}
    </p>
  );
}

const panelColors = {
  "top-left": "bg-[lch(30_10_280)]",
  "top-right": "bg-[lch(30_10_340)]",
  "bottom-left": "bg-[lch(30_10_200)]",
  "bottom-right": "bg-[lch(30_10_100)]",
} as const;

export function ScenePage() {
  const [focus, setFocus] = useState<FocusTarget>("top-left");
  const [padding, setPadding] = useState(16);

  const isFocused = (panel: Exclude<FocusTarget, "all">) =>
    focus === "all" || focus === panel;

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-3xl font-light">Scene</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Animated camera that frames focused objects with spring physics.
        </p>
      </header>

      {/* Navigation controls */}
      <section className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {(["top-left", "top-right", "bottom-left", "bottom-right", "all"] as const).map(
            (target) => (
              <Button
                key={target}
                size="sm"
                ghost={focus !== target}
                onClick={() => setFocus(target)}
              >
                {target}
              </Button>
            ),
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-text-muted">Padding: {padding}px</label>
          <input
            type="range"
            min={0}
            max={64}
            value={padding}
            onChange={(e) => setPadding(Number(e.target.value))}
            className="w-40"
          />
        </div>
      </section>

      {/* The Scene */}
      <section className="border border-rule-subtle rounded-sm p-4 overflow-hidden">
        <Scene padding={padding}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "320px 480px",
              gridTemplateRows: "240px 360px",
              gap: "32px",
            }}
          >
            <SceneObject name="top-left" focused={isFocused("top-left")}>
              <div className={`${panelColors["top-left"]} rounded-sm p-6 h-full flex flex-col justify-between`}>
                <h2 className="text-lg font-light text-white/90">Top Left</h2>
                <p className="text-sm text-white/50">320 x 240 — standard</p>
              </div>
            </SceneObject>

            <SceneObject name="top-right" focused={isFocused("top-right")}>
              <div className={`${panelColors["top-right"]} rounded-sm p-6 h-full flex flex-col justify-between`}>
                <h2 className="text-lg font-light text-white/90">Top Right</h2>
                <p className="text-sm text-white/50">480 x 240 — wide</p>
              </div>
            </SceneObject>

            <SceneObject name="bottom-left" focused={isFocused("bottom-left")}>
              <div className={`${panelColors["bottom-left"]} rounded-sm p-6 h-full flex flex-col justify-between`}>
                <h2 className="text-lg font-light text-white/90">Bottom Left</h2>
                <p className="text-sm text-white/50">320 x 360 — tall</p>
              </div>
            </SceneObject>

            <SceneObject name="bottom-right" focused={isFocused("bottom-right")}>
              <div className={`${panelColors["bottom-right"]} rounded-sm p-6 h-full flex flex-col justify-between`}>
                <h2 className="text-lg font-light text-white/90">Bottom Right</h2>
                <p className="text-sm text-white/50">480 x 360 — large</p>
              </div>
            </SceneObject>
          </div>

          <CameraDebug />
        </Scene>
      </section>
    </div>
  );
}
