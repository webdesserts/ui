import { useState, useEffect } from "react";
import { List, X } from "@phosphor-icons/react";
import { Button, IconButton, cn } from "../src";
import { ButtonPage } from "./pages/ButtonPage";
import { ButtonLinkPage } from "./pages/ButtonLinkPage";
import { IconButtonPage } from "./pages/IconButtonPage";
import { ButtonGroupPage } from "./pages/ButtonGroupPage";
import { MenuItemPage } from "./pages/MenuItemPage";
import { TextInputPage } from "./pages/TextInputPage";
import { GlassPage } from "./pages/GlassPage";
import { ColorsPage } from "./pages/ColorsPage";
import { ScenePage } from "./pages/ScenePage";

type ColorMode = "system" | "light" | "dark";

const pages = {
  button: { label: "Button", section: "Components", component: ButtonPage },
  buttonlink: { label: "ButtonLink", section: "Components", component: ButtonLinkPage },
  iconbutton: { label: "IconButton", section: "Components", component: IconButtonPage },
  buttongroup: { label: "ButtonGroup", section: "Components", component: ButtonGroupPage },
  menuitem: { label: "MenuItem", section: "Components", component: MenuItemPage },
  textinput: { label: "TextInput", section: "Components", component: TextInputPage },
  scene: { label: "Scene", section: "Components", component: ScenePage },
  glass: { label: "Glass", section: "Components", component: GlassPage },
  colors: { label: "Colors", section: "Tokens", component: ColorsPage },
} as const;

type PageKey = keyof typeof pages;

const sections = ["Tokens", "Components"] as const;

/**
 * ui#15 slice 2a: two nav-pattern candidates for Michael's screenshot round
 * (criterion 4 — a hard checkpoint, not a recommendation). "A" is a slide-in
 * drawer, "B" is an always-visible wrapping top bar. The toggle in
 * MobileTopBar is a review affordance so both can be thumb-tested live; it
 * goes away once he picks one (slice 2b).
 */
type NavCandidate = "A" | "B";

function applyColorMode(mode: ColorMode) {
  if (mode === "light") {
    document.documentElement.style.colorScheme = "light";
  } else if (mode === "dark") {
    document.documentElement.style.colorScheme = "dark";
  } else {
    document.documentElement.style.removeProperty("color-scheme");
  }
}

type NavCallbacks = {
  activePage: PageKey;
  onSelectPage: (key: PageKey) => void;
  colorMode: ColorMode;
  onSelectColorMode: (mode: ColorMode) => void;
};

/** The sidebar's inner content — page links grouped by section, plus the
 *  color-mode switcher. Shared verbatim between the desktop sidebar and
 *  candidate A's drawer (the drawer is the same menu, just presented as an
 *  overlay instead of a permanent column). */
function NavSections({ activePage, onSelectPage, colorMode, onSelectColorMode }: NavCallbacks) {
  return (
    <>
      {sections.map((section) => (
        <div key={section}>
          <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2 mt-4 first:mt-0">
            {section}
          </p>
          {(Object.entries(pages) as [PageKey, (typeof pages)[PageKey]][])
            .filter(([, page]) => page.section === section)
            .map(([key, { label }]) => (
              <Button
                key={key}
                size="sm"
                borderSide="left"
                ghost={activePage !== key}
                onClick={() => onSelectPage(key)}
                className="w-full justify-start"
              >
                {label}
              </Button>
            ))}
        </div>
      ))}

      <div className="pt-6">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
          Color Mode
        </p>
        <div className="flex flex-col">
          {(["light", "dark", "system"] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              borderSide="left"
              ghost={colorMode !== mode}
              onClick={() => onSelectColorMode(mode)}
              className="w-full justify-start"
            >
              {mode}
            </Button>
          ))}
        </div>
      </div>
    </>
  );
}

/** Candidate B — always-visible stacked top bar. Below `md`, nav reflows
 *  from a vertical sidebar into a horizontal bar: page links wrap via
 *  flex-wrap, color-mode switcher alongside. No open/closed state. */
function NavBar({ activePage, onSelectPage, colorMode, onSelectColorMode }: NavCallbacks) {
  return (
    <nav className="md:hidden flex flex-wrap items-center gap-2 border-b border-rule-subtle p-4 transition-colors duration-300">
      {(Object.entries(pages) as [PageKey, (typeof pages)[PageKey]][]).map(([key, { label }]) => (
        <Button
          key={key}
          size="sm"
          ghost={activePage !== key}
          onClick={() => onSelectPage(key)}
        >
          {label}
        </Button>
      ))}
      <span className="text-xs font-medium text-text-muted uppercase tracking-wider ml-2">
        Mode
      </span>
      {(["light", "dark", "system"] as const).map((mode) => (
        <Button
          key={mode}
          size="sm"
          ghost={colorMode !== mode}
          onClick={() => onSelectColorMode(mode)}
        >
          {mode}
        </Button>
      ))}
    </nav>
  );
}

/** Candidate A — slide-in drawer. Mounted whenever candidate A is active
 *  (not just while open) so `open`'s transform/opacity classes transition
 *  instead of popping; closes on page-pick (via onSelectPage), backdrop
 *  click, or Escape (handled by the App-level keydown listener). */
function NavDrawer({
  open,
  onClose,
  activePage,
  onSelectPage,
  colorMode,
  onSelectColorMode,
}: NavCallbacks & { open: boolean; onClose: () => void }) {
  return (
    <div
      className={cn(
        "md:hidden fixed inset-0 z-[1100]",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/50 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <nav
        className={cn(
          "absolute inset-y-0 left-0 w-64 max-w-[80vw] bg-surface-base border-r border-rule-subtle p-4 space-y-1 overflow-y-auto transition-transform duration-300",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <NavSections
          activePage={activePage}
          onSelectPage={onSelectPage}
          colorMode={colorMode}
          onSelectColorMode={onSelectColorMode}
        />
      </nav>
    </div>
  );
}

/** Mobile-only bar above `main`: hamburger toggle (candidate A only — B's
 *  nav is already visible below), current page label, and the A/B review
 *  toggle so Michael can thumb-test both candidates live. */
function MobileTopBar({
  activeLabel,
  navCandidate,
  onToggleCandidate,
  drawerOpen,
  onToggleDrawer,
}: {
  activeLabel: string;
  navCandidate: NavCandidate;
  onToggleCandidate: () => void;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
}) {
  return (
    <div className="md:hidden flex items-center justify-between gap-3 border-b border-rule-subtle p-4 transition-colors duration-300">
      <div className="flex items-center gap-3 min-w-0">
        {navCandidate === "A" && (
          <IconButton
            ghost
            size="md"
            aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
            onClick={onToggleDrawer}
          >
            {drawerOpen ? <X /> : <List />}
          </IconButton>
        )}
        <span className="text-sm font-medium truncate">{activeLabel}</span>
      </div>
      <Button
        size="sm"
        ghost
        onClick={onToggleCandidate}
        className="shrink-0"
        aria-label="Switch nav candidate (review only)"
      >
        Nav: {navCandidate}
      </Button>
    </div>
  );
}

export function App() {
  const [colorMode, setColorMode] = useState<ColorMode>(() => {
    return (localStorage.getItem("color-mode") as ColorMode) || "system";
  });
  const [activePage, setActivePage] = useState<PageKey>("button");
  const [navCandidate, setNavCandidate] = useState<NavCandidate>("A");
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    applyColorMode(colorMode);
    localStorage.setItem("color-mode", colorMode);
  }, [colorMode]);

  useEffect(() => {
    if (navCandidate !== "A" || !drawerOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navCandidate, drawerOpen]);

  const ActiveComponent = pages[activePage].component;

  function selectPage(key: PageKey) {
    setActivePage(key);
    setDrawerOpen(false);
  }

  function toggleNavCandidate() {
    setNavCandidate((c) => (c === "A" ? "B" : "A"));
    setDrawerOpen(false);
  }

  return (
    <div className="min-h-screen bg-surface-base text-text-primary flex flex-col md:flex-row transition-colors duration-300">
      {/* Mobile-only top bar */}
      <MobileTopBar
        activeLabel={pages[activePage].label}
        navCandidate={navCandidate}
        onToggleCandidate={toggleNavCandidate}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((v) => !v)}
      />

      {/* Candidate B: always-visible stacked/wrapping bar, mobile only */}
      {navCandidate === "B" && (
        <NavBar
          activePage={activePage}
          onSelectPage={selectPage}
          colorMode={colorMode}
          onSelectColorMode={setColorMode}
        />
      )}

      {/* Candidate A: slide-in drawer, mobile only */}
      {navCandidate === "A" && (
        <NavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          activePage={activePage}
          onSelectPage={selectPage}
          colorMode={colorMode}
          onSelectColorMode={setColorMode}
        />
      )}

      {/* Desktop sidebar — unchanged markup, hidden below md */}
      <nav className="hidden md:block w-48 shrink-0 border-r border-rule-subtle p-4 space-y-1 transition-colors duration-300">
        <NavSections
          activePage={activePage}
          onSelectPage={selectPage}
          colorMode={colorMode}
          onSelectColorMode={setColorMode}
        />
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto transition-colors duration-300 dot-grid">
        <ActiveComponent />
      </main>
    </div>
  );
}
