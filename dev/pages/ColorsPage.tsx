function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

type ColorSwatch = {
  name: string;
  variable: string;
  lch: string;
};

const families: { label: string; note?: string; colors: ColorSwatch[] }[] = [
  {
    label: "Purple",
    note: "Surfaces (hue ~315)",
    colors: [
      { name: "Purple 5", variable: "--np-purple-5", lch: "lch(0.63 0.47 323)" },
      { name: "Purple 10", variable: "--np-purple-10", lch: "lch(8.95 7.85 314.2)" },
      { name: "Purple 15", variable: "--np-purple-15", lch: "lch(14.84 7.47 314)" },
      { name: "Purple 20", variable: "--np-purple-20", lch: "lch(25.69 7.89 318)" },
      { name: "Purple 30", variable: "--np-purple-30", lch: "lch(30.11 8.23 315.6)" },
    ],
  },
  {
    label: "Sepia",
    note: "Text, borders, light surfaces (hue ~30)",
    colors: [
      { name: "Sepia 40", variable: "--np-sepia-40", lch: "lch(48.32 5.41 32.4)" },
      { name: "Sepia 55", variable: "--np-sepia-55", lch: "lch(56.98 5.08 26.4)" },
      { name: "Sepia 85", variable: "--np-sepia-85", lch: "lch(75.66 4.53 33.3)" },
      { name: "Sepia 90", variable: "--np-sepia-90", lch: "lch(83.79 5.18 31.4)" },
      { name: "Sepia 95", variable: "--np-sepia-95", lch: "lch(96.14 5.02 31.4)" },
    ],
  },
  {
    label: "Magenta",
    note: "Accent (hue 6.18)",
    colors: [
      { name: "Magenta 50", variable: "--np-magenta-50", lch: "lch(50 67.55 6.18)" },
      { name: "Magenta 55", variable: "--np-magenta-55", lch: "lch(57.12 67.55 6.18)" },
    ],
  },
];

function Swatch({ color }: { color: ColorSwatch }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="size-18 rounded-sm border border-rule-subtle"
        style={{ backgroundColor: `var(${color.variable})` }}
      />
      <div>
        <p className="text-sm text-text-primary">{color.name}</p>
        <p className="font-mono text-xs text-text-muted">{color.variable}</p>
      </div>
    </div>
  );
}

export function ColorsPage() {
  return (
    <div className="p-8 max-w-5xl space-y-10">
      <header>
        <h1 className="text-3xl font-light">Colors</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Raw palette values. These are mode-independent — semantic tokens map
          them to UI roles via <code className="font-mono">light-dark()</code>.
        </p>
      </header>

      {families.map((family) => (
        <section key={family.label} className="space-y-3">
          <div>
            <SectionLabel>{family.label}</SectionLabel>
            {family.note && (
              <p className="text-xs text-text-muted mt-0.5">{family.note}</p>
            )}
          </div>
          <div className="flex gap-6">
            {family.colors.map((color) => (
              <Swatch key={color.variable} color={color} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
