/**
 * Mobile (375px) snapshot tests (S3 commit 3).
 *
 * A two-column chat-shape layout (a message list + a detail/chat pane) at a
 * mobile viewport width, in both navigation states — list focused (parked
 * detail) and detail focused (parked list). Posted to scene-lab for visual
 * review.
 *
 * page.viewport() changes the REAL iframe viewport (not just a CSS box) —
 * required so Scene's own ResizeObserver-driven viewport measurement and any
 * viewport-relative CSS behave like a genuine mobile viewport, not a 375px
 * div floating inside the default 1280px iframe. Confirmed at S3 commit-3
 * pickup: this leaks across tests AND across files without an explicit
 * reset (a known vitest issue — vitest-dev/vitest#7649), hence the
 * afterEach restoring vitest.config.ts's configured 1280x800 default.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { TestWrapper } from "../test-wrapper";
import { Scene, SceneColumn, SceneObject } from "@/src";

const MOBILE_WIDTH = 375;
const MOBILE_HEIGHT = 812;

afterEach(async () => {
  document.documentElement.style.colorScheme = "";
  await page.viewport(1280, 800);
});

/** A conversation-list row, styled to look like a chat list item. */
function ListRow({ name, preview, unread }: { name: string; preview: string; unread?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "10px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        fontFamily: "monospace",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#fff", fontWeight: unread ? 700 : 400, fontSize: 13 }}>{name}</span>
        {unread && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "rgba(99,102,241,0.9)",
              flexShrink: 0,
            }}
          />
        )}
      </div>
      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>{preview}</span>
    </div>
  );
}

/** A chat message bubble, aligned left (received) or right (sent). */
function MessageBubble({ text, self }: { text: string; self?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: self ? "flex-end" : "flex-start", padding: "0 10px" }}>
      <div
        style={{
          maxWidth: "78%",
          padding: "8px 12px",
          borderRadius: 12,
          background: self ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.08)",
          border: `1px solid ${self ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.15)"}`,
          color: "#fff",
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function ChatList() {
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "12px",
          fontFamily: "monospace",
          fontSize: 15,
          fontWeight: 700,
          color: "#fff",
          borderBottom: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        Chats
      </div>
      <ListRow name="Umbra" preview="Sweeps clean — 118/118 green" unread />
      <ListRow name="Peri" preview="Landed the touch pan commit" />
      <ListRow name="Scene Assessment" preview="120 scenarios scouted" unread />
      <ListRow name="Michael" preview="Looks good, ship it" />
      <ListRow name="dots-cli#5" preview="Merged — Umbra's first task" />
      <ListRow name="webpush" preview="mentions -> phone works" unread />
      <ListRow name="task-board" preview="4-state redesign shipped" />
      <ListRow name="scene-lab" preview="Iris scouting the assessment" />
      <ListRow name="read-scoping" preview="slice 1a landed" />
      <ListRow name="triage-fix" preview="4096 cap + reasons required" />
    </div>
  );
}

function ChatDetail() {
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          padding: "12px",
          fontFamily: "monospace",
          fontSize: 15,
          fontWeight: 700,
          color: "#fff",
          borderBottom: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        Umbra
      </div>
      <MessageBubble text="Sensors gate clean — 0 findings." />
      <MessageBubble text="Nice. Push it." self />
      <MessageBubble text="Pushed + deployed. Board's clear." />
      <MessageBubble text="Started scouting the queue for a 5th dots-cli task." />
      <MessageBubble text="Which candidate?" self />
      <MessageBubble text="commands.rs error-helper dedup — verified never done before." />
      <MessageBubble text="Approved under the standing grant." self />
      <MessageBubble text="Merged. 61/61 green in an isolated workspace." />
    </div>
  );
}

describe("Scene mobile — two-column chat shape (375px)", () => {
  it("scene-mobile-chat-list-focused", async () => {
    document.documentElement.style.colorScheme = "dark";
    await page.viewport(MOBILE_WIDTH, MOBILE_HEIGHT);
    const screen = await render(
      <TestWrapper fullPage width={MOBILE_WIDTH} height={MOBILE_HEIGHT}>
        <Scene duration={0}>
          <SceneColumn name="list">
            <SceneObject name="list-panel" focused>
              <ChatList />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="detail">
            <SceneObject name="detail-panel" focused={false}>
              <ChatDetail />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });

  it("scene-mobile-chat-detail-focused", async () => {
    document.documentElement.style.colorScheme = "dark";
    await page.viewport(MOBILE_WIDTH, MOBILE_HEIGHT);
    const screen = await render(
      <TestWrapper fullPage width={MOBILE_WIDTH} height={MOBILE_HEIGHT}>
        <Scene duration={0}>
          <SceneColumn name="list">
            <SceneObject name="list-panel" focused={false}>
              <ChatList />
            </SceneObject>
          </SceneColumn>
          <SceneColumn name="detail">
            <SceneObject name="detail-panel" focused>
              <ChatDetail />
            </SceneObject>
          </SceneColumn>
        </Scene>
      </TestWrapper>,
    );
    await expect.element(page.elementLocator(screen.container)).toMatchScreenshot();
  });
});
