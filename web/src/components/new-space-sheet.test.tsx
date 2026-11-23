import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "@/test/setup";
import { NewSpaceSheet } from "./new-space-sheet";

function setup() {
  server.use(
    http.get("/api/repos", () =>
      HttpResponse.json({
        repos: [
          { path: "/r/app", name: "app", source: "card" },
          { path: "/r/web", name: "web", source: "card" },
        ],
        hiddenCount: 0,
      }),
    ),
  );
  const onCreate = vi.fn();
  render(<NewSpaceSheet open onClose={() => {}} onCreate={onCreate} />);
  return onCreate;
}

const openPicker = async () => userEvent.click(await screen.findByRole("button", { name: /^Directory/ }));
const labels = () => screen.getAllByRole("option").map((o) => o.textContent);

describe("NewSpaceSheet folder picker", () => {
  it("keeps home first, the repos, then « Other folder… », and the search filters the repos", async () => {
    setup();
    await screen.findByText("Directory (optional)");
    await openPicker();
    await screen.findByRole("option", { name: /^app/ });
    expect(labels()).toEqual(["~ (home dir)", expect.stringMatching(/^app — /), expect.stringMatching(/^web — /), "Other folder…"]);
    await userEvent.type(screen.getByRole("combobox"), "we");
    expect(labels()).toEqual([expect.stringMatching(/^web — /), "Other folder…"]);
  });

  it("picking a repo fills the folder the agent starts in", async () => {
    const onCreate = setup();
    await openPicker();
    await userEvent.click(await screen.findByRole("option", { name: /^web/ }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Directory \(optional\) web/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Open a shell/ }));
    expect(onCreate).toHaveBeenCalledWith({ label: undefined, cwd: "/r/web" });
  });

  it("« Other folder… » still opens the free path", async () => {
    const onCreate = setup();
    await openPicker();
    await userEvent.click(await screen.findByRole("option", { name: "Other folder…" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Folder path" }), "/srv/x");
    await userEvent.click(screen.getByRole("button", { name: /Open a shell/ }));
    expect(onCreate).toHaveBeenCalledWith({ label: undefined, cwd: "/srv/x" });
  });
});
