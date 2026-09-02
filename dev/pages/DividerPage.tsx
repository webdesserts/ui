import { Divider, Heading } from "../../src";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

export function DividerPage() {
  return (
    <div className="p-8 max-w-3xl space-y-10">
      <header>
        <Heading size="xl">Divider</Heading>
        <p className="text-text-secondary mt-2 text-sm">
          A dotted horizontal rule. `variant` picks the rule's weight;
          spacing/width is left to the caller's own layout.
        </p>
      </header>

      <section className="space-y-3">
        <SectionLabel>Default</SectionLabel>
        <div className="max-w-md">
          <p className="text-text-secondary text-sm pb-3">Section above</p>
          <Divider />
          <p className="text-text-secondary text-sm pt-3">Section below</p>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Subtle</SectionLabel>
        <div className="max-w-md">
          <p className="text-text-secondary text-sm pb-3">Section above</p>
          <Divider variant="subtle" />
          <p className="text-text-secondary text-sm pt-3">Section below</p>
        </div>
      </section>
    </div>
  );
}
