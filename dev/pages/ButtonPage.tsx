import { Gear } from "@phosphor-icons/react";
import { Button } from "../../src";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

export function ButtonPage() {
  return (
    <div className="p-8 max-w-3xl space-y-10">
      <header>
        <h1 className="text-3xl font-light">Button</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Standalone actions with a full-width spread bar.
        </p>
      </header>

      <section className="space-y-3">
        <SectionLabel>Default</SectionLabel>
        <div className="flex flex-wrap gap-3">
          <Button>Join Room</Button>
          <Button><Gear /> Settings</Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Ghost</SectionLabel>
        <div className="flex flex-wrap gap-3">
          <Button ghost>Join Room</Button>
          <Button ghost><Gear /> Settings</Button>
          <Button ghost disabled>Disabled</Button>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Small</SectionLabel>
        <div className="flex flex-wrap gap-3">
          <Button size="sm">Join Room</Button>
          <Button size="sm" ghost>Ghost</Button>
          <Button size="sm" disabled>Disabled</Button>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Border sides</SectionLabel>
        <div className="flex flex-wrap gap-3 items-center">
          <Button borderSide="bottom">Bottom</Button>
          <Button borderSide="top">Top</Button>
          <Button borderSide="right">Right</Button>
          <Button borderSide="left">Left</Button>
        </div>
      </section>
    </div>
  );
}
