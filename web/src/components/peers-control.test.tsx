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

beforeEach(() => {
  setPreference("en");
  posted = [];
  view = {
    name: "arch-2",
    invitation: null,
    inbound: [{ name: "arch-1", login: "me@github", pairedAt: "2026-10-26T10:00:00.000Z", launch: [] }],
    outbound: [{ name: "win-cad", url: "https://win-cad.ts.net", pairedAt: "2026-10-26T10:00:00.000Z" }],
    error: null,
  };
  server.use(
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
      if (params.action === "test") return HttpResponse.json({ ok: true, test: { state: "refused" } });
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

  test("speaks French", async () => {
    setPreference("fr");
    render(<PeersControl />);
    expect(await screen.findByRole("region", { name: /qui pilote cette machine/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /inviter un pair/i })).toBeInTheDocument();
    expect(screen.getByText(/aucune identité Tailscale|me@github/)).toBeInTheDocument();
  });
});
