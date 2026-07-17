import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Scene,
  SceneColumn,
  SceneObject,
  useCamera,
  DEFAULT_STIFFNESS,
  DEFAULT_DAMPING,
  DEFAULT_TOUCH_POWER,
  DEFAULT_TOUCH_TIME_CONSTANT,
  DEFAULT_COLUMN_GAP,
  DEFAULT_PERSPECTIVE,
} from "../../src";
import { Button } from "../../src";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Renders the camera readout via a portal into an externally-owned overlay
 * div (see DemoSection's debugTarget) instead of as a direct child of
 * <Scene>. Scene's wrapChild dev-warns on (and lets scrollWidth grow from)
 * any direct child that isn't a SceneColumn/SceneObject — a plain <p> child
 * used to join the stage's flex row and widen its scroll extent. Nesting
 * this call site inside a SceneObject's own children keeps it a valid place
 * to call useCamera() (still inside Scene's CameraContext) while the portal
 * itself renders zero DOM at that position, so it never joins Scene's
 * layout or triggers the stray-child warning.
 */
function CameraDebugPortal({ target }: { target: HTMLDivElement | null }) {
  const camera = useCamera();
  if (!target) return null;
  return createPortal(
    <p className="text-xs text-text-muted font-mono">
      Camera: {Math.round(camera.viewport.left)},{Math.round(camera.viewport.top)}{" "}
      {Math.round(camera.viewport.width)}x{Math.round(camera.viewport.height)}
      {camera.transitioning && " (moving)"}
    </p>,
    target,
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
      {(debugTarget) => (
        <Scene {...tuning}>
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
              <CameraDebugPortal target={debugTarget} />
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
        </Scene>
      )}
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
      {(debugTarget) => (
        <Scene {...tuning}>
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
              <CameraDebugPortal target={debugTarget} />
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
        </Scene>
      )}
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
      {(debugTarget) => (
        <Scene {...tuning}>
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
              <CameraDebugPortal target={debugTarget} />
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
        </Scene>
      )}
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
      {(debugTarget) => (
        <Scene {...tuning}>
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
              <CameraDebugPortal target={debugTarget} />
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
        </Scene>
      )}
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
      description="Content taller than the viewport. Scroll with trackpad/mouse wheel or keyboard (Arrow, Page, Home, End). Custom scrollbar appears at right edge. F17 investigation: a red sticky footer 'composer' pinned at the bottom, inside a minHeight:100cqh flex wrapper — Michael's on-device report (feed 1106) is that this sometimes jumps to mid-screen during scroll on iOS PWA, then back on settle."
    >
      {(debugTarget) => (
        <Scene {...tuning}>
          <SceneColumn name="col">
            <SceneObject name="tall-content" focused style={{ width: 480 }}>
              {/* F17: the CR-1-shaped fixture — a flex column with
                  minHeight:100cqh wrapping scrollable content plus a
                  position:sticky;bottom:0 composer sibling, matching the
                  reported chat structure exactly (Peri's scene-lab 77
                  handoff). data-testid="composer" is the tracked element
                  the overlay below samples every frame. */}
              <div
                data-testid="sticky-footer-stack"
                style={{ display: "flex", flexDirection: "column", minHeight: "100cqh" }}
              >
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
                <div
                  data-testid="composer"
                  style={{
                    position: "sticky",
                    bottom: 0,
                    height: 56,
                    background: "red",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  composer (should stay pinned here)
                </div>
              </div>
              <CameraDebugPortal target={debugTarget} />
            </SceneObject>
          </SceneColumn>
        </Scene>
      )}
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
      {(debugTarget) => (
        <Scene {...tuning}>
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
                  {i === 0 && <CameraDebugPortal target={debugTarget} />}
                </SceneObject>
              </SceneColumn>
            );
          })}
        </Scene>
      )}
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
      {(debugTarget) => (
        <Scene {...tuning}>
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
              <CameraDebugPortal target={debugTarget} />
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
        </Scene>
      )}
    </DemoSection>
  );
}

// ---------------------------------------------------------------------------
// Demo 8: Standard blog
// A nav/article/sidebar layout — was "Debug mode" (its own local debug
// toggle), now a plain content demo. The page-wide Debug checkbox in
// TuningPanel (F6 item 2) covers inspecting it, along with every other demo.
// ---------------------------------------------------------------------------

function StandardBlogDemo({ tuning }: { tuning: SceneTuning }) {
  const [navFocused, setNavFocused] = useState(true);
  const [activeArticle, setActiveArticle] = useState<ArticleTarget>("article-1");
  const [sidebarFocused, setSidebarFocused] = useState(true);

  return (
    <DemoSection
      title="Standard blog"
      description="A typical blog layout: nav, article (with a second article to swap to), and sidebar — all independently focusable columns."
      controls={
        <>
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
      {(debugTarget) => (
        <Scene {...tuning}>
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
              <CameraDebugPortal target={debugTarget} />
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
        </Scene>
      )}
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
  /**
   * Render prop rather than a plain node: the debugTarget div below is owned
   * by DemoSection (one per demo box) and handed to whichever demo wants to
   * nest a <CameraDebugPortal target={debugTarget} /> inside its <Scene>.
   */
  children: (debugTarget: HTMLDivElement | null) => React.ReactNode;
}) {
  const [debugTarget, setDebugTarget] = useState<HTMLDivElement | null>(null);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-light">{title}</h2>
        <p className="text-text-secondary text-sm mt-0.5">{description}</p>
      </div>
      {controls && <div className="flex gap-2 flex-wrap items-center">{controls}</div>}
      <div className="h-64 border border-rule-subtle rounded-sm overflow-hidden relative">
        {children(debugTarget)}
        {/* Camera-debug portal target: absolutely positioned within this
            box so the readout it receives never joins Scene's stage flex
            row or widens its scrollWidth (see CameraDebugPortal above). */}
        <div
          ref={setDebugTarget}
          className="absolute bottom-1 right-1 z-10 pointer-events-none"
        />
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
  touchPower: number;
  touchTimeConstant: number;
  perspective: number;
  columnGap: number;
  padding: number;
  /**
   * Page-wide debug overlay toggle (F6 item 2) — spread onto every demo's
   * `<Scene {...tuning}>` alongside the physics/layout knobs above, so
   * flipping it once inspects every demo on the page simultaneously.
   * Bundled into `tuning` (rather than a separate piece of page state)
   * specifically so it flows through the SAME `{...tuning}` spread every
   * demo already applies to its own <Scene> — no per-demo prop threading
   * needed.
   */
  debug: boolean;
}

const defaultTuning: SceneTuning = {
  stiffness: DEFAULT_STIFFNESS,
  damping: DEFAULT_DAMPING,
  touchPower: DEFAULT_TOUCH_POWER,
  touchTimeConstant: DEFAULT_TOUCH_TIME_CONSTANT,
  perspective: DEFAULT_PERSPECTIVE,
  columnGap: DEFAULT_COLUMN_GAP,
  padding: 0,
  debug: false,
};

function TuningPanel({
  tuning,
  onChange,
}: {
  tuning: SceneTuning;
  onChange: (next: SceneTuning) => void;
}) {
  // Every 8 demos read `tuning` as a prop, so any commit re-renders all of
  // them. A naive onChange->setState per slider `input` event fires on
  // every drag tick (measured: 28 ticks -> 30 re-renders + 770
  // getBoundingClientRect calls in an untouched off-screen demo). Batch
  // same-frame ticks into a single commit via rAF instead — the slider's
  // own thumb/value tracks the pointer natively between commits (React
  // isn't re-rendering, so nothing forces it back), so this stays fully
  // live without the apply-on-blur-only lag of committing on release.
  const pendingRef = useRef(tuning);
  pendingRef.current = tuning;
  const rafIdRef = useRef<number | null>(null);

  const scheduleChange = useCallback(
    (next: SceneTuning) => {
      pendingRef.current = next;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        onChange(pendingRef.current);
      });
    },
    [onChange],
  );

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  const sliders: Array<{
    key: Exclude<keyof SceneTuning, "debug">;
    label: string;
    min: number;
    max: number;
    step: number;
  }> = [
    { key: "stiffness", label: "Stiffness", min: 10, max: 500, step: 10 },
    { key: "damping", label: "Damping", min: 1, max: 50, step: 1 },
    { key: "touchPower", label: "Touch Power", min: 0.1, max: 1, step: 0.05 },
    { key: "touchTimeConstant", label: "Touch Time Const", min: 50, max: 1000, step: 25 },
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
            defaultValue={tuning[key]}
            onChange={(e) =>
              scheduleChange({ ...pendingRef.current, [key]: Number(e.target.value) })
            }
            style={{ flex: 1 }}
          />
          <span style={{ width: 36, textAlign: "right" }}>{tuning[key]}</span>
        </div>
      ))}
      {/* F6 item 2: page-wide debug toggle, spread onto every demo below via
          `{...tuning}` — a checkbox rather than a slider (boolean, not a
          numeric range), still routed through scheduleChange for the same
          rAF-coalesced commit as every other field, and uncontrolled
          (defaultChecked, not checked) matching the sliders' defaultValue
          pattern above — this panel doesn't re-render per keystroke/tick,
          so a controlled input would desync from the checkbox's own live
          DOM state between commits. */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <span style={{ width: 72, flexShrink: 0, color: "#94a3b8" }}>Debug</span>
        <input
          type="checkbox"
          defaultChecked={tuning.debug}
          onChange={(e) =>
            scheduleChange({ ...pendingRef.current, debug: e.target.checked })
          }
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// TEMPORARY touch-feel probe overlay (F13 investigation — remove after).
// Tracks every touch gesture anywhere on the page: finger travel (clientY),
// the nearest scene column's CONTENT travel (content-wrapper rect.top), and
// the live ratio between them. 1.00 = content tracks the finger exactly;
// >1 = content slides PAST the finger (Michael's report). Also reports the
// post-release coast distance. Rendered as a fixed high-contrast readout.
function TouchDebugOverlay() {
  const [line, setLine] = useState("touch-probe armed — drag any scrollable column");
  const [taLine, setTaLine] = useState("");
  // F17: sticky-composer tracker. The Vertical scroll demo's composer
  // (data-testid="composer") is position:sticky;bottom:0 and should render
  // at a COMPLETELY STATIC viewport-relative rect.top throughout ANY
  // scroll, drag, or coast — unlike content.top (expected to move), any
  // frame-to-frame CHANGE in the composer's own rect.top is itself already
  // the bug signal. Chromium harness probe (vitest-browser-react, F17 task
  // 1) found ZERO deviation across a real fling, a wheel spring, and a
  // grab-mid-coast interrupt — this overlay exists to find out whether
  // WebKit differs, per Michael's on-device report (main feed 1106, via
  // Peri's scene-lab 77 handoff: "sometimes jumps to the MIDDLE of the
  // screen, then back to the bottom on settle").
  const [composerLine, setComposerLine] = useState("composer-probe armed");
  useEffect(() => {
    // Parse-support check: what does THIS engine compute for the touch-action
    // values Scene relies on? Safari lacks the `pinch-zoom` keyword — if the
    // compound value is dropped as invalid, computed reads "auto" and native
    // panning runs alongside the JS pan (the compounding-scroll bug).
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.style.touchAction = "pan-x pinch-zoom";
    const compound = getComputedStyle(el).touchAction;
    el.style.touchAction = "";
    el.style.touchAction = "pan-x";
    const plain = getComputedStyle(el).touchAction;
    el.remove();
    const live = document.querySelector("[data-column-content]");
    const liveTa = live ? getComputedStyle(live).touchAction : "?";
    setTaLine(`touch-action: set "pan-x pinch-zoom" → computed "${compound}" · set "pan-x" → "${plain}" · live column → "${liveTa}"`);
  }, []);
  useEffect(() => {
    let startY: number | null = null;
    let startContentTop: number | null = null;
    let content: Element | null = null;
    let lastFingerDelta = 0;
    let lastContentDelta = 0;
    let releaseContentTop: number | null = null;
    let raf = 0;

    const findContent = (target: Element | null): Element | null => {
      const col = target?.closest("[data-column]");
      return col?.querySelector("[data-column-content]") ?? null;
    };

    let colInfo = "";
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      content = findContent(e.target as Element);
      if (!content) return;
      const col = content.closest("[data-column]");
      colInfo = `col=${col?.getAttribute("data-column")} maxScroll=${col?.getAttribute("data-max-scroll") ?? "none"} ta=${getComputedStyle(content).touchAction}`;
      startY = e.clientY;
      startContentTop = content.getBoundingClientRect().top;
      releaseContentTop = null;
    };
    // Per-frame sampler + TELEPORT DETECTOR: samples ground truth every rAF
    // while a gesture is down; a content jump > 150px between two consecutive
    // frames freezes a before/after snapshot of every candidate cause
    // (finger clientY, offset/max-scroll attrs, visual-viewport height) so
    // the mechanism names itself in one gesture.
    //
    // F14 additions (layer localization): three MORE positions sampled in
    // the SAME frame, each one level higher in the DOM than the last, so a
    // teleport's own layer names itself by WHICH of these jumps together
    // with contentTop and which stay put — (1) wrapperStyleTop is the raw
    // CSS `top` value Motion writes directly onto the content wrapper
    // (composedTop = -(topOffsetMV + scrollY) — if THIS jumps while
    // data-scroll-offset (scrollY) barely moves, the culprit is
    // topOffsetMV/topOffset, not the scroll pipeline); (2) colRectTop is
    // the OUTER [data-column] element's page position (should be rock
    // stable — nothing in this demo moves a column); (3) stageRectTop is
    // the [data-stage] element's page position (camera pan only ever
    // writes `left`, never `top` — stageTransform is captured too in case
    // something unexpected touches it); (4) sceneRectTop is the
    // [data-testid="scene"] VIEWPORT's own page position — if the WHOLE
    // viewport moved on the page (e.g. an earlier demo section on the SAME
    // page changed height, pushing this one down), contentTop would jump
    // by the exact same amount as sceneRectTop while NOTHING inside Scene's
    // own coordinate system actually moved; the existing pageMark (h1)
    // check can't catch this since the h1 sits ABOVE every demo section,
    // not immediately above this one.
    let lastClientY = 0;
    let sampler = 0;
    let prev: {
      top: number;
      y: number;
      off: string | null;
      max: string | null;
      vv: number;
      pageY: number;
      markTop: number;
      wrapperStyleTop: number;
      colRectTop: number;
      stageRectTop: number;
      stageTransform: string;
      sceneRectTop: number;
    } | null = null;
    let frozen = false;
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // F17: composer tracker — runs alongside `sample`/`watch` below (the
    // SAME two rAF loops, drag + coast), independent of the content
    // teleport detector above. A sticky composer's rect.top should be
    // COMPLETELY STATIC frame to frame throughout — any change at all is
    // the bug signal, so this compares CONSECUTIVE frames (not a fixed
    // threshold against a rest value the way the content detector does),
    // and freezes on the very first deviation.
    let composerPrevTop: number | null = null;
    let composerFrozen = false;
    const COMPOSER_EPSILON_PX = 1;
    const checkComposer = () => {
      if (composerFrozen) return;
      const composer = document.querySelector("[data-testid='composer']");
      if (!composer) return;
      const col = composer.closest("[data-column]");
      const off = parseFloat(col?.getAttribute("data-scroll-offset") ?? "0");
      const max = parseFloat(col?.getAttribute("data-max-scroll") ?? "0");
      // A rubber-band OVERSCROLL (off > max, e.g. mid-fling boundary
      // catch) legitimately moves the composer by exactly the overscroll
      // amount — probe-confirmed (Chromium, off-max Δ matched the
      // composer's own Δ to within 0.02px): the composer is the flex
      // column's last child, and sticky can never hold it further down
      // than its OWN containing block's true edge, which the overscroll
      // has pushed past the viewport's bottom. That's correct, expected
      // physics, not the bug under investigation — skip the check
      // entirely while out of the normal [0, max] range so it doesn't
      // pollute a real device capture with expected boundary noise.
      const inOverscroll = max > 0 && (off > max || off < 0);
      const curTop = composer.getBoundingClientRect().top;
      if (!inOverscroll && composerPrevTop !== null && Math.abs(curTop - composerPrevTop) > COMPOSER_EPSILON_PX) {
        composerFrozen = true;
        const contentWrapper = col?.querySelector("[data-column-content]") as HTMLElement | null;
        setComposerLine(
          `🚨 COMPOSER MOVED (should be pinned):\n` +
            `composerTop ${composerPrevTop.toFixed(2)}→${curTop.toFixed(2)} (Δ${(curTop - composerPrevTop).toFixed(2)})\n` +
            `off ${col?.getAttribute("data-scroll-offset") ?? "?"} · max ${col?.getAttribute("data-max-scroll") ?? "?"} · ` +
            `wrapperStyleTop ${parseFloat(contentWrapper?.style.top || "0").toFixed(1)}`,
        );
        return;
      }
      // Baseline tracking continues through overscroll unconditionally —
      // only the COMPARISON above is skipped there — so the very next
      // in-bounds frame after an overscroll compares against a fresh
      // baseline instead of a stale one from before entering it (which
      // would otherwise manufacture a spurious deviation on exit).
      composerPrevTop = curTop;
      if (!composerFrozen) {
        setComposerLine(
          `composer tracking: top=${curTop.toFixed(2)}${inOverscroll ? " (in overscroll, not checked)" : ""}`,
        );
      }
    };
    const sample = () => {
      if (!content || startY === null) return;
      const col = content.closest("[data-column]");
      const stage = document.querySelector("[data-stage]");
      const scene = document.querySelector("[data-testid='scene']");
      const cur = {
        top: content.getBoundingClientRect().top,
        y: lastClientY,
        off: col?.getAttribute("data-scroll-offset") ?? null,
        max: col?.getAttribute("data-max-scroll") ?? null,
        vv: window.visualViewport?.height ?? 0,
        pageY: window.scrollY,
        // A stable page landmark OUTSIDE the Scene: the page's own <h1>.
        // If ITS viewport position jumps in the same frame, the PAGE
        // scrolled (Safari's own scroll anchoring adjusting document
        // scroll) — if it holds still while content jumps, the movement is
        // inside the Scene pipeline.
        markTop: document.querySelector("h1")?.getBoundingClientRect().top ?? 0,
        wrapperStyleTop: parseFloat((content as HTMLElement).style.top || "0"),
        colRectTop: col?.getBoundingClientRect().top ?? 0,
        stageRectTop: stage?.getBoundingClientRect().top ?? 0,
        stageTransform: stage ? getComputedStyle(stage).transform : "?",
        sceneRectTop: scene?.getBoundingClientRect().top ?? 0,
      };
      if (prev && !frozen && Math.abs(cur.top - prev.top) > 150) {
        frozen = true;
        setLine(
          `🚨 TELEPORT in ONE frame:\n` +
            `contentTop ${prev.top.toFixed(0)}→${cur.top.toFixed(0)} (Δ${(cur.top - prev.top).toFixed(0)}) · finger Δ${(cur.y - prev.y).toFixed(0)} · offset ${prev.off}→${cur.off} · maxScroll ${prev.max}→${cur.max}\n` +
            `wrapperStyleTop ${prev.wrapperStyleTop.toFixed(1)}→${cur.wrapperStyleTop.toFixed(1)} (Δ${(cur.wrapperStyleTop - prev.wrapperStyleTop).toFixed(1)}) · colRectTop ${prev.colRectTop.toFixed(0)}→${cur.colRectTop.toFixed(0)} (Δ${(cur.colRectTop - prev.colRectTop).toFixed(0)})\n` +
            `stageRectTop ${prev.stageRectTop.toFixed(0)}→${cur.stageRectTop.toFixed(0)} (Δ${(cur.stageRectTop - prev.stageRectTop).toFixed(0)}) · stageTransform ${prev.stageTransform}→${cur.stageTransform}\n` +
            `sceneRectTop ${prev.sceneRectTop.toFixed(0)}→${cur.sceneRectTop.toFixed(0)} (Δ${(cur.sceneRectTop - prev.sceneRectTop).toFixed(0)})\n` +
            `PAGE scrollY ${prev.pageY.toFixed(0)}→${cur.pageY.toFixed(0)} (Δ${(cur.pageY - prev.pageY).toFixed(0)}) · pageMark ${prev.markTop.toFixed(0)}→${cur.markTop.toFixed(0)} · vvH ${prev.vv.toFixed(0)}→${cur.vv.toFixed(0)} · rm ${rm}`,
        );
      }
      prev = cur;
      if (!frozen && startContentTop !== null) {
        lastContentDelta = startContentTop - cur.top;
        const ratio = Math.abs(lastFingerDelta) > 4 ? (lastContentDelta / lastFingerDelta).toFixed(2) : "—";
        setLine(
          `drag: finger ${lastFingerDelta.toFixed(0)}px · content ${lastContentDelta.toFixed(0)}px · ratio ${ratio} · off ${cur.off} max ${cur.max} · vvH ${cur.vv.toFixed(0)} · rm ${rm} · ${colInfo}`,
        );
      }
      checkComposer();
      sampler = requestAnimationFrame(sample);
    };
    const onMove = (e: PointerEvent) => {
      if (startY === null || !content || startContentTop === null) return;
      lastClientY = e.clientY;
      lastFingerDelta = startY - e.clientY;
      if (!sampler) {
        lastClientY = e.clientY;
        prev = null;
        frozen = false;
        composerPrevTop = null;
        composerFrozen = false;
        sampler = requestAnimationFrame(sample);
      }
    };
    const onUp = () => {
      if (startY === null || !content) return;
      cancelAnimationFrame(sampler);
      sampler = 0;
      if (frozen) {
        startY = null;
        return; // keep the frozen teleport snapshot on screen
      }
      const c = content;
      releaseContentTop = c.getBoundingClientRect().top;
      const fingerD = lastFingerDelta;
      const contentD = lastContentDelta;
      startY = null;
      // watch the coast for 2s, then summarize the whole gesture
      const t0 = performance.now();
      const watch = () => {
        const coast = releaseContentTop! - c.getBoundingClientRect().top;
        const ratio = Math.abs(fingerD) > 4 ? (contentD / fingerD).toFixed(2) : "—";
        setLine(`RELEASED: finger ${fingerD.toFixed(0)}px → content ${contentD.toFixed(0)}px (ratio ${ratio}) · coast ${(-coast).toFixed(0)}px`);
        // F17: composer tracking continues through the coast — this is
        // exactly where Michael's report (a jump "then back... on settle")
        // most plausibly lives, since the Chromium harness probe found the
        // drag phase alone already clean.
        checkComposer();
        if (performance.now() - t0 < 2000) raf = requestAnimationFrame(watch);
      };
      raf = requestAnimationFrame(watch);
    };

    // CANDIDATE FIX, applied live for on-device verification: while a
    // single-finger gesture that started inside a column's content is
    // active, preventDefault every touchmove (non-passive). This makes JS
    // gesture ownership explicit instead of relying on the engine honoring
    // touch-action over Scene's transformed subtree. If the page-scroll
    // bleed stops and ratio reads ~1.00 with this active, the F13 fix
    // mechanism is confirmed on the real device.
    let ownGesture = false;
    const onDownOwn = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      ownGesture = !!findContent(e.target as Element);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (ownGesture && e.touches.length === 1 && e.cancelable) e.preventDefault();
    };
    const onGestureEnd = () => {
      ownGesture = false;
    };
    window.addEventListener("pointerdown", onDownOwn, { capture: true, passive: true });
    window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    window.addEventListener("touchend", onGestureEnd, { capture: true, passive: true });
    window.addEventListener("touchcancel", onGestureEnd, { capture: true, passive: true });

    window.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    window.addEventListener("pointermove", onMove, { capture: true, passive: true });
    window.addEventListener("pointerup", onUp, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", onDownOwn, { capture: true } as EventListenerOptions);
      window.removeEventListener("touchmove", onTouchMove, { capture: true } as EventListenerOptions);
      window.removeEventListener("touchend", onGestureEnd, { capture: true } as EventListenerOptions);
      window.removeEventListener("touchcancel", onGestureEnd, { capture: true } as EventListenerOptions);
      window.removeEventListener("pointerdown", onDown, { capture: true } as EventListenerOptions);
      window.removeEventListener("pointermove", onMove, { capture: true } as EventListenerOptions);
      window.removeEventListener("pointerup", onUp, { capture: true } as EventListenerOptions);
    };
  }, []);
  return createPortal(
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.85)",
        color: "#4ade80",
        font: "600 13px/1.6 ui-monospace, monospace",
        padding: "10px 12px",
        pointerEvents: "none",
        whiteSpace: "pre-wrap",
      }}
    >
      {line}
      {"\n"}
      {taLine}
      {"\n"}
      {composerLine}
    </div>,
    document.body,
  );
}

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
      <StandardBlogDemo tuning={tuning} />

      <TouchDebugOverlay />
      <TuningPanel tuning={tuning} onChange={setTuning} />
    </div>
  );
}
