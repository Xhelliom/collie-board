import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { MachineSwitcher } from "@/components/machine-switcher";
import { setPreference } from "@/i18n";
import { clearPeerCache, type PeersView } from "@/lib/peers";

let view: PeersView;
let tested: string[];

beforeEach(() => {
  setPreference("en");
  clearPeerCache();
  tested = [];
  view = {
    name: "arch-2",
    invitation: null,
    inbound: [],
    outbound: [
      { name: "win-cad", url: "https://win-cad.ts.net", pairedAt: "2026-10-26T10:00:00.000Z" },
      { name: "nas", url: "https://nas.ts.net", pairedAt: "2026-10-26T10:00:00.000Z" },
    ],
    environments: [],
    error: null,
  };
  server.use(
    http.get("/api/peers", () => HttpResponse.json(view)),
    http.post("/api/peers/test", async ({ request }) => {
      const { name } = (await request.json()) as { name: string };
      tested.push(name);
      return HttpResponse.json({
        ok: true,
        test: name === "win-cad" ? { state: "ok", node: name, version: null, panes: 1, environments: [], seenAs: null } : { state: "unreachable", error: "timeout" },
      });
    }),
  );
});

describe("MachineSwitcher", () => {
  test("renders nothing without a paired peer", async () => {
    view = { ...view, outbound: [] };
    const { container } = render(<MachineSwitcher />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(tested).toEqual([]);
  });

  test("tests reachability on opening only, and links each peer to its own Collie", async () => {
    render(<MachineSwitcher />);
    const button = await screen.findByRole("button", { name: /machine: arch-2/i });
    expect(tested).toEqual([]); // nothing runs before the menu opens

    await userEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("this machine")).toBeInTheDocument();
    const cad = within(dialog).getByRole("link", { name: /win-cad/ });
    expect(cad).toHaveAttribute("href", "https://win-cad.ts.net");
    expect(cad).toHaveAttribute("target", "_blank");
    await waitFor(() => expect(cad).toHaveTextContent(/reachable/));
    await waitFor(() => expect(within(dialog).getByRole("link", { name: /nas/ })).toHaveTextContent(/unreachable/));
    expect(tested.sort()).toEqual(["nas", "win-cad"]);
  });

  test("a reopen within the cache window does not test again", async () => {
    render(<MachineSwitcher />);
    await userEvent.click(await screen.findByRole("button", { name: /machine: arch-2/i }));
    await waitFor(() => expect(tested).toHaveLength(2));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /machine: arch-2/i }));
    await screen.findByRole("dialog");
    expect(tested).toHaveLength(2);
  });

  test("speaks French", async () => {
    setPreference("fr");
    render(<MachineSwitcher />);
    await userEvent.click(await screen.findByRole("button", { name: /machine : arch-2/i }));
    expect(await screen.findByText("cette machine")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: /win-cad/ })).toHaveTextContent(/joignable/));
  });
});
