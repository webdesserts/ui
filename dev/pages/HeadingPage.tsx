import { Heading } from "../../src";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

export function HeadingPage() {
  return (
    <div className="p-8 max-w-3xl space-y-10">
      <header>
        <Heading size="xl">Heading</Heading>
        <p className="text-text-secondary mt-2 text-sm">
          A polymorphic section title. `size` picks both a default HTML
          element and a visual size recipe; `as` overrides the element
          without changing the visual size.
        </p>
      </header>

      <section className="space-y-3">
        <SectionLabel>Sizes</SectionLabel>
        <div className="flex flex-col gap-4">
          <Heading size="xl">Heading xl</Heading>
          <Heading size="lg">Heading lg</Heading>
          <Heading size="md">Heading md</Heading>
          <Heading size="sm">Heading sm</Heading>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Muted</SectionLabel>
        <div className="flex flex-col gap-4">
          <Heading size="xl" muted>
            Heading xl
          </Heading>
          <Heading size="lg" muted>
            Heading lg
          </Heading>
          <Heading size="md" muted>
            Heading md
          </Heading>
          <Heading size="sm" muted>
            Heading sm
          </Heading>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>`as` override (xl size, h4 element)</SectionLabel>
        <div className="flex flex-col gap-3">
          <Heading size="xl" as="h4">
            Still visually xl
          </Heading>
        </div>
      </section>
    </div>
  );
}
