type ColorSwatch = {
  name: string;
  variable: string;
};

type ColorGroup = {
  label: string;
  note?: string;
  colors: ColorSwatch[];
};

const baseColors: ColorSwatch[] = [
  { name: "Purple 10", variable: "--np-purple-10" },
  { name: "Purple 15", variable: "--np-purple-15" },
  { name: "Purple 20", variable: "--np-purple-20" },
  { name: "Purple 30", variable: "--np-purple-30" },
  { name: "Purple 45", variable: "--np-purple-45" },
  { name: "Sepia 60", variable: "--np-sepia-60" },
  { name: "Sepia 75", variable: "--np-sepia-75" },
  { name: "Sepia 85", variable: "--np-sepia-85" },
  { name: "Sepia 90", variable: "--np-sepia-90" },
  { name: "Sepia 95", variable: "--np-sepia-95" },
];

const supportingGroups: ColorGroup[] = [
  {
    label: "Magenta",
    note: "Accent (hue 6.18)",
    colors: [
      { name: "Magenta 50", variable: "--np-magenta-50" },
      { name: "Magenta 55", variable: "--np-magenta-55" },
    ],
  },
  {
    label: "Danger",
    note: "Hue 31.32",
    colors: [
      { name: "Danger 20", variable: "--np-danger-20" },
      { name: "Danger 25", variable: "--np-danger-25" },
      { name: "Danger", variable: "--np-danger" },
      { name: "Danger 80", variable: "--np-danger-80" },
      { name: "Danger 85", variable: "--np-danger-85" },
    ],
  },
  {
    label: "Success",
    note: "Hue 170",
    colors: [
      { name: "Success 25", variable: "--np-success-25" },
      { name: "Success 30", variable: "--np-success-30" },
      { name: "Success", variable: "--np-success" },
      { name: "Success 80", variable: "--np-success-80" },
      { name: "Success 85", variable: "--np-success-85" },
    ],
  },
];

function Swatch({ color }: { color: ColorSwatch }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="size-20 shrink-0"
        style={{ backgroundColor: `var(${color.variable})` }}
      />
      <div className="min-w-0">
        <p className="text-sm text-text-primary">{color.name}</p>
        <p className="font-mono text-xs text-text-secondary">{color.variable}</p>
      </div>
    </div>
  );
}

function SwatchColumn({ colors }: { colors: ColorSwatch[] }) {
  return (
    <div className="rounded-sm border border-rule-subtle overflow-hidden bg-glass-bg backdrop-blur-[var(--glass-blur)]">
      {colors.map((color) => (
        <Swatch key={color.variable} color={color} />
      ))}
    </div>
  );
}

function GroupHeader({
  label,
  note,
}: {
  label: string;
  note?: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
        {label}
      </p>
      {note && (
        <p className="text-xs text-text-muted mt-0.5">{note}</p>
      )}
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="space-y-3">
          <GroupHeader label="Base" note="Purple → Sepia" />
          <SwatchColumn colors={baseColors} />
        </div>

        <div className="space-y-8">
          {supportingGroups.map((group) => (
            <div key={group.label} className="space-y-3">
              <GroupHeader label={group.label} note={group.note} />
              <SwatchColumn colors={group.colors} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
