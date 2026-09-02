import { configDefaults, defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [
    react({ babel: { plugins: ["babel-plugin-react-compiler"] } }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
    browser: {
      enabled: true,
      // Defensive pin: already resolves false today (vitest's default is
      // headless-aware, not the stale !process.env.CI TSDoc), but headless
      // being true is what makes it false — pin it explicitly so it can't
      // silently flip if headless is ever changed (ui/t:14).
      ui: false,
      provider: playwright({
        contextOptions: {
          // Causal fix: Playwright falls back to a 1280x720 context when no
          // viewport is set, which is shorter than the 1280x800 the tester
          // iframe wants — vitest's orchestrator then scales the iframe down
          // to fit (`min(1, w/1280, h/800)` = 0.9), shrinking every element
          // screenshot's captured pixel dimensions before deviceScaleFactor
          // even applies (ui/t:14). Supplying the real size directly removes
          // the shrink.
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: 2,
        },
      }),
      headless: true,
      screenshotFailures: false,
      instances: [
        {
          browser: "chromium",
          viewport: { width: 1280, height: 800 },
        },
      ],
    },
  },
});
