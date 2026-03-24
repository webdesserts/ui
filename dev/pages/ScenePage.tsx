import React, { useState } from "react";
import { Scene, SceneColumn, SceneObject, useCamera } from "../../src";
import { Button } from "../../src";

type ArticleTarget = "article-1" | "article-2";

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

/** Renders a panel card with a title, subtitle, and consistent chrome. */
function Panel({
  title,
  subtitle,
  color,
  focused,
  onClick,
  children,
}: {
  title: string;
  subtitle: string;
  color: string;
  focused: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        transform: focused ? "perspective(30in)" : "perspective(30in) translateZ(-60px)",
        opacity: focused ? 1 : 0.4,
        filter: focused ? "none" : "grayscale(1)",
        cursor: focused ? "default" : "pointer",
        width: "100%",
        height: "100%",
      }}
      className={`${color} rounded-sm p-6 flex flex-col gap-2 transition-[filter,opacity,transform] duration-300`}
      onClick={onClick}
    >
      <h2 className="text-lg font-light text-white/90">{title}</h2>
      <p className="text-xs text-white/50">{subtitle}</p>
      {children && <div className="mt-auto">{children}</div>}
    </div>
  );
}

export function ScenePage() {
  const [activeArticle, setActiveArticle] = useState<ArticleTarget>("article-1");
  const [sidebarFocused, setSidebarFocused] = useState(true);
  const [padding, setPadding] = useState(16);

  return (
    <div className="h-screen flex flex-col p-8 gap-6">
      <header className="shrink-0">
        <h1 className="text-3xl font-light">Scene — Columns</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Explicit SceneColumns with vertical swap. Focused columns share horizontal space; articles swap within the content column.
        </p>
      </header>

      {/* Navigation controls */}
      <section className="shrink-0 space-y-3">
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-xs text-text-muted">Article:</span>
          {(["article-1", "article-2"] as const).map((target) => (
            <Button
              key={target}
              size="sm"
              ghost={activeArticle !== target}
              onClick={() => setActiveArticle(target)}
            >
              {target}
            </Button>
          ))}

          <span className="text-xs text-text-muted ml-4">Sidebar:</span>
          <Button
            size="sm"
            ghost={!sidebarFocused}
            onClick={() => setSidebarFocused((v) => !v)}
          >
            {sidebarFocused ? "visible" : "hidden"}
          </Button>
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
        <Scene padding={padding} duration={300}>

          {/* Column 1: fixed navigation panel — always focused */}
          <SceneColumn name="nav">
            <SceneObject name="nav-panel" focused style={{ width: 200, height: "100%" }}>
              <Panel
                title="Nav"
                subtitle="200px · always focused"
                color="bg-[lch(30_10_280)]"
                focused
              />
            </SceneObject>
          </SceneColumn>

          {/* Column 2: two articles that swap vertically */}
          <SceneColumn name="content">
            <SceneObject
              name="article-1"
              focused={activeArticle === "article-1"}
              style={{ width: 480 }}
            >
              <Panel
                title="Article 1"
                subtitle="480px wide"
                color="bg-[lch(30_10_340)]"
                focused={activeArticle === "article-1"}
                onClick={
                  activeArticle !== "article-1"
                    ? () => setActiveArticle("article-1")
                    : undefined
                }
              />
            </SceneObject>
            <SceneObject
              name="article-2"
              focused={activeArticle === "article-2"}
              style={{ width: 480 }}
            >
              <Panel
                title="Article 2"
                subtitle="480px wide"
                color="bg-[lch(30_15_10)]"
                focused={activeArticle === "article-2"}
                onClick={
                  activeArticle !== "article-2"
                    ? () => setActiveArticle("article-2")
                    : undefined
                }
              />
            </SceneObject>
          </SceneColumn>

          {/* Column 3: sidebar — can be toggled */}
          <SceneColumn name="sidebar">
            <SceneObject
              name="sidebar-panel"
              focused={sidebarFocused}
              style={{ width: 200, height: "100%" }}
            >
              <Panel
                title="Sidebar"
                subtitle="200px · togglable"
                color="bg-[lch(30_10_200)]"
                focused={sidebarFocused}
                onClick={!sidebarFocused ? () => setSidebarFocused(true) : undefined}
              />
            </SceneObject>
          </SceneColumn>

          <CameraDebug />
        </Scene>
      </section>
    </div>
  );
}
