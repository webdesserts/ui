import { Button, TextInput } from "../../src";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

export function TextInputPage() {
  return (
    <div className="p-8 max-w-3xl space-y-10">
      <header>
        <h1 className="text-3xl font-light">TextInput</h1>
        <p className="text-text-secondary mt-2 text-sm">
          A single-line text field. A bottom rule is the resting affordance; the
          field fades to the interactive surface on hover and focus. Keyboard
          focus (tab) shows an accent ring; clicking does not — try both.
        </p>
      </header>

      <section className="space-y-3">
        <SectionLabel>Sizes</SectionLabel>
        <div className="flex flex-col gap-3 max-w-sm">
          <TextInput size="sm" placeholder="Small" />
          <TextInput size="md" placeholder="Medium" />
          <TextInput size="lg" placeholder="Large" />
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>With value</SectionLabel>
        <div className="flex flex-col gap-3 max-w-sm">
          <TextInput defaultValue="https://umbra.computer/" />
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Invalid</SectionLabel>
        <div className="flex flex-col gap-3 max-w-sm">
          <TextInput invalid placeholder="Required" />
          <TextInput invalid defaultValue="ftp://not-allowed" />
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Disabled</SectionLabel>
        <div className="flex flex-col gap-3 max-w-sm">
          <TextInput disabled placeholder="Disabled" />
          <TextInput disabled defaultValue="Disabled with value" />
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Beside a Button (height alignment)</SectionLabel>
        <div className="flex flex-wrap items-center gap-3 max-w-md">
          <TextInput placeholder="/Users/you/notes" />
          <Button>Choose…</Button>
        </div>
      </section>
    </div>
  );
}
