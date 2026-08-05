import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Library-mode build (JS emission only — see tsconfig.build.json's
// --emitDeclarationOnly pass for .d.ts). Kept separate from vite.config.ts,
// which is dev-app-rooted (root: "dev") and serves a different purpose.
export default defineConfig({
  plugins: [react({ babel: { plugins: ["babel-plugin-react-compiler"] } })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false, // tsc's --emitDeclarationOnly pass owns the .d.ts files in this same directory
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      // Only the bare-specifier imports src/ actually has (verified via
      // grep this dispatch) plus three defensive externals: react-dom (no
      // direct import today, but a peer dep some component could reach via
      // portals), react/jsx-runtime (the automatic JSX transform's own
      // implicit import, invisible to a source-level grep), and
      // react/compiler-runtime (the compiled output's own memo-cache helper
      // import — externalizing bare "react" does NOT also cover this
      // subpath; without it Rollup bundles React's internal implementation
      // instead of leaving it as an import, discovered via a first build
      // that produced dist/_virtual/* and dist/node_modules/react/* chunks
      // not in the expected 44-file mirror).
      external: ["react", "react-dom", "react/jsx-runtime", "react/compiler-runtime", "motion/react", "clsx"],
      output: {
        // Load-bearing: preserves the current 44-file dist/ shape (1:1 with
        // src/) instead of collapsing to a single bundle — tree-shaking and
        // existing consumer expectations depend on this.
        preserveModules: true,
        preserveModulesRoot: "src",
      },
    },
  },
});
