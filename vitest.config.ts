import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
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
