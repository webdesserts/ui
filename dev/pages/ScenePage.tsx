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
    <div className="h-screen flex flex-col p-8 gap-6">
      <header className="shrink-0">
        <h1 className="text-3xl font-light">Scene</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Animated camera that frames focused objects with spring physics.
        </p>
      </header>

      {/* Navigation controls */}
      <section className="shrink-0 space-y-3">
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

      {/* The Scene — fills remaining space, scrolls when content overflows */}
      <section className="flex-1 min-h-0 border border-rule-subtle rounded-sm overflow-y-auto flex items-center justify-center">
        <Scene padding={padding}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "320px 480px",
              gridTemplateRows: "240px auto",
              gap: "32px",
            }}
          >
            {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(
              (panel) => {
                const focused = isFocused(panel);
                const isTall = panel === "bottom-right";
                return (
                  <SceneObject key={panel} name={panel} focused={focused}>
                    <div
                      className={`${panelColors[panel]} rounded-sm p-6 h-full flex flex-col transition-[filter,opacity,transform] duration-300`}
                      style={{
                        transform: focused ? "perspective(30in)" : "perspective(30in) translateZ(-80px)",
                        opacity: focused ? 1 : 0.4,
                        filter: focused ? "none" : "grayscale(1)",
                        cursor: focused ? "default" : "pointer",
                      }}
                      onClick={() => !focused && setFocus(panel)}
                    >
                      <h2 className="text-lg font-light text-white/90">{panel}</h2>
                      {isTall && (
                        <div className="space-y-4 my-4 flex-1">
                          {Array.from({ length: 12 }, (_, i) => (
                            <div key={i} className="bg-white/5 rounded-sm p-3">
                              <p className="text-sm text-white/60">Item {i + 1}</p>
                              <p className="text-xs text-white/30 mt-1">
                                This panel is tall enough to need scrolling when focused.
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-sm text-white/50 mt-auto">
                        {isTall ? "480 x 900+ — scrollable" : `${panel.startsWith("top") ? "240" : "360"}px tall`}
                        {" · "}
                        {focused ? "focused" : "click to focus"}
                      </p>
                    </div>
                  </SceneObject>
                );
              },
            )}
          </div>

          <CameraDebug />
        </Scene>
      </section>
    </div>
  );
}
