import { useEffect, useRef, useState, type RefObject } from "react";
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
 *  color-mode switcher. Shared verbatim between the desktop sidebar and the
 *  mobile drawer (the drawer is the same menu, just presented as an overlay
 *  instead of a permanent column). */
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

/** The mobile nav drawer — a slide-in overlay below `md`. Always mounted (not
 *  just while open) so `open`'s transform/opacity classes transition instead
 *  of popping; closes on page-pick (via onSelectPage), backdrop click, or
 *  Escape (handled by the App-level keydown listener). The outer wrapper
 *  carries both `aria-hidden` and `inert` while closed — the drawer stays
 *  mounted (translated off-screen) so its buttons must be pulled out of the
 *  tab order and out of the accessibility tree, not just visually hidden. */
function NavDrawer({
  open,
  onClose,
  activePage,
  onSelectPage,
  colorMode,
  onSelectColorMode,
  navRef,
}: NavCallbacks & {
  open: boolean;
  onClose: () => void;
  navRef: RefObject<HTMLElement | null>;
}) {
  return (
    <div
      className={cn(
        "md:hidden fixed inset-0 z-[1100]",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
      inert={!open}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/50 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <nav
        id="mobile-nav-drawer"
        ref={navRef}
        tabIndex={-1}
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

/** Mobile-only bar above `main`: hamburger toggle for the drawer, plus the
 *  current page label. */
function MobileTopBar({
  activeLabel,
  drawerOpen,
  onToggleDrawer,
  hamburgerRef,
}: {
  activeLabel: string;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  hamburgerRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="md:hidden flex items-center justify-between gap-3 border-b border-rule-subtle p-4 transition-colors duration-300">
      <div className="flex items-center gap-3 min-w-0">
        <IconButton
          ref={hamburgerRef}
          ghost
          size="md"
          aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={drawerOpen}
          aria-controls="mobile-nav-drawer"
          onClick={onToggleDrawer}
        >
          {drawerOpen ? <X /> : <List />}
        </IconButton>
        <span className="text-sm font-medium truncate">{activeLabel}</span>
      </div>
    </div>
  );
}

export function App() {
  const [colorMode, setColorMode] = useState<ColorMode>(() => {
    return (localStorage.getItem("color-mode") as ColorMode) || "system";
  });
  const [activePage, setActivePage] = useState<PageKey>("button");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerNavRef = useRef<HTMLElement | null>(null);
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    applyColorMode(colorMode);
    localStorage.setItem("color-mode", colorMode);
  }, [colorMode]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  // Focus management: move focus into the drawer when it opens, and back to
  // the hamburger when it closes. Every close path (Escape, backdrop click,
  // page pick, X) funnels through setDrawerOpen(false), so this single
  // transition-keyed effect covers all of them — including the X path, which
  // is a structural no-op since focus never left the hamburger to begin with.
  //
  // Mirrors SceneObject.tsx's prevFocusedRef pattern: the ref is initialized
  // to drawerOpen's current value, so the initial mount (drawerOpen starts
  // false) is never mistaken for a close transition and doesn't steal focus
  // on page load. useEffect (not useLayoutEffect) so this runs after the DOM
  // has painted and the drawer's `inert` attribute has cleared, matching
  // SceneObject.tsx's own sequencing rationale (see its :97 comment).
  const prevDrawerOpenRef = useRef(drawerOpen);
  useEffect(() => {
    const justOpened = drawerOpen && !prevDrawerOpenRef.current;
    const justClosed = !drawerOpen && prevDrawerOpenRef.current;
    prevDrawerOpenRef.current = drawerOpen;

    if (justOpened) {
      const container = drawerNavRef.current;
      if (!container) return;
      const focusable = container.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      if (focusable) {
        focusable.focus({ preventScroll: true });
      } else {
        container.focus({ preventScroll: true });
      }
    } else if (justClosed) {
      hamburgerRef.current?.focus({ preventScroll: true });
    }
  }, [drawerOpen]);

  const ActiveComponent = pages[activePage].component;

  function selectPage(key: PageKey) {
    setActivePage(key);
    setDrawerOpen(false);
  }

  return (
    <div className="min-h-screen bg-surface-base text-text-primary flex flex-col md:flex-row transition-colors duration-300">
      {/* Mobile-only top bar */}
      <MobileTopBar
        activeLabel={pages[activePage].label}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((v) => !v)}
        hamburgerRef={hamburgerRef}
      />

      {/* Mobile-only slide-in drawer nav */}
      <NavDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activePage={activePage}
        onSelectPage={selectPage}
        colorMode={colorMode}
        onSelectColorMode={setColorMode}
        navRef={drawerNavRef}
      />

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
