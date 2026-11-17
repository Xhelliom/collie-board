import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import type { AgentView } from "@/lib/types";
import { PanePlace } from "./pane-place";

const base: AgentView = { paneId: "t3", workspaceId: "hc", workspaceLabel: "hc", workspaceNumber: 1, tabId: "hc", agent: "shell", status: "idle", cwd: "/r/app", focused: false, kind: "shell" };

beforeEach(() => setPreference("en"));

describe("PanePlace", () => {
  it("an hc pane the board filed: herdr-app, its space and tab, blue", () => {
    render(<PanePlace agent={{ ...base, appPlace: { space: "Collie Board", tab: "app · terminal" } }} />);
    const box = screen.getByRole("status");
    expect(box).toHaveAttribute("data-tone", "info");
    expect(box).toHaveTextContent("herdr-app · space « Collie Board » · tab « app · terminal »");
  });

  it("a herdr 0.9 pane beside hc: its space and tab, orange, invisible in herdr-app", () => {
    render(<PanePlace agent={{ ...base, paneId: "w2:p1", workspaceId: "w2", workspaceLabel: "free-app", tabId: "w2:t1", engine: "herdr09" }} tabLabel="1" />);
    const box = screen.getByRole("status");
    expect(box).toHaveAttribute("data-tone", "attention");
    expect(box).toHaveTextContent("herdr 0.9 · space « free-app » · tab « 1 » — invisible in herdr-app");
  });

  it("a herdr 0.9-only machine: blue, nothing to miss", () => {
    render(<PanePlace agent={{ ...base, workspaceId: "w2", workspaceLabel: "work" }} />);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "info");
  });
});
