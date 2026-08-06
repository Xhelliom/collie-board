import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { fixtureTranscript } from "@/test/handlers";
import type { TranscriptEntry } from "@/lib/types";
import { mergeTail, ReadingView } from "./reading-view";

// Reading mode reads the agent's own transcript — the text that was NEVER cut to a terminal's columns
// — and follows it forwards with `after`. Two things here can go wrong quietly, so both are pinned:
// the merge (a duplicated or lost turn) and the dialog banner (an agent blocked behind a question the
// reader can't see).

beforeAll(() => {
  // jsdom doesn't implement scrollTo; the message list auto-scrolls to the newest turn.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});

const turn = (uuid: string, text: string): TranscriptEntry => ({
  uuid,
  ts: "2026-08-03T10:00:00.000Z",
  role: "assistant",
  parts: [{ kind: "text", text }],
});

describe("mergeTail", () => {
  it("appends turns that are wholly new", () => {
    const held = [turn("a", "one"), turn("b", "two")];
    expect(mergeTail(held, [turn("c", "three")]).map((e) => e.uuid)).toEqual(["a", "b", "c"]);
  });

  // The fetch re-asks from the SECOND-newest turn on purpose: a tool result lands by mutating the turn
  // that made the call, so the newest turn we hold can still change after we've seen it.
  it("replaces an overlapping turn instead of duplicating it", () => {
    const held = [turn("a", "one"), turn("b", "no result yet")];
    const merged = mergeTail(held, [turn("b", "with its result"), turn("c", "three")]);
    expect(merged.map((e) => e.uuid)).toEqual(["a", "b", "c"]);
    expect(merged[1]!.parts[0]).toMatchObject({ text: "with its result" });
  });

  it("keeps what we hold when nothing new arrived", () => {
    const held = [turn("a", "one")];
    expect(mergeTail(held, [])).toBe(held);
  });

  it("bounds what it holds, dropping the oldest", () => {
    const held = [turn("a", "1"), turn("b", "2")];
    expect(mergeTail(held, [turn("c", "3")], 2).map((e) => e.uuid)).toEqual(["b", "c"]);
  });
});

describe("ReadingView", () => {
  const props = {
    paneId: "w1:p1",
    agent: "claude",
    poll: "idle",
    dialogPresent: false,
    onShowTerminal: vi.fn(),
  };

  it("renders the transcript's prose (the default MSW history fixture)", async () => {
    render(<ReadingView {...props} />);
    expect(await screen.findByText("One commit: abc1234.")).toBeInTheDocument();
  });

  // The whole point of the mode: Markdown becomes structure, so a phone reflows it instead of showing
  // an agent's 81-column cut re-broken at 50.
  it("renders agent Markdown as elements, not as literal syntax", async () => {
    server.use(
      http.get(/\/api\/pane\/[^/]+\/history/, () =>
        HttpResponse.json({
          paneId: "w1:p1",
          available: true,
          entries: [turn("m1", "## Done\n\n| file | change |\n|---|---|\n| a.ts | fixed |")],
          hasMore: false,
          total: 1,
          fileTruncated: false,
          queued: [],
        }),
      ),
    );
    render(<ReadingView {...props} />);
    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText(/\|---\|/)).not.toBeInTheDocument();
  });

  // A follower asks for what's NEW, not for the archive again — that's the difference between a mode
  // that can poll at 1.5s and one that can't.
  it("pulls incrementally: the second fetch carries an `after` cursor", async () => {
    const urls: string[] = [];
    server.use(
      http.get(/\/api\/pane\/[^/]+\/history/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({
          paneId: "w1:p1",
          available: true,
          entries: fixtureTranscript,
          hasMore: false,
          total: 2,
          fileTruncated: false,
          queued: [],
        });
      }),
    );
    const { rerender } = render(<ReadingView {...props} poll="idle" />);
    await screen.findByText("One commit: abc1234.");
    // One poll cycle: the revalidator leaves idle and settles back — the settle is the tick.
    rerender(<ReadingView {...props} poll="loading" />);
    rerender(<ReadingView {...props} poll="idle" />);

    await waitFor(() => expect(urls).toHaveLength(2));
    expect(urls[0]).not.toContain("after=");
    // Cursor = the second-newest turn we hold, so the newest comes back and its tool results catch up.
    expect(urls[1]).toContain("after=t1");
  });

  it("says so when the pane has no transcript, instead of showing an empty screen", async () => {
    server.use(
      http.get(/\/api\/pane\/[^/]+\/history/, () =>
        HttpResponse.json({ paneId: "w1:p1", available: false, reason: "no-log" }),
      ),
    );
    render(<ReadingView {...props} />);
    expect(await screen.findByText(/No transcript file was found/i)).toBeInTheDocument();
  });

  // A dialog exists ONLY in the TUI. Without this, an agent could sit blocked behind a question the
  // reader never sees — the one way this mode could be worse than not having it.
  it("banners a waiting dialog and hands the reader back to the terminal", async () => {
    const user = userEvent.setup();
    const onShowTerminal = vi.fn();
    render(<ReadingView {...props} dialogPresent onShowTerminal={onShowTerminal} />);

    const banner = await screen.findByRole("button", { name: /a question is waiting/i });
    await user.click(banner);
    expect(onShowTerminal).toHaveBeenCalled();
  });

  it("shows no banner while nothing is waiting", async () => {
    render(<ReadingView {...props} />);
    await screen.findByText("One commit: abc1234.");
    expect(screen.queryByRole("button", { name: /a question is waiting/i })).not.toBeInTheDocument();
  });

  // Text still sitting in Claude Code's OWN input queue — submitted while the agent was busy, not yet
  // taken or recalled. The one state that never reaches the transcript at all if it clears before the
  // next poll, so this is the only place it can ever be shown.
  describe("the queue card", () => {
    it("shows nothing when the queue is empty", async () => {
      render(<ReadingView {...props} />);
      await screen.findByText("One commit: abc1234.");
      expect(screen.queryByText(/^Queue/)).not.toBeInTheDocument();
    });

    it("shows a message sitting in Claude Code's own queue, with a count", async () => {
      server.use(
        http.get(/\/api\/pane\/[^/]+\/history/, () =>
          HttpResponse.json({
            paneId: "w1:p1",
            available: true,
            entries: [],
            hasMore: false,
            total: 0,
            fileTruncated: false,
            queued: ["merge the PR once tests pass"],
          }),
        ),
      );
      render(<ReadingView {...props} />);
      expect(await screen.findByText("merge the PR once tests pass")).toBeInTheDocument();
      expect(screen.getByText("Queue (1)")).toBeInTheDocument();
    });
  });
});
