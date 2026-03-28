import React, { useState } from "react";
import { Scene, SceneColumn, SceneObject, useCamera } from "../../src";
import { Button } from "../../src";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

/** Consistent panel card used across all demos. */
function Panel({
  title,
  subtitle,
  color,
  focused,
  onClick,
  children,
}: {
  title: string;
  subtitle?: string;
  color: string;
  focused: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        opacity: focused ? 1 : 0.4,
        filter: focused ? "none" : "grayscale(1)",
        cursor: focused ? "default" : "pointer",
        width: "100%",
        height: "100%",
      }}
      className={`${color} rounded-sm p-6 flex flex-col gap-2 transition-[filter,opacity] duration-300`}
      onClick={onClick}
    >
      <h3 className="text-base font-light text-white/90">{title}</h3>
      {subtitle && <p className="text-xs text-white/50">{subtitle}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo 1: Basic focus/unfocus (2 columns)
// ---------------------------------------------------------------------------

function BasicFocusDemo() {
  const [leftFocused, setLeftFocused] = useState(true);
  const [rightFocused, setRightFocused] = useState(true);

  return (
    <DemoSection
      title="Basic focus/unfocus"
      description="Two columns. Click a panel to toggle focus."
      controls={
        <>
          <Button size="sm" ghost={!leftFocused} onClick={() => setLeftFocused((v) => !v)}>
            Left: {leftFocused ? "focused" : "unfocused"}
          </Button>
          <Button size="sm" ghost={!rightFocused} onClick={() => setRightFocused((v) => !v)}>
            Right: {rightFocused ? "focused" : "unfocused"}
          </Button>
        </>
      }
    >
      <Scene duration={300}>
        <SceneColumn name="left">
          <SceneObject name="left-panel" focused={leftFocused} style={{ width: 300, height: "100%" }}>
            <Panel
              title="Left Panel"
              subtitle="300px wide"
              color="bg-[lch(30_10_280)]"
              focused={leftFocused}
              onClick={!leftFocused ? () => setLeftFocused(true) : undefined}
            />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="right">
          <SceneObject name="right-panel" focused={rightFocused} style={{ width: 300, height: "100%" }}>
            <Panel
              title="Right Panel"
              subtitle="300px wide"
              color="bg-[lch(30_10_340)]"
              focused={rightFocused}
              onClick={!rightFocused ? () => setRightFocused(true) : undefined}
            />
          </SceneObject>
        </SceneColumn>
        <CameraDebug />
      </Scene>
    </DemoSection>
  );
}

// ---------------------------------------------------------------------------
// Demo 2: Vertical swap within a column
// ---------------------------------------------------------------------------

type ArticleTarget = "article-1" | "article-2";

function VerticalSwapDemo() {
  const [active, setActive] = useState<ArticleTarget>("article-1");

  return (
    <DemoSection
      title="Vertical swap"
      description="Two objects share one column. Selecting an article swaps the column content."
      controls={
        <>
          {(["article-1", "article-2"] as const).map((t) => (
            <Button key={t} size="sm" ghost={active !== t} onClick={() => setActive(t)}>
              {t}
            </Button>
          ))}
        </>
      }
    >
      <Scene duration={300}>
        <SceneColumn name="nav">
          <SceneObject name="nav-panel" focused style={{ width: 180, height: "100%" }}>
            <Panel title="Nav" subtitle="always focused" color="bg-[lch(30_10_200)]" focused />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="content">
          <SceneObject name="article-1" focused={active === "article-1"} style={{ width: 420 }}>
            <Panel
              title="Article 1"
              subtitle="420px wide"
              color="bg-[lch(30_10_340)]"
              focused={active === "article-1"}
              onClick={active !== "article-1" ? () => setActive("article-1") : undefined}
            />
          </SceneObject>
          <SceneObject name="article-2" focused={active === "article-2"} style={{ width: 420 }}>
            <Panel
              title="Article 2"
              subtitle="420px wide"
              color="bg-[lch(30_15_10)]"
              focused={active === "article-2"}
              onClick={active !== "article-2" ? () => setActive("article-2") : undefined}
            />
          </SceneObject>
        </SceneColumn>
        <CameraDebug />
      </Scene>
    </DemoSection>
  );
}

// ---------------------------------------------------------------------------
// Demo 3: Horizontal scroll (wide content overflows the viewport)
// ---------------------------------------------------------------------------

function HorizontalScrollDemo() {
  return (
    <DemoSection
      title="Horizontal scroll"
      description="Four focused columns exceed the viewport width. Scroll horizontally to pan the camera."
    >
      <Scene duration={300}>
        {["col-a", "col-b", "col-c", "col-d"].map((name, i) => {
          const colors = [
            "bg-[lch(30_10_280)]",
            "bg-[lch(30_10_200)]",
            "bg-[lch(30_10_120)]",
            "bg-[lch(30_10_340)]",
          ];
          return (
            <SceneColumn key={name} name={name}>
              <SceneObject name={`${name}-obj`} focused style={{ width: 400, height: "100%" }}>
                <Panel
                  title={`Column ${String.fromCharCode(65 + i)}`}
                  subtitle="400px wide"
                  color={colors[i] ?? "bg-[lch(30_10_280)]"}
                  focused
                />
              </SceneObject>
            </SceneColumn>
          );
        })}
        <CameraDebug />
      </Scene>
    </DemoSection>
  );
}

// ---------------------------------------------------------------------------
// Demo 4: Vertical scroll (tall content in a single column)
// ---------------------------------------------------------------------------

function VerticalScrollDemo() {
  return (
    <DemoSection
      title="Vertical scroll"
      description="Content taller than the viewport. Scroll vertically within the column (trackpad or keyboard)."
    >
      <Scene duration={300}>
        <SceneColumn name="col">
          <SceneObject name="tall-content" focused style={{ width: 480 }}>
            <div className="bg-[lch(25_8_280)] rounded-sm p-6 flex flex-col gap-4">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="bg-white/5 rounded p-4">
                  <h4 className="text-white/80 text-sm font-light">Section {i + 1}</h4>
                  <p className="text-white/40 text-xs mt-1">
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt.
                  </p>
                </div>
              ))}
            </div>
          </SceneObject>
        </SceneColumn>
        <CameraDebug />
      </Scene>
    </DemoSection>
  );
}

// ---------------------------------------------------------------------------
// Demo 5: Depth deck (3 columns, middle unfocused = in-between stacking)
// ---------------------------------------------------------------------------

function DepthDeckDemo() {
  const [middleFocused, setMiddleFocused] = useState(false);

  return (
    <DemoSection
      title="Depth deck"
      description="Middle column is unfocused and in-between two focused columns — it stacks as a depth deck."
      controls={
        <Button size="sm" ghost={middleFocused} onClick={() => setMiddleFocused((v) => !v)}>
          Middle: {middleFocused ? "focused" : "in depth deck"}
        </Button>
      }
    >
      <Scene duration={300}>
        <SceneColumn name="left">
          <SceneObject name="left-obj" focused style={{ width: 300, height: "100%" }}>
            <Panel title="Left" subtitle="always focused" color="bg-[lch(30_10_280)]" focused />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="middle">
          <SceneObject
            name="middle-obj"
            focused={middleFocused}
            style={{ width: 300, height: "100%" }}
          >
            <Panel
              title="Middle"
              subtitle="in-between depth deck"
              color="bg-[lch(30_10_200)]"
              focused={middleFocused}
              onClick={!middleFocused ? () => setMiddleFocused(true) : undefined}
            />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="right">
          <SceneObject name="right-obj" focused style={{ width: 300, height: "100%" }}>
            <Panel title="Right" subtitle="always focused" color="bg-[lch(30_10_120)]" focused />
          </SceneObject>
        </SceneColumn>
        <CameraDebug />
      </Scene>
    </DemoSection>
  );
}

// ---------------------------------------------------------------------------
// Demo 6: Debug mode toggle
// ---------------------------------------------------------------------------

function DebugModeDemo() {
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [activeArticle, setActiveArticle] = useState<ArticleTarget>("article-1");
  const [sidebarFocused, setSidebarFocused] = useState(true);

  return (
    <DemoSection
      title="Debug mode"
      description="Debug mode shows colored outlines, an overlay with object state, column positions, and scroll info."
      controls={
        <Button size="sm" ghost={!debugEnabled} onClick={() => setDebugEnabled((v) => !v)}>
          Debug: {debugEnabled ? "on" : "off"}
        </Button>
      }
    >
      <Scene duration={300} debug={debugEnabled} padding={8}>
        <SceneColumn name="nav">
          <SceneObject name="nav-panel" focused style={{ width: 180, height: "100%" }}>
            <Panel title="Nav" subtitle="always focused" color="bg-[lch(30_10_280)]" focused />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="content">
          <SceneObject
            name="article-1"
            focused={activeArticle === "article-1"}
            style={{ width: 420 }}
          >
            <Panel
              title="Article 1"
              color="bg-[lch(30_10_340)]"
              focused={activeArticle === "article-1"}
              onClick={
                activeArticle !== "article-1" ? () => setActiveArticle("article-1") : undefined
              }
            />
          </SceneObject>
          <SceneObject
            name="article-2"
            focused={activeArticle === "article-2"}
            style={{ width: 420 }}
          >
            <Panel
              title="Article 2"
              color="bg-[lch(30_15_10)]"
              focused={activeArticle === "article-2"}
              onClick={
                activeArticle !== "article-2" ? () => setActiveArticle("article-2") : undefined
              }
            />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="sidebar">
          <SceneObject
            name="sidebar-panel"
            focused={sidebarFocused}
            style={{ width: 180, height: "100%" }}
          >
            <Panel
              title="Sidebar"
              subtitle="togglable"
              color="bg-[lch(30_10_200)]"
              focused={sidebarFocused}
              onClick={!sidebarFocused ? () => setSidebarFocused(true) : undefined}
            />
          </SceneObject>
        </SceneColumn>
        <CameraDebug />
      </Scene>
    </DemoSection>
  );
}

// ---------------------------------------------------------------------------
// Layout wrapper for each demo section
// ---------------------------------------------------------------------------

function DemoSection({
  title,
  description,
  controls,
  children,
}: {
  title: string;
  description: string;
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-light">{title}</h2>
        <p className="text-text-secondary text-sm mt-0.5">{description}</p>
      </div>
      {controls && <div className="flex gap-2 flex-wrap items-center">{controls}</div>}
      <div className="h-64 border border-rule-subtle rounded-sm overflow-hidden">
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ScenePage() {
  return (
    <div className="flex flex-col p-8 gap-10 max-w-6xl mx-auto">
      <header>
        <h1 className="text-3xl font-light">Scene</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Spatial navigation system — focused columns share viewport space, unfocused columns
          freeze and slide offscreen or stack as a depth deck.
        </p>
      </header>

      <BasicFocusDemo />
      <VerticalSwapDemo />
      <HorizontalScrollDemo />
      <VerticalScrollDemo />
      <DepthDeckDemo />
      <DebugModeDemo />
    </div>
  );
}
