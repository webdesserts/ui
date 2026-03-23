import { MenuItem } from "../../src";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

export function MenuItemPage() {
  return (
    <div className="p-8 max-w-3xl space-y-10">
      <header>
        <h1 className="text-3xl font-light">MenuItem</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Dropdown list items with selected state and left-side spread bar.
        </p>
      </header>

      <section className="space-y-3">
        <SectionLabel>Default</SectionLabel>
        <div className="w-64 rounded-md border border-rule-subtle bg-surface-raised overflow-hidden">
          <MenuItem selected>Built-in Microphone</MenuItem>
          <MenuItem>USB Headset</MenuItem>
          <MenuItem>Bluetooth Speaker</MenuItem>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>No selection</SectionLabel>
        <div className="w-64 rounded-md border border-rule-subtle bg-surface-raised overflow-hidden">
          <MenuItem>Option A</MenuItem>
          <MenuItem>Option B</MenuItem>
          <MenuItem>Option C</MenuItem>
        </div>
      </section>
    </div>
  );
}
