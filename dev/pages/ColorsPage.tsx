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
    note: "Surfaces, dark text (hue 315\u2192338)",
    colors: [
      { name: "Purple 10", variable: "--np-purple-10", lch: "lch(10 8.0 315)" },
      { name: "Purple 15", variable: "--np-purple-15", lch: "lch(15 7.8 318)" },
      { name: "Purple 20", variable: "--np-purple-20", lch: "lch(20 7.6 322)" },
      { name: "Purple 30", variable: "--np-purple-30", lch: "lch(30 7.2 328)" },
      { name: "Purple 45", variable: "--np-purple-45", lch: "lch(45 6.6 338)" },
    ],
  },
  {
    label: "Sepia",
    note: "Text, borders, light surfaces (hue 34\u219231)",
    colors: [
      { name: "Sepia 60", variable: "--np-sepia-60", lch: "lch(60 5.8 34)" },
      { name: "Sepia 75", variable: "--np-sepia-75", lch: "lch(75 5.4 32)" },
      { name: "Sepia 85", variable: "--np-sepia-85", lch: "lch(85 5.2 31)" },
      { name: "Sepia 90", variable: "--np-sepia-90", lch: "lch(90 5.0 31)" },
      { name: "Sepia 95", variable: "--np-sepia-95", lch: "lch(95 5.0 31)" },
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
  {
    label: "Status",
    colors: [
      { name: "Danger", variable: "--np-danger", lch: "lch(50.04 76.64 31.32)" },
      { name: "Success", variable: "--np-success", lch: "lch(65 45 155)" },
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
