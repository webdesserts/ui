import {
  Gear,
  MicrophoneSlash,
  Phone,
  CaretDown,
} from "@phosphor-icons/react";
import { IconButton, ChevronButton } from "../../src";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

export function IconButtonPage() {
  return (
    <div className="p-8 max-w-3xl space-y-10">
      <header>
        <h1 className="text-3xl font-light">IconButton</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Icon-only buttons with baked icon sizing.
        </p>
      </header>

      <section className="space-y-3">
        <SectionLabel>Sizes</SectionLabel>
        <div className="flex flex-wrap items-center gap-3">
          <IconButton size="sm"><Gear /></IconButton>
          <IconButton size="md"><Gear /></IconButton>
          <IconButton size="lg"><Gear /></IconButton>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Danger</SectionLabel>
        <div className="flex flex-wrap items-center gap-3">
          <IconButton color="danger"><MicrophoneSlash /></IconButton>
          <IconButton color="danger" size="lg"><MicrophoneSlash /></IconButton>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Rounded</SectionLabel>
        <div className="flex flex-wrap items-center gap-3">
          <IconButton rounded size="sm"><Phone /></IconButton>
          <IconButton rounded size="md"><Phone /></IconButton>
          <IconButton rounded size="lg"><Phone /></IconButton>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Ghost</SectionLabel>
        <div className="flex flex-wrap items-center gap-3">
          <IconButton ghost size="sm"><Gear /></IconButton>
          <IconButton ghost size="md"><Gear /></IconButton>
          <IconButton ghost size="lg"><Gear /></IconButton>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Disabled</SectionLabel>
        <div className="flex flex-wrap items-center gap-3">
          <IconButton disabled><Gear /></IconButton>
          <IconButton color="danger" disabled><MicrophoneSlash /></IconButton>
          <IconButton rounded disabled><Phone /></IconButton>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>ChevronButton</SectionLabel>
        <div className="flex flex-wrap items-center gap-3">
          <ChevronButton size="sm"><CaretDown /></ChevronButton>
          <ChevronButton size="md"><CaretDown /></ChevronButton>
          <ChevronButton size="lg"><CaretDown /></ChevronButton>
          <ChevronButton pressed><CaretDown /></ChevronButton>
        </div>
      </section>
    </div>
  );
}
