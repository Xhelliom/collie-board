import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";

import { SpaceOverview } from "./space-overview";
import { SpaceStrip } from "./space-strip";
import { TabStrip } from "./tab-strip";

// jsdom has no layout, so the 44 px floor is asserted on the class that sets it: size-11 = 2.75rem.
const is44 = (el: HTMLElement) => /(^|\s)size-11(\s|$)/.test(el.className);

describe("touch targets ≥ 44 px", () => {
  it("TabStrip +", () => {
    render(<TabStrip workspaceId="w1" tabs={[{ tabId: "t1", workspaceId: "w1", number: 1, label: "a", focused: false, paneCount: 1 }]} agents={[]} selected={null} onSelect={vi.fn()} onNewTab={vi.fn()} />);
    expect(is44(screen.getByRole("button", { name: "New tab" }))).toBe(true);
  });

  it("SpaceStrip +", () => {
    render(<SpaceStrip workspaces={[]} agents={[]} selected={null} onSelect={vi.fn()} onNewSpace={vi.fn()} />);
    expect(is44(screen.getByRole("button", { name: "New space" }))).toBe(true);
  });

  it("SpaceOverview +", () => {
    render(<SpaceOverview workspaces={[]} tabs={[]} agents={[]} shellPanes={[]} onOpen={vi.fn()} onOpenPane={vi.fn()} onNewSpace={vi.fn()} />);
    expect(is44(screen.getByRole("button", { name: "New space" }))).toBe(true);
  });

  it("AgentChat desktop View mode toggle", () => {
    const src = readFileSync(resolve(__dirname, "agent-chat.tsx"), "utf8");
    // ponytail: AgentChat is too heavy to mount; assert the source classes of both toggle buttons.
    for (const label of ["Terminal view", "Reading view"]) {
      const at = src.indexOf(`aria-label="${label}"`);
      expect(src.slice(at, at + 200)).toMatch(/flex size-11 /);
    }
  });

  it("AppHeader Back and NotificationBell", () => {
    // ponytail: both need router context; assert the source classes like the AgentChat toggle.
    for (const [file, label] of [["app-header.tsx", 'aria-label="Back"'], ["notification-bell.tsx", "aria-label={count"]]) {
      const src = readFileSync(resolve(__dirname, file), "utf8");
      const at = src.indexOf(label);
      expect(src.slice(at, at + 250)).toMatch(/flex size-11 /);
    }
  });
});
