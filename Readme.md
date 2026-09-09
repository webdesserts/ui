# Web Desserts UI

This a collection of common styles, colors, and components that I use across my "webdesserts" themed applications. This library is in early development. Will update with more info at a later point in time...

## Peer dependencies

Consuming applications must install: `react`, `react-dom`, `motion` (optional — only needed if a consumed component uses it), and **`@floating-ui/react`** (required by the `Select` component). The root barrel (`@webdesserts/ui`) statically exports `Select`, so any consumer importing the barrel must install `@floating-ui/react` themselves before adopting a package version that contains it — the library build keeps Floating UI external, and `peerDependenciesMeta` marking a peer optional does NOT provide runtime isolation.

## Component notes

### Select

`Select` does **not** participate in native form submission. Passing `name` does not submit the selected value with a parent `<form>` — form integration (a hidden input or otherwise) remains consumer-owned by design, and the library deliberately ships no hidden input.
