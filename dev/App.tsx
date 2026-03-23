import { useState, useEffect } from "react";
import { Button } from "../src";
import { ButtonPage } from "./pages/ButtonPage";
import { ButtonLinkPage } from "./pages/ButtonLinkPage";
import { IconButtonPage } from "./pages/IconButtonPage";
import { ButtonGroupPage } from "./pages/ButtonGroupPage";
import { MenuItemPage } from "./pages/MenuItemPage";
import { GlassPage } from "./pages/GlassPage";
import { ColorsPage } from "./pages/ColorsPage";

type ColorMode = "system" | "light" | "dark";

const pages = {
  button: { label: "Button", section: "Components", component: ButtonPage },
  buttonlink: { label: "ButtonLink", section: "Components", component: ButtonLinkPage },
  iconbutton: { label: "IconButton", section: "Components", component: IconButtonPage },
  buttongroup: { label: "ButtonGroup", section: "Components", component: ButtonGroupPage },
  menuitem: { label: "MenuItem", section: "Components", component: MenuItemPage },
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

export function App() {
  const [colorMode, setColorMode] = useState<ColorMode>(() => {
    return (localStorage.getItem("color-mode") as ColorMode) || "system";
  });
  const [activePage, setActivePage] = useState<PageKey>("button");

  useEffect(() => {
    applyColorMode(colorMode);
    localStorage.setItem("color-mode", colorMode);
  }, [colorMode]);

  const ActiveComponent = pages[activePage].component;

  return (
    <div className="min-h-screen bg-surface-base text-text-primary flex transition-colors duration-300">
      {/* Sidebar */}
      <nav className="w-48 shrink-0 border-r border-rule-subtle p-4 space-y-1 transition-colors duration-300">
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
                  onClick={() => setActivePage(key)}
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
                onClick={() => setColorMode(mode)}
                className="w-full justify-start"
              >
                {mode}
              </Button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto transition-colors duration-300 bg-[radial-gradient(circle,var(--dot-grid-color)_var(--dot-grid-size),transparent_var(--dot-grid-size))] bg-[length:var(--dot-grid-spacing)_var(--dot-grid-spacing)]">
        <ActiveComponent />
      </main>
    </div>
  );
}
