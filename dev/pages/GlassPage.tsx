import {
  Gear,
  Microphone,
  MicrophoneSlash,
  Screencast,
  CaretDown,
} from "@phosphor-icons/react";
import { Button, IconButton, ChevronButton, ButtonGroup } from "../../src";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

export function GlassPage() {
  return (
    <div className="p-8 max-w-3xl space-y-10">
      <header>
        <h1 className="text-3xl font-light">Glass</h1>
        <p className="text-text-secondary mt-2 text-sm">
          Glass-mode variants on a patterned background.
        </p>
      </header>

      <div
        className="p-6 rounded-lg space-y-8 bg-[radial-gradient(circle,var(--dot-color)_var(--dot-size),transparent_var(--dot-size))] bg-[length:var(--dot-spacing)_var(--dot-spacing)]"
      >
        <section className="space-y-3">
          <SectionLabel>Button</SectionLabel>
          <div className="flex gap-3">
            <Button glass>Join Room</Button>
            <Button glass><Gear /> Settings</Button>
          </div>
        </section>

        <section className="space-y-3">
          <SectionLabel>IconButton</SectionLabel>
          <div className="flex items-center gap-3">
            <IconButton glass size="sm"><Gear /></IconButton>
            <IconButton glass size="md"><Gear /></IconButton>
            <IconButton glass size="lg"><Gear /></IconButton>
            <IconButton glass color="danger" size="lg"><MicrophoneSlash /></IconButton>
          </div>
        </section>

        <section className="space-y-3">
          <SectionLabel>ButtonGroup</SectionLabel>
          <div className="flex items-center gap-3">
            <ButtonGroup glass>
              <IconButton glass size="lg"><Screencast /></IconButton>
              <IconButton glass size="lg"><Gear /></IconButton>
            </ButtonGroup>

            <ButtonGroup glass>
              <IconButton glass size="lg"><Microphone /></IconButton>
              <ChevronButton glass size="lg"><CaretDown /></ChevronButton>
            </ButtonGroup>
          </div>
        </section>
      </div>
    </div>
  );
}
