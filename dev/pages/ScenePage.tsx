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
      Camera: {Math.round(camera.viewport.left)},{Math.round(camera.viewport.top)}{" "}
      {Math.round(camera.viewport.width)}x{Math.round(camera.viewport.height)}
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
// Demo 1: Basic focus/unfocus
// 3 columns: Nav (narrow), Article (wide), Sidebar (narrow)
// ---------------------------------------------------------------------------

function BasicFocusDemo({ tuning }: { tuning: SceneTuning }) {
  const [navFocused, setNavFocused] = useState(true);
  const [articleFocused, setArticleFocused] = useState(true);
  const [sidebarFocused, setSidebarFocused] = useState(true);

  return (
    <DemoSection
      title="Basic focus/unfocus"
      description="Three columns: Nav (narrow), Article (wide), Sidebar (narrow). Toggle each column's focus. Camera centers the focused region."
      controls={
        <>
          <Button size="sm" ghost={!navFocused} onClick={() => setNavFocused((v) => !v)}>
            Nav: {navFocused ? "focused" : "unfocused"}
          </Button>
          <Button size="sm" ghost={!articleFocused} onClick={() => setArticleFocused((v) => !v)}>
            Article: {articleFocused ? "focused" : "unfocused"}
          </Button>
          <Button size="sm" ghost={!sidebarFocused} onClick={() => setSidebarFocused((v) => !v)}>
            Sidebar: {sidebarFocused ? "focused" : "unfocused"}
          </Button>
        </>
      }
    >
      <Scene duration={300} {...tuning}>
        <SceneColumn name="nav">
          <SceneObject
            name="nav-panel"
            focused={navFocused}
            style={{ width: 160, height: "100%" }}
            onActivate={() => setNavFocused(true)}
          >
            <Panel
              title="Nav"
              subtitle="160px"
              color="bg-[lch(30_10_200)]"
              focused={navFocused}
            />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="article">
          <SceneObject
            name="article-panel"
            focused={articleFocused}
            style={{ width: 480, height: "100%" }}
            onActivate={() => setArticleFocused(true)}
          >
            <Panel
              title="Article"
              subtitle="480px"
              color="bg-[lch(30_10_280)]"
              focused={articleFocused}
            />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="sidebar">
          <SceneObject
            name="sidebar-panel"
            focused={sidebarFocused}
            style={{ width: 160, height: "100%" }}
            onActivate={() => setSidebarFocused(true)}
          >
            <Panel
              title="Sidebar"
              subtitle="160px"
              color="bg-[lch(30_10_340)]"
              focused={sidebarFocused}
            />
          </SceneObject>
        </SceneColumn>
        <CameraDebug />
      </Scene>
    </DemoSection>
  );
}

// ---------------------------------------------------------------------------
// Demo 2: Column sizing with cqw
// 2 columns using container query units relative to Camera viewport
// ---------------------------------------------------------------------------

function CqwSizingDemo({ tuning }: { tuning: SceneTuning }) {
  const [leftFocused, setLeftFocused] = useState(true);
  const [rightFocused, setRightFocused] = useState(true);

  return (
    <DemoSection
      title="Column sizing with cqw"
      description="Columns sized with container query units — 20cqw Nav and 80cqw Article, relative to the Camera viewport width."
      controls={
        <>
          <Button size="sm" ghost={!leftFocused} onClick={() => setLeftFocused((v) => !v)}>
            Nav (20cqw): {leftFocused ? "focused" : "unfocused"}
          </Button>
          <Button size="sm" ghost={!rightFocused} onClick={() => setRightFocused((v) => !v)}>
            Article (80cqw): {rightFocused ? "focused" : "unfocused"}
          </Button>
        </>
      }
    >
      <Scene duration={300} {...tuning}>
        <SceneColumn name="nav-cqw">
          <SceneObject
            name="nav-cqw-panel"
            focused={leftFocused}
            style={{ width: "20cqw", height: "100%" } as React.CSSProperties}
            onActivate={() => setLeftFocused(true)}
          >
            <Panel
              title="Nav"
              subtitle="20cqw"
              color="bg-[lch(30_10_200)]"
              focused={leftFocused}
            />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="article-cqw">
          <SceneObject
            name="article-cqw-panel"
            focused={rightFocused}
            style={{ width: "80cqw", height: "100%" } as React.CSSProperties}
            onActivate={() => setRightFocused(true)}
          >
            <Panel
              title="Article"
              subtitle="80cqw"
              color="bg-[lch(30_10_280)]"
              focused={rightFocused}
            />
          </SceneObject>
        </SceneColumn>
        <CameraDebug />
      </Scene>
    </DemoSection>
  );
}

// ---------------------------------------------------------------------------
// Demo 3: Vertical swap
// 1 column with 2 objects — selecting swaps which is focused
// ---------------------------------------------------------------------------

type ArticleTarget = "article-1" | "article-2";

function VerticalSwapDemo({ tuning }: { tuning: SceneTuning }) {
  const [active, setActive] = useState<ArticleTarget>("article-1");

  return (
    <DemoSection
      title="Vertical swap"
      description="One column with two objects. Selecting an article slides the column to show it. Only the focused object is visible."
      controls={
        <>
          {(["article-1", "article-2"] as const).map((t) => (
            <Button key={t} size="sm" ghost={active !== t} onClick={() => setActive(t)}>
              {t === "article-1" ? "Article 1" : "Article 2"}
            </Button>
          ))}
        </>
      }
    >
      <Scene duration={300} {...tuning}>
        <SceneColumn name="content">
          <SceneObject
            name="article-1"
            focused={active === "article-1"}
            style={{ width: 480 }}
            onActivate={() => setActive("article-1")}
          >
            <Panel
              title="Article 1"
              subtitle="Click to focus"
              color="bg-[lch(30_10_340)]"
              focused={active === "article-1"}
            />
          </SceneObject>
          <SceneObject
            name="article-2"
            focused={active === "article-2"}
            style={{ width: 480 }}
            onActivate={() => setActive("article-2")}
          >
            <Panel
              title="Article 2"
              subtitle="Click to focus"
              color="bg-[lch(30_15_10)]"
              focused={active === "article-2"} />
          </SceneObject>
        </SceneColumn>
        <CameraDebug />
      </Scene>
    </DemoSection>
  );
}

// ---------------------------------------------------------------------------
// Demo 4: Depth deck stacking
// 4 columns: Left (focused), Middle A (unfocused), Middle B (unfocused), Right (focused)
// In-between columns stack as depth deck with scale, opacity, greyscale
// ---------------------------------------------------------------------------

function DepthDeckDemo({ tuning }: { tuning: SceneTuning }) {
  const [leftFocused, setLeftFocused] = useState(true);
  const [middleAFocused, setMiddleAFocused] = useState(false);
  const [middleBFocused, setMiddleBFocused] = useState(false);
  const [rightFocused, setRightFocused] = useState(true);

  return (
    <DemoSection
      title="Depth deck stacking"
      description="In-between unfocused columns stack as a depth deck — scale, opacity, and greyscale decrease with depth. They peek leftward from behind the rightmost focused column."
      controls={
        <>
          <Button size="sm" ghost={!leftFocused} onClick={() => setLeftFocused((v) => !v)}>
            Left: {leftFocused ? "focused" : "unfocused"}
          </Button>
          <Button size="sm" ghost={!middleAFocused} onClick={() => setMiddleAFocused((v) => !v)}>
            Middle A: {middleAFocused ? "focused" : "depth deck"}
          </Button>
          <Button size="sm" ghost={!middleBFocused} onClick={() => setMiddleBFocused((v) => !v)}>
            Middle B: {middleBFocused ? "focused" : "depth deck"}
          </Button>
          <Button size="sm" ghost={!rightFocused} onClick={() => setRightFocused((v) => !v)}>
            Right: {rightFocused ? "focused" : "unfocused"}
          </Button>
        </>
      }
    >
      <Scene duration={300} {...tuning}>
        <SceneColumn name="left">
          <SceneObject
            name="left-obj"
            focused={leftFocused}
            style={{ width: 240, height: "100%" }}
            onActivate={() => setLeftFocused(true)}
          >
            <Panel
              title="Left"
              subtitle="always focused"
              color="bg-[lch(30_10_280)]"
              focused={leftFocused}
            />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="middle-a">
          <SceneObject
            name="middle-a-obj"
            focused={middleAFocused}
            style={{ width: 240, height: "100%" }}
            onActivate={() => setMiddleAFocused(true)}
          >
            <Panel
              title="Middle A"
              subtitle="depth deck (depth 2)"
              color="bg-[lch(30_10_200)]"
              focused={middleAFocused}
            />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="middle-b">
          <SceneObject
            name="middle-b-obj"
            focused={middleBFocused}
            style={{ width: 240, height: "100%" }}
            onActivate={() => setMiddleBFocused(true)}
          >
            <Panel
              title="Middle B"
              subtitle="depth deck (depth 1)"
              color="bg-[lch(30_10_120)]"
              focused={middleBFocused}
            />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="right">
          <SceneObject
            name="right-obj"
            focused={rightFocused}
            style={{ width: 240, height: "100%" }}
            onActivate={() => setRightFocused(true)}
          >
            <Panel
              title="Right"
              subtitle="always focused"
              color="bg-[lch(30_10_340)]"
              focused={rightFocused}
            />
          </SceneObject>
        </SceneColumn>
        <CameraDebug />
      </Scene>
    </DemoSection>
  );
}

// ---------------------------------------------------------------------------
// Demo 5: Vertical scroll
// 1 column with tall content (much taller than viewport)
// ---------------------------------------------------------------------------

function VerticalScrollDemo({ tuning }: { tuning: SceneTuning }) {
  return (
    <DemoSection
      title="Vertical scroll"
      description="Content taller than the viewport. Scroll with trackpad/mouse wheel or keyboard (Arrow, Page, Home, End). Custom scrollbar appears at right edge."
    >
      <Scene duration={300} {...tuning}>
        <SceneColumn name="col">
          <SceneObject name="tall-content" focused style={{ width: 480 }}>
            <div className="bg-[lch(25_8_280)] rounded-sm p-6 flex flex-col gap-4">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="bg-white/5 rounded p-4">
                  <h4 className="text-white/80 text-sm font-light">Section {i + 1}</h4>
                  <p className="text-white/40 text-xs mt-1">
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
                    incididunt ut labore et dolore magna aliqua.
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
// Demo 6: Horizontal scroll
// 3 focused columns with explicit wide content that overflows the viewport
// ---------------------------------------------------------------------------

function HorizontalScrollDemo({ tuning }: { tuning: SceneTuning }) {
  return (
    <DemoSection
      title="Horizontal scroll"
      description="Three focused columns with wide content that overflows the viewport. Scroll horizontally — the Camera pans across the scene. Native scrollbar appears at bottom."
    >
      <Scene duration={300} {...tuning}>
        {(["col-a", "col-b", "col-c"] as const).map((name, i) => {
          const colors = [
            "bg-[lch(30_10_280)]",
            "bg-[lch(30_10_200)]",
            "bg-[lch(30_10_120)]",
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
// Demo 7: Multi-focus stacking
// 1 column with 3 objects, 2 can be focused simultaneously
// Focused objects stack vertically; unfocused between them get depth treatment
// ---------------------------------------------------------------------------

function MultiFocusDemo({ tuning }: { tuning: SceneTuning }) {
  const [topFocused, setTopFocused] = useState(true);
  const [middleFocused, setMiddleFocused] = useState(false);
  const [bottomFocused, setBottomFocused] = useState(true);

  return (
    <DemoSection
      title="Multi-focus stacking"
      description="One column with three objects. When two are focused they stack vertically. An unfocused object sandwiched between two focused ones gets within-column depth treatment — it peeks above the lower focused sibling."
      controls={
        <>
          <Button size="sm" ghost={!topFocused} onClick={() => setTopFocused((v) => !v)}>
            Top: {topFocused ? "focused" : "unfocused"}
          </Button>
          <Button size="sm" ghost={!middleFocused} onClick={() => setMiddleFocused((v) => !v)}>
            Middle: {middleFocused ? "focused" : "sandwiched"}
          </Button>
          <Button size="sm" ghost={!bottomFocused} onClick={() => setBottomFocused((v) => !v)}>
            Bottom: {bottomFocused ? "focused" : "unfocused"}
          </Button>
        </>
      }
    >
      <Scene duration={300} {...tuning}>
        <SceneColumn name="stack-col" objectGap={8}>
          <SceneObject
            name="stack-top"
            focused={topFocused}
            style={{ width: 480 }}
            onActivate={() => setTopFocused(true)}
          >
            <Panel
              title="Top"
              subtitle="Object 1"
              color="bg-[lch(30_10_280)]"
              focused={topFocused}
            />
          </SceneObject>
          <SceneObject
            name="stack-middle"
            focused={middleFocused}
            style={{ width: 480 }}
            onActivate={() => setMiddleFocused(true)}
          >
            <Panel
              title="Middle"
              subtitle="Sandwiched when unfocused"
              color="bg-[lch(30_10_200)]"
              focused={middleFocused}
            />
          </SceneObject>
          <SceneObject
            name="stack-bottom"
            focused={bottomFocused}
            style={{ width: 480 }}
            onActivate={() => setBottomFocused(true)}
          >
            <Panel
              title="Bottom"
              subtitle="Object 3"
              color="bg-[lch(30_10_120)]"
              focused={bottomFocused}
            />
          </SceneObject>
        </SceneColumn>
        <CameraDebug />
      </Scene>
    </DemoSection>
  );
}

// ---------------------------------------------------------------------------
// Demo 8: Debug mode
// Toggle debug overlays on a 3-column layout
// ---------------------------------------------------------------------------

function DebugModeDemo({ tuning }: { tuning: SceneTuning }) {
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [navFocused, setNavFocused] = useState(true);
  const [activeArticle, setActiveArticle] = useState<ArticleTarget>("article-1");
  const [sidebarFocused, setSidebarFocused] = useState(true);

  return (
    <DemoSection
      title="Debug mode"
      description="Debug overlays: cyan = viewport, magenta = stage, green = focused object, gray = unfocused object. Overlay panel shows object state, scroll info, and Camera bounds."
      controls={
        <>
          <Button size="sm" ghost={!debugEnabled} onClick={() => setDebugEnabled((v) => !v)}>
            Debug: {debugEnabled ? "on" : "off"}
          </Button>
          <Button size="sm" ghost={!navFocused} onClick={() => setNavFocused((v) => !v)}>
            Nav: {navFocused ? "focused" : "unfocused"}
          </Button>
          {(["article-1", "article-2"] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              ghost={activeArticle !== t}
              onClick={() => setActiveArticle(t)}
            >
              {t === "article-1" ? "Article 1" : "Article 2"}
            </Button>
          ))}
          <Button size="sm" ghost={!sidebarFocused} onClick={() => setSidebarFocused((v) => !v)}>
            Sidebar: {sidebarFocused ? "focused" : "unfocused"}
          </Button>
        </>
      }
    >
      <Scene duration={300} debug={debugEnabled} {...tuning}>
        <SceneColumn name="nav">
          <SceneObject
            name="nav-panel"
            focused={navFocused}
            style={{ width: 160, height: "100%" }}
            onActivate={() => setNavFocused(true)}
          >
            <Panel
              title="Nav"
              subtitle="160px"
              color="bg-[lch(30_10_200)]"
              focused={navFocused}
            />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="article">
          <SceneObject
            name="article-1"
            focused={activeArticle === "article-1"}
            style={{ width: 420 }}
            onActivate={() => setActiveArticle("article-1")}
          >
            <Panel
              title="Article 1"
              color="bg-[lch(30_10_340)]"
              focused={activeArticle === "article-1"}
            />
          </SceneObject>
          <SceneObject
            name="article-2"
            focused={activeArticle === "article-2"}
            style={{ width: 420 }}
            onActivate={() => setActiveArticle("article-2")}
          >
            <Panel
              title="Article 2"
              color="bg-[lch(30_15_10)]"
              focused={activeArticle === "article-2"}
            />
          </SceneObject>
        </SceneColumn>
        <SceneColumn name="sidebar">
          <SceneObject
            name="sidebar-panel"
            focused={sidebarFocused}
            style={{ width: 160, height: "100%" }}
            onActivate={() => setSidebarFocused(true)}
          >
            <Panel
              title="Sidebar"
              subtitle="160px"
              color="bg-[lch(30_10_280)]"
              focused={sidebarFocused}
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
// Tuning panel — sliders for Scene physics and layout props
// ---------------------------------------------------------------------------

export interface SceneTuning {
  stiffness: number;
  damping: number;
  perspective: number;
  columnGap: number;
  padding: number;
}

const defaultTuning: SceneTuning = {
  stiffness: 300,
  damping: 30,
  perspective: 800,
  columnGap: 8,
  padding: 0,
};

function TuningPanel({
  tuning,
  onChange,
}: {
  tuning: SceneTuning;
  onChange: (next: SceneTuning) => void;
}) {
  const sliders: Array<{
    key: keyof SceneTuning;
    label: string;
    min: number;
    max: number;
    step: number;
  }> = [
    { key: "stiffness", label: "Stiffness", min: 10, max: 500, step: 10 },
    { key: "damping", label: "Damping", min: 1, max: 50, step: 1 },
    { key: "perspective", label: "Perspective", min: 200, max: 2000, step: 50 },
    { key: "columnGap", label: "Column Gap", min: 0, max: 64, step: 4 },
    { key: "padding", label: "Padding", min: 0, max: 48, step: 4 },
  ];

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 1000,
        background: "rgba(0,0,0,0.75)",
        color: "#e2e8f0",
        fontFamily: "monospace",
        fontSize: 11,
        padding: "10px 12px",
        borderRadius: 6,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 200,
      }}
    >
      <div style={{ fontWeight: "bold", marginBottom: 2, fontSize: 12 }}>Scene Tuning</div>
      {sliders.map(({ key, label, min, max, step }) => (
        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 72, flexShrink: 0, color: "#94a3b8" }}>{label}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={tuning[key]}
            onChange={(e) => onChange({ ...tuning, [key]: Number(e.target.value) })}
            style={{ flex: 1 }}
          />
          <span style={{ width: 36, textAlign: "right" }}>{tuning[key]}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ScenePage() {
  const [tuning, setTuning] = useState<SceneTuning>(defaultTuning);

  return (
    <div className="flex flex-col p-8 gap-10 max-w-6xl mx-auto">
      <header>
        <h1 className="text-3xl font-light">Scene</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Spatial navigation system — focused columns share viewport space, unfocused columns
          freeze and slide offscreen or stack as a depth deck.
        </p>
      </header>

      <BasicFocusDemo tuning={tuning} />
      <CqwSizingDemo tuning={tuning} />
      <VerticalSwapDemo tuning={tuning} />
      <DepthDeckDemo tuning={tuning} />
      <VerticalScrollDemo tuning={tuning} />
      <HorizontalScrollDemo tuning={tuning} />
      <MultiFocusDemo tuning={tuning} />
      <DebugModeDemo tuning={tuning} />

      <TuningPanel tuning={tuning} onChange={setTuning} />
    </div>
  );
}
