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

function PanelContent({ note }: { note: string }) {
  return (
    <>
      <p className="text-sm font-medium text-text-primary">Task detail panel</p>
      <p className="mt-1 text-xs text-text-secondary">{note}</p>
    </>
  );
}

function TaskCard({ title, status }: { title: string; status: string }) {
  return (
    <div className="rounded-md border border-rule-subtle bg-surface-raised p-3">
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="text-xs text-text-secondary">{status}</p>
    </div>
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

      <div className="p-6 rounded-lg space-y-8">
        <section className="space-y-3">
          <SectionLabel>Button</SectionLabel>
          <div className="flex flex-wrap gap-3">
            <Button glass>Join Room</Button>
            <Button glass><Gear /> Settings</Button>
          </div>
        </section>

        <section className="space-y-3">
          <SectionLabel>IconButton</SectionLabel>
          <div className="flex flex-wrap items-center gap-3">
            <IconButton glass size="sm"><Gear /></IconButton>
            <IconButton glass size="md"><Gear /></IconButton>
            <IconButton glass size="lg"><Gear /></IconButton>
            <IconButton glass color="danger" size="lg"><MicrophoneSlash /></IconButton>
          </div>
        </section>

        <section className="space-y-3">
          <SectionLabel>ButtonGroup</SectionLabel>
          <div className="flex flex-wrap items-center gap-3">
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

        <section className="space-y-3">
          <SectionLabel>Panel</SectionLabel>

          <div className="glass-panel rounded-md p-4">
            <PanelContent note="glass-panel over the page's dot-grid backdrop." />
          </div>

          <div>
            <div className="grid grid-cols-3 gap-3">
              <TaskCard title="Fix scrollbar drift" status="In progress" />
              <TaskCard title="Ship glass panel" status="In review" />
              <TaskCard title="Retune chat width" status="Backlog" />
            </div>
            <div className="glass-panel relative -mt-10 mx-6 rounded-md p-4">
              <PanelContent note="glass-panel over dot-grid + raised cards (depth-decked board rows)." />
            </div>
          </div>

          <div className="glass-panel border-none rounded-md p-4">
            <PanelContent note="glass-panel border-none — the default border removed." />
          </div>
        </section>
      </div>
    </div>
  );
}
