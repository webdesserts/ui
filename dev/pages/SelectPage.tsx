import { useState } from "react";
import { Select } from "../../src";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
      {children}
    </p>
  );
}

const FEEDS = [
  { value: "feed-main", label: "Main" },
  { value: "feed-deployments", label: "Deployments" },
  { value: "feed-releases", label: "Releases" },
];

export function SelectPage() {
  const [fruit, setFruit] = useState("banana-canonical");
  const [feed, setFeed] = useState("feed-main");

  return (
    <div className="p-8 max-w-3xl space-y-10">
      <header>
        <h1 className="text-3xl font-light">Select</h1>
        <p className="text-text-secondary mt-2 text-sm">
          A controlled dropdown select with input chrome. The trigger keeps the
          hover treatment while the menu is open; options reuse MenuItem's
          selected treatment. Keyboard: Enter selects and returns focus, Escape
          closes without change, Tab closes and advances. Canonical values and
          display labels are deliberately separate. Select does not participate
          in native form submission — `name` does not submit the selected
          value; form integration is consumer-owned.
        </p>
      </header>

      <section className="space-y-3">
        <SectionLabel>Sizes</SectionLabel>
        <div className="flex flex-col gap-3 max-w-sm">
          <Select
            size="sm"
            aria-label="Small"
            value={fruit}
            options={[
              { value: "banana-canonical", label: "Small" },
              ...FEEDS,
            ]}
            onChange={setFruit}
          />
          <Select
            size="md"
            aria-label="Medium"
            value={fruit}
            options={[{ value: "banana-canonical", label: "Medium" }, ...FEEDS]}
            onChange={setFruit}
          />
          <Select
            size="lg"
            aria-label="Large"
            value={fruit}
            options={[{ value: "banana-canonical", label: "Large" }, ...FEEDS]}
            onChange={setFruit}
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Controlled value / placeholder</SectionLabel>
        <div className="flex flex-col gap-3 max-w-sm">
          <Select
            aria-label="Fruit"
            value={fruit}
            options={[
              { value: "apple-canonical", label: "Apple" },
              { value: "banana-canonical", label: "Banana" },
              { value: "cherry-canonical", label: "Cherry" },
            ]}
            onChange={setFruit}
          />
          <Select
            aria-label="Unmatched"
            value="missing"
            placeholder="Select…"
            options={[
              { value: "apple-canonical", label: "Apple" },
              { value: "banana-canonical", label: "Banana" },
            ]}
            onChange={setFruit}
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Invalid</SectionLabel>
        <div className="flex flex-col gap-3 max-w-sm">
          <Select
            aria-label="Invalid empty"
            invalid
            value="missing"
            placeholder="Required"
            options={FEEDS}
            onChange={setFeed}
          />
          <Select
            aria-label="Invalid with value"
            invalid
            value="feed-main"
            options={FEEDS}
            onChange={setFeed}
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Disabled / empty</SectionLabel>
        <div className="flex flex-col gap-3 max-w-sm">
          <Select
            aria-label="Disabled"
            disabled
            value="feed-main"
            options={FEEDS}
            onChange={setFeed}
          />
          <Select
            aria-label="Empty"
            value=""
            placeholder="No options"
            options={[]}
            onChange={setFeed}
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Ghost (transparent resting surface)</SectionLabel>
        <div className="flex flex-col gap-3 max-w-sm">
          <Select
            aria-label="Ghost feed"
            ghost
            value={feed}
            options={FEEDS}
            onChange={setFeed}
          />
          <Select
            aria-label="Ghost unmatched"
            ghost
            value="missing"
            placeholder="Pick a feed…"
            options={FEEDS}
            onChange={setFeed}
          />
        </div>
      </section>
    </div>
  );
}
