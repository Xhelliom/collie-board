import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { PeersControl } from "@/components/peers-control";
import { setPreference } from "@/i18n";
import type { PeersView } from "@/lib/peers";

// Settings → Peers (ADR 0049), driven through MSW: the GET is the bridge's view, each gesture a POST.

let view: PeersView;
let posted: [string, unknown][];
let testResult: unknown;

beforeEach(() => {
  setPreference("en");
  posted = [];
  testResult = { state: "refused" };
  view = {
    name: "arch-2",
    invitation: null,
    inbound: [{ name: "arch-1", login: "me@github", pairedAt: "2026-10-26T10:00:00.000Z", launch: [] }],
    outbound: [{ name: "win-cad", url: "https://win-cad.ts.net", pairedAt: "2026-10-26T10:00:00.000Z" }],
    environments: [{ name: "cad", repoPath: "/home/me/git/cad", agent: "claude" }],
    error: null,
  };
  server.use(
    http.get("/api/repos", () =>
      HttpResponse.json({ repos: [{ path: "/home/me/git/app", name: "app", source: "scan" }], hiddenCount: 0 }),
    ),
    http.get("/api/peers", () => HttpResponse.json(view)),
    http.post("/api/peers/invite", () => {
      view = { ...view, invitation: { state: "open", code: "ABCDEFGH", expiresAt: Date.now() + 600_000 } };
      return HttpResponse.json({ ok: true, code: "ABCDEFGH", expiresAt: Date.now() + 600_000 });
    }),
    http.delete("/api/peers/invite", () => {
      view = { ...view, invitation: null };
      return HttpResponse.json({ ok: true });
    }),
    http.post("/api/peers/:action", async ({ request, params }) => {
      const body = await request.json();
      posted.push([String(params.action), body]);
      if (params.action === "add") {
        return HttpResponse.json({ ok: true, peer: { name: "b", url: "https://b.ts.net" }, test: { state: "ok", node: "b", environments: [{ name: "app", agent: "claude" }] } });
      }
      if (params.action === "test") return HttpResponse.json({ ok: true, test: testResult });
      return HttpResponse.json({ ok: true });
    }),
  );
});

describe("PeersControl", () => {
  test("lists who drives this machine and who it drives, with identity and launch grant", async () => {
    render(<PeersControl />);
    const inbound = await screen.findByRole("region", { name: /who drives this machine/i });
    expect(within(inbound).getByText("arch-1")).toBeInTheDocument();
    expect(within(inbound).getByText(/me@github/)).toBeInTheDocument();
    expect(within(inbound).getByText(/may not launch an agent/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /machines this one drives/i })).getByText("win-cad")).toBeInTheDocument();
  });

  test("an invitation shows its code, a countdown, and can be cancelled", async () => {
    const user = userEvent.setup();
    render(<PeersControl />);
    const invite = await screen.findByRole("region", { name: /invite a peer/i });
    await user.click(within(invite).getByRole("button", { name: /invite a peer/i }));
    expect(await screen.findByTestId("invite-code")).toHaveTextContent("ABCD-EFGH");
    expect(within(invite).getByText(/expires in \d+:\d\d/i)).toBeInTheDocument();
    await user.click(within(invite).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByTestId("invite-code")).toBeNull());
  });

  test("a burned invitation says by whom", async () => {
    view.invitation = { state: "burned", at: Date.now(), login: "eve@github" };
    render(<PeersControl />);
    expect(await screen.findByText(/burned by a wrong attempt — eve@github/i)).toBeInTheDocument();
  });

  test("adding a peer sends url and code to this bridge, then offers the reciprocal pairing", async () => {
    const user = userEvent.setup();
    render(<PeersControl />);
    const add = await screen.findByRole("region", { name: /add a peer/i });
    await user.type(within(add).getByLabelText(/address/i), "https://b.ts.net");
    await user.type(within(add).getByLabelText(/^code/i), "abcd-efgh");
    await user.click(within(add).getByRole("button", { name: /^pair$/i }));
    await waitFor(() => expect(posted).toContainEqual(["add", { url: "https://b.ts.net", code: "abcd-efgh" }]));
    expect(await within(add).findByText(/paired with b\. reached — b offers 1 environment/i)).toBeInTheDocument();
    await user.click(within(add).getByRole("button", { name: /let b drive this machine too/i }));
    expect(await screen.findByTestId("invite-code")).toHaveTextContent("ABCD-EFGH");
  });

  test("revoke takes two taps; test shows the outcome", async () => {
    const user = userEvent.setup();
    render(<PeersControl />);
    const inbound = await screen.findByRole("region", { name: /who drives this machine/i });
    await user.click(within(inbound).getByRole("button", { name: /revoke/i }));
    expect(posted).toEqual([]);
    await user.click(within(inbound).getByRole("button", { name: /tap again/i }));
    await waitFor(() => expect(posted).toContainEqual(["revoke", { name: "arch-1" }]));

    const outbound = screen.getByRole("region", { name: /machines this one drives/i });
    await user.click(within(outbound).getByRole("button", { name: /test the connection/i }));
    expect(await within(outbound).findByText(/token refused \(401\)/i)).toBeInTheDocument();
  });

  test.each([
    [{ state: "closed" }, /nothing there \(404\).*no invitation accepted/i],
    [{ state: "unreachable", error: "connection refused" }, /unreachable: connection refused/i],
    [
      { state: "ok", node: "win-cad", version: "0.237.0", panes: 3, environments: [{ name: "cad", agent: "claude" }], seenAs: { peer: "arch-2", login: "me@github" } },
      /reached — win-cad offers 1 environment\(s\) \(cad\) · version 0\.237\.0 · 3 pane\(s\) · sees this machine as arch-2 \(me@github\)/i,
    ],
  ])("test the connection says %o readably", async (result, text) => {
    testResult = result;
    const user = userEvent.setup();
    render(<PeersControl />);
    const outbound = await screen.findByRole("region", { name: /machines this one drives/i });
    await user.click(within(outbound).getByRole("button", { name: /test the connection/i }));
    expect(await within(outbound).findByRole("status")).toHaveTextContent(text);
  });

  test("an environment is declared from a known repo and an agent, never a typed path; renamed; removed", async () => {
    const user = userEvent.setup();
    render(<PeersControl />);
    const envs = await screen.findByRole("region", { name: /environments offered/i });
    expect(within(envs).getByText("cad")).toBeInTheDocument();
    await waitFor(() => expect(within(envs).getByRole("option", { name: /app — \/home\/me\/git\/app/ })).toBeInTheDocument());
    await user.selectOptions(within(envs).getByLabelText(/repository/i), "/home/me/git/app");
    await user.selectOptions(within(envs).getByLabelText(/agent/i), "codex");
    expect(within(envs).getByLabelText(/^name/i)).toHaveValue("app");
    await user.click(within(envs).getByRole("button", { name: /declare/i }));
    await waitFor(() => expect(posted).toContainEqual(["environments", { action: "add", name: "app", repo: "/home/me/git/app", agent: "codex" }]));

    await user.click(within(envs).getByRole("button", { name: /rename/i }));
    const input = within(envs).getByDisplayValue("cad");
    await user.clear(input);
    await user.type(input, "cad-win");
    await user.click(within(envs).getByRole("button", { name: /save/i }));
    await waitFor(() => expect(posted).toContainEqual(["environments", { action: "rename", name: "cad", to: "cad-win" }]));

    await user.click(within(envs).getByRole("button", { name: /remove/i }));
    await user.click(within(envs).getByRole("button", { name: /tap again/i }));
    await waitFor(() => expect(posted).toContainEqual(["environments", { action: "remove", name: "cad" }]));
  });

  test("speaks French", async () => {
    setPreference("fr");
    render(<PeersControl />);
    expect(await screen.findByRole("region", { name: /qui pilote cette machine/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /inviter un pair/i })).toBeInTheDocument();
    expect(screen.getByText(/aucune identité Tailscale|me@github/)).toBeInTheDocument();
  });
});
