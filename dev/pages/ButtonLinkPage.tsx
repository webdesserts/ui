import { ButtonLink } from "../../src";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

export function ButtonLinkPage() {
  return (
    <div className="p-8 max-w-3xl space-y-10">
      <header>
        <h1 className="text-3xl font-light">ButtonLink</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Navigation links with a partial centered spread bar.
        </p>
      </header>

      <section className="space-y-3">
        <SectionLabel>Default</SectionLabel>
        <div className="flex flex-wrap gap-6">
          <ButtonLink href="#">About</ButtonLink>
          <ButtonLink href="#">Projects</ButtonLink>
          <ButtonLink href="#">Contact</ButtonLink>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Small</SectionLabel>
        <div className="flex flex-wrap gap-6">
          <ButtonLink href="#" size="sm">About</ButtonLink>
          <ButtonLink href="#" size="sm">Projects</ButtonLink>
          <ButtonLink href="#" size="sm">Contact</ButtonLink>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>As button</SectionLabel>
        <div className="flex flex-wrap gap-6">
          <ButtonLink as="button">Tab One</ButtonLink>
          <ButtonLink as="button">Tab Two</ButtonLink>
          <ButtonLink as="button">Tab Three</ButtonLink>
        </div>
      </section>
    </div>
  );
}
