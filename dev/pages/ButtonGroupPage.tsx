import {
  Gear,
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  Screencast,
  CaretDown,
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
          <ButtonGroup>
            <IconButton size="lg" ghost><Screencast /></IconButton>
            <IconButton size="lg" ghost><Gear /></IconButton>
          </ButtonGroup>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>With chevron</SectionLabel>
        <div className="flex items-center gap-3">
          <ButtonGroup>
            <IconButton size="lg" ghost><Microphone /></IconButton>
            <ChevronButton size="lg" ghost><CaretDown /></ChevronButton>
          </ButtonGroup>

          <ButtonGroup>
            <IconButton size="lg" ghost color="danger"><MicrophoneSlash /></IconButton>
            <ChevronButton size="lg" ghost><CaretDown /></ChevronButton>
          </ButtonGroup>
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Toolbar example</SectionLabel>
        <div className="flex items-center gap-3">
          <ButtonGroup>
            <IconButton size="lg" ghost><Microphone /></IconButton>
            <ChevronButton size="lg" ghost><CaretDown /></ChevronButton>
          </ButtonGroup>
          <ButtonGroup>
            <IconButton size="lg" ghost><VideoCamera /></IconButton>
            <ChevronButton size="lg" ghost><CaretDown /></ChevronButton>
          </ButtonGroup>
          <ButtonGroup>
            <IconButton size="lg" ghost><Screencast /></IconButton>
            <IconButton size="lg" ghost><Gear /></IconButton>
          </ButtonGroup>
        </div>
      </section>
    </div>
  );
}
