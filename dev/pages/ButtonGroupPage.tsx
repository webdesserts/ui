import {
  Gear,
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  Screencast,
  CaretDown,
  Phone,
} from "@phosphor-icons/react";
import { IconButton, ChevronButton, ButtonGroup } from "../../src";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

export function ButtonGroupPage() {
  return (
    <div className="p-8 max-w-3xl space-y-10">
      <header>
        <h1 className="text-3xl font-light">ButtonGroup</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Unified container for adjacent buttons.
        </p>
      </header>

      <section className="space-y-3">
        <SectionLabel>Icon buttons</SectionLabel>
        <div className="flex items-center gap-3">
          <ButtonGroup size="lg">
            <IconButton><Screencast /></IconButton>
            <IconButton><Gear /></IconButton>
          </ButtonGroup>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>With chevron</SectionLabel>
        <div className="flex items-center gap-3">
          <ButtonGroup size="lg">
            <IconButton><Microphone /></IconButton>
            <ChevronButton><CaretDown /></ChevronButton>
          </ButtonGroup>

          <ButtonGroup size="lg">
            <IconButton color="danger"><MicrophoneSlash /></IconButton>
            <ChevronButton color="danger"><CaretDown /></ChevronButton>
          </ButtonGroup>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Danger</SectionLabel>
        <div className="flex items-center gap-3">
          <ButtonGroup size="lg">
            <IconButton color="danger"><Phone /></IconButton>
            <ChevronButton color="danger"><CaretDown /></ChevronButton>
          </ButtonGroup>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Ghost</SectionLabel>
        <div className="flex items-center gap-3">
          <ButtonGroup size="lg" ghost>
            <IconButton ghost><Microphone /></IconButton>
            <ChevronButton ghost><CaretDown /></ChevronButton>
          </ButtonGroup>

          <ButtonGroup size="lg" ghost>
            <IconButton ghost color="danger"><MicrophoneSlash /></IconButton>
            <ChevronButton ghost><CaretDown /></ChevronButton>
          </ButtonGroup>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Toolbar example</SectionLabel>
        <div className="flex items-center gap-3">
          <ButtonGroup size="lg">
            <IconButton><Microphone /></IconButton>
            <ChevronButton><CaretDown /></ChevronButton>
          </ButtonGroup>
          <ButtonGroup size="lg">
            <IconButton><VideoCamera /></IconButton>
            <ChevronButton><CaretDown /></ChevronButton>
          </ButtonGroup>
          <ButtonGroup size="lg">
            <IconButton><Screencast /></IconButton>
            <IconButton><Gear /></IconButton>
          </ButtonGroup>
        </div>
      </section>
    </div>
  );
}
