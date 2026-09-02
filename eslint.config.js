import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";

// Scoped to src/ only — this is a targeted bailout-surface audit for the
// React Compiler, not a general-purpose lint setup for the whole repo.
// The global ignores entry keeps ESLint's default file walk from touching
// build output or other agents' worktree checkouts (dist/ carries stale
// eslint-disable comments from prior builds that otherwise surface as
// spurious "rule not found" errors once react-hooks is registered below).
export default [
  { ignores: ["dist/**", ".claude/**", ".vitest-attachments/**", "scratchpad/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    ...reactHooks.configs.flat["recommended-latest"],
  },
  // The scene/ physics subsystem (camera, scroll, geometry-cache hooks)
  // deliberately reads and writes refs during render — a DOM-measurement/
  // geometry-cache idiom documented at each call site (and, for the shared
  // refs, in the hooks' own params-interface doc comments) — and deliberately
  // runs several "remeasure every render, conditionally setState" effects
  // with no dependency array by design. Both patterns are pervasive here
  // (100-site sweep, ui/t:29 dispatch 1): react-hooks/refs alone accounted for
  // 66 of 92 opt-outs, and react-hooks/exhaustive-deps' no-array shape
  // accounted for 16 more. React Compiler bails out of memoizing these
  // functions safely at function granularity regardless of what ESLint
  // reports — this relaxation changes hygiene REPORTING only, not compiler
  // behavior. Scoped to an explicit file list, not a scene/ glob: new files
  // in this subsystem stay fully enforced until they earn a spot here.
  // Revisit at ui/t:32 (render-propagation riders) and whenever o97's v2
  // attribute-contract re-home lands — both are natural moments this list
  // gets re-checked against the code as it stands then.
  {
    files: [
      "src/components/scene/Scene.tsx",
      "src/components/scene/SceneColumn.tsx",
      "src/components/scene/SceneObject.tsx",
      "src/components/scene/useColumnAnchoring.ts",
      "src/components/scene/useColumnScroll.ts",
      "src/components/scene/useSettledValue.ts",
      "src/components/scene/debug/SceneDebugOverlay.tsx",
    ],
    rules: {
      "react-hooks/refs": "off",
    },
  },
  // Same idiom class, narrower list: only the files where the no-dependency-
  // array remeasure pattern is actually pervasive enough to relax at the
  // rule level (3+ sites each). Files with just one or two exhaustive-deps
  // exceptions (useColumnScroll.ts, the smaller debug components) keep a
  // per-site eslint-disable-next-line instead — proportionate, and it keeps
  // the rule enforced for the rest of those files' effects.
  {
    files: [
      "src/components/scene/Scene.tsx",
      "src/components/scene/SceneColumn.tsx",
      "src/components/scene/SceneObject.tsx",
      "src/components/scene/useColumnAnchoring.ts",
    ],
    rules: {
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
