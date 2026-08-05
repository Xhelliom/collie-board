import { useState, type ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider, useParams } from "react-router";

import { __resetConnectionHealth } from "@/lib/connection-health";

// Mock the race guard at AgentChat's seam so the frozen-revision tests can observe exactly what
// `detectedRevision` the tap handler passes (the guard's own behaviour is covered in
// prompt-select-block.test.tsx). The other tests in this file never reach it.
vi.mock("@/lib/prompt-action", () => ({
  submitPromptOption: vi.fn(),
}));
vi.mock("@/lib/wizard-action", () => ({
  submitWizardKeys: vi.fn(),
}));

import { server } from "@/test/setup";
import { clearStatus } from "@/lib/status";
import { submitPromptOption } from "@/lib/prompt-action";
import { submitWizardKeys } from "@/lib/wizard-action";
import { fixtureAgents } from "@/test/handlers";
import { AgentChat } from "./agent-chat";

// The detail view's core job: type a reply and submit it to the bridge. This drives the whole wired
// path (composer → api.sendReply → MSW → optimistic clear / error surfacing) end-to-end, which no
// other test covers. AgentChat uses useRevalidator, so it needs a data router (createMemoryRouter).

beforeAll(() => {
  // jsdom doesn't implement scrollTo; the terminal mirror's auto-scroll calls it.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});
beforeEach(() => clearStatus());

function renderChat(overrides: Partial<ComponentProps<typeof AgentChat>> = {}) {
  const agent = fixtureAgents[0]!; // a blocked claude agent
  const props: ComponentProps<typeof AgentChat> = {
    paneId: agent.paneId,
    agent,
    agents: fixtureAgents,
    shellPanes: [],
    tabs: [],
    text: "recent pane output",
    onBack: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
  const router = createMemoryRouter([{ path: "/", element: <AgentChat {...props} /> }]);
  render(<RouterProvider router={router} />);
  return props;
}

describe("AgentChat — reply flow", () => {
  it("sends a typed reply and clears the composer on success", async () => {
    const user = userEvent.setup();
    renderChat();
    const box = screen.getByPlaceholderText(/type a reply/i);

    await user.type(box, "looks good");
    expect(box).toHaveValue("looks good");

    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("keeps the draft and surfaces the error when the bridge rejects the send", async () => {
    server.use(
      http.post(/\/api\/pane\/[^/]+\/reply$/, () =>
        HttpResponse.json({ ok: false, error: "agent busy" }),
      ),
    );
    const user = userEvent.setup();
    renderChat();
    const box = screen.getByPlaceholderText(/type a reply/i);

    await user.type(box, "retry this");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("agent busy")).toBeInTheDocument();
    expect(box).toHaveValue("retry this"); // not cleared on failure
  });
});

// Echoes the space passed via navigation state, so a test can assert the header lands on the space
// overview ("/") for the right workspace.
function SpaceOverviewSentinel() {
  const { spaceId } = useParams();
  return <div>overview:{spaceId ?? "none"}</div>;
}

describe("AgentChat — header title block", () => {
  it("leads with the space, puts the directory on the subline, and drops the redundant agent name", () => {
    renderChat(); // claude @ /home/you/webapp → ~/webapp
    // Scoped to the header: the same name is also the screen's sr-only h1 (which the header's own
    // title text can't be, since it lives inside a button — a heading there isn't exposed as one),
    // and (since the redesign) the desktop pane list's OWN row for this same pane, which falls back
    // to the bare agent slug ("claude") as ITS display name when no label/session name is set —
    // real, unrelated behaviour this test isn't about.
    const banner = within(screen.getByRole("banner"));
    expect(banner.getByText("webapp")).toBeInTheDocument(); // space leads
    expect(screen.getByText("~/webapp")).toBeInTheDocument(); // directory on the subline
    // The agent is conveyed by its icon (aria-label only) in the HEADER specifically, so its name
    // isn't repeated as text there.
    expect(banner.queryByText(/claude/i)).toBeNull();
    expect(screen.getByRole("button", { name: /open webapp overview/i })).toBeInTheDocument();
  });

  it("opens the space overview (all tabs + panes) when the title block is tapped", async () => {
    const user = userEvent.setup();
    const agent = fixtureAgents[0]!; // workspaceId w1
    const router = createMemoryRouter(
      [
        { path: "/space/:spaceId", element: <SpaceOverviewSentinel /> },
        {
          path: "/pane/:paneId",
          element: (
            <AgentChat
              paneId={agent.paneId}
              agent={agent}
              agents={fixtureAgents}
              shellPanes={[]}
              tabs={[]}
              text="out"
              onBack={vi.fn()}
              onSelect={vi.fn()}
            />
          ),
        },
      ],
      { initialEntries: ["/pane/w1:p1"] },
    );
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole("button", { name: /open webapp overview/i }));
    expect(await screen.findByText("overview:w1")).toBeInTheDocument();
  });
});

// The card a session backs. Desktop reaches it from ContextRailColumn (`lg:flex`), which left the
// mobile session with no route to its own card — this row is mobile's copy, same destination.
describe("AgentChat — the card this pane backs", () => {
  function renderWithCard(agent: (typeof fixtureAgents)[number]) {
    const router = createMemoryRouter(
      [
        { path: "/card/:cardId", element: <CardSentinel /> },
        {
          path: "/pane/:paneId",
          element: (
            <AgentChat
              paneId={agent.paneId}
              agent={agent}
              agents={fixtureAgents}
              shellPanes={[]}
              tabs={[]}
              text="out"
              onBack={vi.fn()}
              onSelect={vi.fn()}
            />
          ),
        },
      ],
      { initialEntries: [`/pane/${agent.paneId}`] },
    );
    render(<RouterProvider router={router} />);
  }

  it("names the card and opens it — the same destination desktop's rail leads to", async () => {
    const user = userEvent.setup();
    renderWithCard({ ...fixtureAgents[0]!, cardId: "c-42", cardTitle: "Ship the thing" });

    // Named with the card, which also tells it apart from the desktop rail's own plain
    // "Ouvrir la carte" — jsdom renders both breakpoints, a real browser only ever one.
    await user.click(screen.getByRole("button", { name: "Ouvrir la carte : Ship the thing" }));
    expect(await screen.findByText("card:c-42")).toBeInTheDocument();
  });

  it("shows no row at all when the pane backs no card", () => {
    renderWithCard(fixtureAgents[0]!); // hand-launched: no cardId
    expect(screen.queryByRole("button", { name: /ouvrir la carte/i })).toBeNull();
  });
});

// Echoes the card the pane row navigated to.
function CardSentinel() {
  const { cardId } = useParams();
  return <div>card:{cardId ?? "none"}</div>;
}

describe("AgentChat — read-only device", () => {
  it("disables the composer and shows the banner when the device isn't authorised", () => {
    renderChat({ device: { enforced: true, device: "spare-phone", authorized: false } });

    // The banner names the read-only state (and the device id), and the composer is locked.
    expect(screen.getByText("Lecture seule")).toBeInTheDocument();
    expect(screen.getByText(/spare-phone/)).toBeInTheDocument();
    const box = screen.getByPlaceholderText(/read-only — device not authorised/i);
    expect(box).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    // The terminal mirror still renders — reading is always allowed.
    expect(screen.getByText("recent pane output")).toBeInTheDocument();
  });

  it("keeps the composer live for an authorised device", () => {
    renderChat({ device: { enforced: true, device: "my-phone", authorized: true } });
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/type a reply/i)).not.toBeDisabled();
  });
});

describe("AgentChat — raw-terminal escape hatch", () => {
  afterEach(() => localStorage.clear());

  it("lifts a tail menu into buttons by default (grammars on)", async () => {
    renderChat({ text: MENU_TEXT });
    expect(await screen.findByRole("button", { name: "Yes" })).toBeInTheDocument();
    // The raw option row is consumed into the button, not shown as text.
    expect(screen.queryByText(/❯ 1\. Yes/)).not.toBeInTheDocument();
  });

  it("shows the plain mirror (no buttons, menu as raw text) when raw terminal is on", () => {
    localStorage.setItem(
      "collie:display-prefs:v3",
      JSON.stringify({ wrap: true, fontSize: 11, rawTerminal: true }),
    );
    renderChat({ text: MENU_TEXT });
    // No native prompt buttons — the escape hatch bypasses the block grammars entirely…
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    // …and the menu is rendered verbatim in the mirror, drivable by the keys pad.
    expect(screen.getByText(/1\. Yes/)).toBeInTheDocument();
  });

  it("lifts a multi-question wizard into native controls by default (grammars on)", async () => {
    renderChat({ text: WIZARD_TEXT });
    expect(await screen.findByRole("button", { name: /Parser/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next step" })).toBeInTheDocument();
    // The stepper header row is consumed into the wizard block, not mirrored as text.
    expect(screen.queryByText(/☐ Focus area/)).not.toBeInTheDocument();
  });

  it("raw terminal bypasses the wizard too — the dialog shows verbatim, keys-pad drivable", () => {
    localStorage.setItem(
      "collie:display-prefs:v3",
      JSON.stringify({ wrap: true, fontSize: 11, rawTerminal: true }),
    );
    renderChat({ text: WIZARD_TEXT });
    expect(screen.queryByRole("button", { name: /Parser/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next step" })).not.toBeInTheDocument();
    expect(screen.getByText(/1\. Parser/)).toBeInTheDocument();
    expect(screen.getByText(/☐ Focus area/)).toBeInTheDocument();
  });
});

// A minimal permission dialog at the buffer tail — enough for the REAL detector (not a mock) to
// lift it into prompt-select buttons inside AgentChat's mirror.
const MENU_TEXT = [
  "Do you want to create hello.txt?",
  " ❯ 1. Yes",
  "   2. No",
  "",
  " Esc to cancel · Tab to amend",
].join("\n");

// A minimal Claude input-box buffer at the tail: top border, the "❯" prompt, bottom border, then the
// statusline + a hint. For a Claude pane, chrome-stripping peels the box off the mirror and the
// statusline is re-surfaced as the app strip; for a non-Claude pane none of that runs (raw mirror).
const RULE = "─".repeat(60);
const STATUS_TEXT = [
  "Welcome back!",
  "",
  RULE,
  "❯ ",
  RULE,
  "  [Opus 4.8] ~/webapp · main",
  "  ← for agents",
].join("\n");

// A minimal multi-question wizard tail (stepper header + current question) — enough for the REAL
// wizard detector to lift it into the native WizardBlock inside AgentChat's mirror.
const WIZARD_TEXT = [
  "←  ☐ Focus area  ☐ Scope  ✔ Submit  →",
  "",
  "Which focus area should we work on?",
  "",
  "❯ 1. Parser",
  "  2. UI",
  "",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
].join("\n");

describe("AgentChat — prompt-select race guard wiring (frozen {text, revision} pair)", () => {
  const mockSubmit = vi.mocked(submitPromptOption);
  beforeEach(() => {
    mockSubmit.mockReset();
    mockSubmit.mockResolvedValue({ status: "sent" });
  });

  // Renders AgentChat inside a data router with EXTERNALLY-UPDATABLE pane props, standing in for the
  // route loader delivering fresh polls. Returns a setter that advances {text, revision} in place.
  function renderWithLivePane(initial: { text: string; revision: number }) {
    const agent = fixtureAgents[0]!; // a claude agent — the block grammars are gated on the agent
    let advance: (pane: { text: string; revision: number }) => void = () => {
      throw new Error("harness not mounted");
    };
    function Harness() {
      const [pane, setPane] = useState(initial);
      advance = setPane;
      return (
        <AgentChat
          paneId={agent.paneId}
          agent={agent}
          agents={fixtureAgents}
          shellPanes={[]}
          tabs={[]}
          text={pane.text}
          revision={pane.revision}
          onBack={vi.fn()}
          onSelect={vi.fn()}
        />
      );
    }
    const router = createMemoryRouter([{ path: "/", element: <Harness /> }]);
    render(<RouterProvider router={router} />);
    return (pane: { text: string; revision: number }) => advance(pane);
  }

  it("passes the FROZEN revision when the mirror is frozen and the pane advances underneath", async () => {
    // Regression (found in review): the handler used to pass the LIVE loader revision, which keeps
    // advancing via background polls even while the mirror is frozen — so the guard compared
    // live-vs-live and could never catch drift that happened before the freeze. The menu the user
    // taps is derived from the FROZEN text, so the guard must get the revision frozen WITH it.
    const user = userEvent.setup();
    const advance = renderWithLivePane({ text: MENU_TEXT, revision: 1 });

    // The real detector lifted the tail menu into buttons.
    await screen.findByRole("button", { name: "Yes" });

    // Freeze the mirror (opening find pins the tail — the same `following=false` state a scroll-up
    // freeze produces).
    await user.click(screen.getAllByRole("button", { name: "Find in output" })[0]!);

    // The pane advances while frozen: new output below the menu + a bumped revision.
    act(() => advance({ text: `${MENU_TEXT}\n● proceeding…\n`, revision: 2 }));

    // The frozen mirror still shows the old menu; the tap must hand the guard the FROZEN pair.
    await user.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ detectedRevision: 1 }));
  });

  it("passes the LIVE revision while following (the frozen pair is the live pair)", async () => {
    const user = userEvent.setup();
    const advance = renderWithLivePane({ text: MENU_TEXT, revision: 1 });
    await screen.findByRole("button", { name: "Yes" });

    // Not frozen: a revision-only poll (same text) is adopted into the shown pair.
    act(() => advance({ text: MENU_TEXT, revision: 2 }));

    await user.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ detectedRevision: 2 }));
  });

  // Same frozen-pair guarantee for the wizard path (the guard mirrors prompt-select's; this locks the
  // wiring so the live-vs-frozen-revision bug can't regress here either).
  it("wizard: passes the FROZEN revision when the mirror is frozen and the pane advances", async () => {
    const mockWizard = vi.mocked(submitWizardKeys);
    mockWizard.mockReset();
    mockWizard.mockResolvedValue({ status: "sent" });

    const user = userEvent.setup();
    const advance = renderWithLivePane({ text: WIZARD_TEXT, revision: 1 });

    // The real detector lifted the multi-question tail into a wizard with option buttons.
    await screen.findByRole("button", { name: /Parser/ });

    await user.click(screen.getAllByRole("button", { name: "Find in output" })[0]!); // freeze the tail
    act(() => advance({ text: `${WIZARD_TEXT}\n● advancing…\n`, revision: 2 }));

    await user.click(screen.getByRole("button", { name: /Parser/ }));

    await waitFor(() => expect(mockWizard).toHaveBeenCalledTimes(1));
    expect(mockWizard).toHaveBeenCalledWith(expect.objectContaining({ detectedRevision: 1 }));
  });
});

// The block grammars are provably scoped to Claude Code (spec T8): a non-Claude pane gets the plain
// raw mirror — no prompt-select buttons, no chrome stripping, no re-surfaced status strip — because
// running Claude-tuned matchers on an unverified TUI could mis-lift or mis-strip its output.
describe("AgentChat — block-grammar scoping (Claude-only)", () => {
  // A codex agent sharing the Claude fixture's ids, so only the agent kind differs from the default.
  const codexAgent = { ...fixtureAgents[0]!, agent: "codex" };

  it("does NOT lift a codex tail menu into buttons — it stays raw mirror text", () => {
    renderChat({ text: MENU_TEXT, agent: codexAgent });
    // No native prompt buttons: the Claude prompt-select grammar never runs for codex…
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    // …and the menu row shows verbatim in the raw mirror instead (drivable by the keys pad).
    expect(screen.getByText(/1\. Yes/)).toBeInTheDocument();
  });

  it("re-surfaces the Claude input-box statusline as an app strip above the composer", () => {
    renderChat({ text: STATUS_TEXT }); // default claude agent
    // Two copies since the redesign — the composer's own strip (below `lg`) and the desktop context
    // rail's (context-rail-column.tsx), fed the same `statusLines` value; jsdom renders both
    // regardless of which breakpoint's CSS would actually show it.
    const strips = screen.getAllByText("[Opus 4.8] ~/webapp · main");
    expect(strips).toHaveLength(2);
    for (const strip of strips) expect(strip.closest("pre")).toBeNull(); // app chrome, not mirror text
    expect(screen.queryByText(/❯/)).toBeNull(); // the input box was stripped off the mirror
  });

  it("leaves a codex input-box buffer fully raw — no status strip, box kept in the mirror", () => {
    renderChat({ text: STATUS_TEXT, agent: codexAgent });
    // The statusline is NOT hoisted into an app strip — it stays inside the raw <pre> mirror…
    const status = screen.getByText(/\[Opus 4\.8\] ~\/webapp · main/);
    expect(status.closest("pre")).not.toBeNull();
    // …and the input box itself is preserved verbatim (no chrome stripping for a non-Claude agent).
    expect(screen.getByText(/❯/)).toBeInTheDocument();
  });
});

// Regression (user-reported on mobile): tapping a native prompt/wizard/preview option button popped
// the phone keyboard. Those buttons live INSIDE the terminal-mirror div, whose onClick focuses the
// composer (the "tap the mirror to start typing" affordance) — so an option tap bubbled up and
// focused the input, opening the soft keyboard over the output. focusFromMirror must ignore taps
// that land on an interactive control, while still focusing on a tap of the raw terminal text.
describe("AgentChat — mirror tap must not pop the keyboard on option taps", () => {
  const mockSubmit = vi.mocked(submitPromptOption);
  beforeEach(() => {
    mockSubmit.mockReset();
    mockSubmit.mockResolvedValue({ status: "sent" });
  });

  it("does NOT focus the composer when a native prompt option is tapped", async () => {
    const user = userEvent.setup();
    renderChat({ text: MENU_TEXT });
    const box = screen.getByPlaceholderText(/type a reply/i);
    const yes = await screen.findByRole("button", { name: "Yes" });

    await user.click(yes);
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(box).not.toHaveFocus();
  });

  it("DOES still focus the composer when the raw mirror text is tapped", async () => {
    const user = userEvent.setup();
    renderChat({ text: "recent pane output" });
    const box = screen.getByPlaceholderText(/type a reply/i);

    await user.click(screen.getByText("recent pane output"));
    await waitFor(() => expect(box).toHaveFocus());
  });

  it("focuses during the tap event so mobile browsers can open the software keyboard", () => {
    renderChat({ text: "recent pane output" });
    const box = screen.getByPlaceholderText(/type a reply/i);

    fireEvent.click(screen.getByText("recent pane output"));

    expect(box).toHaveFocus();
  });
});

// Connection copy now lives in the single top ConnectionBanner (mounted in RootLayout), not in the
// header — so the pane header has no pill. What it still owns: the agent StatusBadge, which shows the
// LAST snapshot's status and must stop reading as current during an outage (it dims on any not-live).
//
// Two responsive copies exist since the redesign (the toolbar's, `lg`-only, and the mobile context
// row's, below `lg` — jsdom renders both regardless of the CSS that picks one per breakpoint), fed by
// the SAME `stale` prop — so this asserts they can never disagree, which is a stronger claim than the
// single-badge version had.
describe("AgentChat — shared header: stale-status dimming", () => {
  beforeEach(() => __resetConnectionHealth());

  it("dims the agent StatusBadge while the connection is not live and restores it on recovery", () => {
    // fixtureAgents[0] is a blocked claude agent → StatusBadge reads "needs you".
    let setError: (e: boolean) => void = () => {};
    function Harness() {
      const [error, setErr] = useState(true);
      setError = setErr;
      const agent = fixtureAgents[0]!;
      return (
        <AgentChat
          paneId={agent.paneId}
          agent={agent}
          agents={fixtureAgents}
          shellPanes={[]}
          tabs={[]}
          text="out"
          error={error}
          onBack={vi.fn()}
          onSelect={vi.fn()}
        />
      );
    }
    const router = createMemoryRouter([{ path: "/", element: <Harness /> }]);
    render(<RouterProvider router={router} />);

    const badges = screen.getAllByText("needs you");
    expect(badges).toHaveLength(2);
    for (const badge of badges) expect(badge).toHaveClass("opacity-40"); // not live → frozen, dimmed
    act(() => setError(false)); // snapshot recovers → live
    for (const badge of badges) expect(badge).not.toHaveClass("opacity-40"); // undimmed instantly
  });
});

// The History affordance opens the agent's own transcript — the only real scrollback a Claude pane
// has, because its terminal runs on the alternate screen and Herdr retains nothing behind the
// viewport. It's gated on the pane actually reporting an agent session, so the button can never
// lead to an empty screen.
describe("AgentChat — history affordance", () => {
  it("is offered when the pane reports an agent session id", () => {
    const agent = { ...fixtureAgents[0]!, agentSessionId: "d7e62e23-8576-4c63-98ba-ec1b02902c6b" };
    renderChat({ agent, agents: [agent] });
    expect(screen.getByRole("button", { name: /conversation history/i })).toBeInTheDocument();
  });

  // Deliberately NOT gated on `agentSessionId` any more: herdr only reports it once the optional
  // integration hook is planted, and the bridge resolves the transcript from the pane's process
  // otherwise — the same route the context gauge has always used.
  it("is offered for an agent pane with no session id (the default install)", () => {
    renderChat(); // fixture agents carry no agentSessionId
    expect(screen.getByRole("button", { name: /conversation history/i })).toBeInTheDocument();
  });

  it("is hidden on a bare shell, which has no agent and therefore no transcript", () => {
    const shell = { ...fixtureAgents[0]!, kind: "shell" as const };
    renderChat({ agent: shell, agents: [shell] });
    expect(screen.queryByRole("button", { name: /conversation history/i })).not.toBeInTheDocument();
  });

  // Deliberate placement, not an accident of slot order: the status pill stays the rightmost thing on
  // the pane screen (it's what you glance at), so History sits to its LEFT — in the toolbar's own
  // (desktop, `lg`-only) cluster, which is the pair this test exercises; the mobile context row is a
  // separate DOM section entirely and has no History button to be ordered against.
  //
  // (The top-of-mirror affordance is covered separately below.)
  it("sits to the LEFT of the status pill", () => {
    const agent = { ...fixtureAgents[0]!, agentSessionId: "d7e62e23-8576-4c63-98ba-ec1b02902c6b" };
    renderChat({ agent, agents: [agent] });
    const history = screen.getByRole("button", { name: /conversation history/i });
    // fixtureAgents[0] is blocked → "needs you"; index 0 is the toolbar's own copy (DOM-first).
    const pill = screen.getAllByText("needs you")[0]!;
    // Node.compareDocumentPosition: FOLLOWING (4) means the pill comes after History in the DOM.
    expect(history.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// Terminal ⇄ Reading: two modes of ONE screen. The mirror is the mode you pilot in (native dialog
// buttons, key grammars, statusline); reading renders the agent's own transcript, which was never cut
// to a terminal's columns. The state is a display pref, so it's per device and survives a reload.
describe("AgentChat — terminal / reading toggle", () => {
  // An agent pane, integration or not — the bridge finds the transcript either way.
  const withTranscript = () => fixtureAgents[0]!;
  beforeEach(() => localStorage.clear());

  it("is hidden on a bare shell, which has no transcript to read", () => {
    const shell = { ...fixtureAgents[0]!, kind: "shell" as const };
    renderChat({ agent: shell, agents: [shell] });
    expect(screen.queryByRole("group", { name: /view mode/i })).not.toBeInTheDocument();
  });

  it("opens on Terminal and swaps the mirror for the transcript on Reading", async () => {
    const user = userEvent.setup();
    const agent = withTranscript();
    renderChat({ agent, agents: [agent], text: "recent pane output" });

    expect(screen.getByText(/recent pane output/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reading view/i }));

    // The transcript (MSW's default history fixture) replaces the mirror; the composer stays.
    expect(await screen.findByText("One commit: abc1234.")).toBeInTheDocument();
    expect(screen.queryByText(/recent pane output/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/type a reply/i)).toBeInTheDocument();
  });

  it("persists the mode per device, so a remount comes back reading", async () => {
    const user = userEvent.setup();
    const agent = withTranscript();
    renderChat({ agent, agents: [agent] });
    await user.click(screen.getByRole("button", { name: /reading view/i }));
    await screen.findByText("One commit: abc1234.");

    cleanup();
    renderChat({ agent, agents: [agent] });
    expect(await screen.findByText("One commit: abc1234.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reading view/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("returns to an untouched terminal mode — find, mirror and all", async () => {
    const user = userEvent.setup();
    const agent = withTranscript();
    renderChat({ agent, agents: [agent], text: "recent pane output" });

    await user.click(screen.getByRole("button", { name: /reading view/i }));
    // Find searches the mirror's buffer, so it belongs to terminal mode only.
    expect(screen.queryByRole("button", { name: /find in output/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /terminal view/i }));
    expect(screen.getByText(/recent pane output/)).toBeInTheDocument();
    // Two copies since the redesign (the mobile header's and the desktop toolbar's — jsdom renders
    // both regardless of which breakpoint's CSS would show it).
    expect(screen.getAllByRole("button", { name: /find in output/i })).toHaveLength(2);
  });
});

describe("AgentChat — pane-switcher handle", () => {
  it("is hidden when this is the only pane", () => {
    renderChat({ agents: [fixtureAgents[0]!], shellPanes: [] });
    expect(screen.queryByRole("button", { name: /switch pane/i })).not.toBeInTheDocument();
  });

  it("is offered once a second pane exists", () => {
    renderChat({ agents: [fixtureAgents[0]!, fixtureAgents[1]!], shellPanes: [] });
    expect(screen.getByRole("button", { name: /switch pane/i })).toBeInTheDocument();
  });
});

// The top-of-mirror affordance. This block previously rendered on NO pane at all: it was gated on
// `truncated`, which Herdr never sets true even when a read demonstrably cut scrollback off. The
// working signal is `readableLines` (scrollback depth + viewport), and which button appears is
// decided by what the pane can actually offer — the two are never simultaneously possible.
describe("AgentChat — top-of-mirror history affordance", () => {
  const SESSION_ID = "d7e62e23-8576-4c63-98ba-ec1b02902c6b";
  const showHistory = () => screen.queryByRole("button", { name: /show entire history/i });
  const loadOlder = () => screen.queryByRole("button", { name: /load older/i });

  it("an agent pane with a transcript offers the full history, not scrollback paging", () => {
    // A Claude pane: alt-screen, so readableLines is just its viewport — there IS no scrollback.
    const agent = { ...fixtureAgents[0]!, agentSessionId: SESSION_ID, readableLines: 51 };
    renderChat({ agent, agents: [agent], requestedLines: 600 });
    expect(showHistory()).toBeInTheDocument();
    expect(loadOlder()).not.toBeInTheDocument();
  });

  it("a pane with real scrollback and no transcript offers Load older", () => {
    // A shell on the primary screen: 6895 lines of ring + 51 viewport, and we've only asked for 600.
    const agent = { ...fixtureAgents[0]!, kind: "shell" as const, readableLines: 6946 };
    renderChat({ agent, agents: [agent], requestedLines: 600 });
    expect(loadOlder()).toBeInTheDocument();
    expect(showHistory()).not.toBeInTheDocument();
  });

  it("offers nothing when the pane has neither", () => {
    const agent = { ...fixtureAgents[0]!, kind: "shell" as const, readableLines: 51 };
    renderChat({ agent, agents: [agent], requestedLines: 600 });
    expect(loadOlder()).not.toBeInTheDocument();
    expect(showHistory()).not.toBeInTheDocument();
  });

  it("hides Load older once the window already covers everything Herdr can return", () => {
    const agent = { ...fixtureAgents[0]!, kind: "shell" as const, readableLines: 700 };
    renderChat({ agent, agents: [agent], requestedLines: 1000 }); // at the cap, past the content
    expect(loadOlder()).not.toBeInTheDocument();
  });

  it("stays hidden when readableLines is unknown (older bridge) rather than offering a dud tap", () => {
    const agent = { ...fixtureAgents[0]!, kind: "shell" as const }; // no readableLines
    renderChat({ agent, agents: [agent], requestedLines: 600 });
    expect(loadOlder()).not.toBeInTheDocument();
    expect(showHistory()).not.toBeInTheDocument();
  });

  it("a transcript wins even when the pane also reports scrollback", () => {
    const agent = { ...fixtureAgents[0]!, agentSessionId: SESSION_ID, readableLines: 6946 };
    renderChat({ agent, agents: [agent], requestedLines: 600 });
    expect(showHistory()).toBeInTheDocument();
    expect(loadOlder()).not.toBeInTheDocument();
  });
});
