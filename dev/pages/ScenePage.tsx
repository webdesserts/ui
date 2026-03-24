import { useState } from "react";
import { Scene, SceneObject, useCamera } from "../../src";
import { Button } from "../../src";

type FocusTarget = "panel-1" | "panel-2" | "panel-3" | "all";

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
  "panel-1": "bg-[lch(30_10_280)]",
  "panel-2": "bg-[lch(30_10_340)]",
  "panel-3": "bg-[lch(30_10_200)]",
} as const;

export function ScenePage() {
  const [focus, setFocus] = useState<FocusTarget>("panel-1");
  const [padding, setPadding] = useState(16);

  const isFocused = (panel: Exclude<FocusTarget, "all">) =>
    focus === "all" || focus === panel;

  return (
    <div className="h-screen flex flex-col p-8 gap-6">
      <header className="shrink-0">
        <h1 className="text-3xl font-light">Scene</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Spatial navigation container. Focused objects form a flex row; unfocused objects are hidden.
        </p>
      </header>

      {/* Navigation controls */}
      <section className="shrink-0 space-y-3">
        <div className="flex gap-2 flex-wrap">
          {(["panel-1", "panel-2", "panel-3", "all"] as const).map((target) => (
            <Button
              key={target}
              size="sm"
              ghost={focus !== target}
              onClick={() => setFocus(target)}
            >
              {target}
            </Button>
          ))}
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

      {/* The Scene — fills remaining space */}
      <section className="flex-1 min-h-0 border border-rule-subtle rounded-sm overflow-hidden">
        <Scene padding={padding} duration={0}>
          <SceneObject name="panel-1" focused={isFocused("panel-1")}>
            <div
              style={{
                width: 300,
                height: 200,
                transform: isFocused("panel-1") ? "perspective(30in)" : "perspective(30in) translateZ(-80px)",
                opacity: isFocused("panel-1") ? 1 : 0.4,
                filter: isFocused("panel-1") ? "none" : "grayscale(1)",
                cursor: isFocused("panel-1") ? "default" : "pointer",
              }}
              className={`${panelColors["panel-1"]} rounded-sm p-6 flex flex-col transition-[filter,opacity,transform] duration-300`}
              onClick={() => !isFocused("panel-1") && setFocus("panel-1")}
            >
              <h2 className="text-lg font-light text-white/90">Panel 1</h2>
              <p className="text-sm text-white/50 mt-auto">
                300 × 200 · {isFocused("panel-1") ? "focused" : "click to focus"}
              </p>
            </div>
          </SceneObject>

          <SceneObject name="panel-2" focused={isFocused("panel-2")}>
            <div
              style={{
                width: 400,
                height: 300,
                transform: isFocused("panel-2") ? "perspective(30in)" : "perspective(30in) translateZ(-80px)",
                opacity: isFocused("panel-2") ? 1 : 0.4,
                filter: isFocused("panel-2") ? "none" : "grayscale(1)",
                cursor: isFocused("panel-2") ? "default" : "pointer",
              }}
              className={`${panelColors["panel-2"]} rounded-sm p-6 flex flex-col transition-[filter,opacity,transform] duration-300`}
              onClick={() => !isFocused("panel-2") && setFocus("panel-2")}
            >
              <h2 className="text-lg font-light text-white/90">Panel 2</h2>
              <p className="text-sm text-white/50 mt-auto">
                400 × 300 · {isFocused("panel-2") ? "focused" : "click to focus"}
              </p>
            </div>
          </SceneObject>

          <SceneObject name="panel-3" focused={isFocused("panel-3")}>
            <div
              style={{
                width: 250,
                height: 250,
                transform: isFocused("panel-3") ? "perspective(30in)" : "perspective(30in) translateZ(-80px)",
                opacity: isFocused("panel-3") ? 1 : 0.4,
                filter: isFocused("panel-3") ? "none" : "grayscale(1)",
                cursor: isFocused("panel-3") ? "default" : "pointer",
              }}
              className={`${panelColors["panel-3"]} rounded-sm p-6 flex flex-col transition-[filter,opacity,transform] duration-300`}
              onClick={() => !isFocused("panel-3") && setFocus("panel-3")}
            >
              <h2 className="text-lg font-light text-white/90">Panel 3</h2>
              <p className="text-sm text-white/50 mt-auto">
                250 × 250 · {isFocused("panel-3") ? "focused" : "click to focus"}
              </p>
            </div>
          </SceneObject>

          <CameraDebug />
        </Scene>
      </section>
    </div>
  );
}
