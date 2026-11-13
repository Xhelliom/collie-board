import { useState, type ComponentProps } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { closeLightbox } from "@/lib/lightbox";
import { ImageLightboxHost } from "@/components/image-lightbox";
import { submitPromptOption } from "@/lib/prompt-action";
import { submitWizardKeys } from "@/lib/wizard-action";
import { fixtureAgents } from "@/test/handlers";
import { AgentChat } from "./agent-chat";
import { Toaster } from "@/components/ui/sonner";

// The detail view's core job: type a reply and submit it to the bridge. This drives the whole wired
// path (composer → api.sendReply → MSW → optimistic clear / error surfacing) end-to-end, which no
// other test covers. AgentChat uses useRevalidator, so it needs a data router (createMemoryRouter).

beforeAll(() => {
  // jsdom doesn't implement scrollTo; the terminal mirror's auto-scroll calls it.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});
beforeEach(() => {
  clearStatus();
  // Reading is the default view; most of these tests pilot the terminal mirror.
  localStorage.setItem("collie:display-prefs:v3", JSON.stringify({ readingPick: false }));
});

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
  // The status line is root.tsx's, not the pane's — mounted beside it here the way root does.
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
  return props;
}

describe("AgentChat — reply flow", () => {
  it("sends a typed reply and clears the composer on success", async () => {
    const user = userEvent.setup();
    renderChat();
    const box = screen.getByPlaceholderText(/^reply to/i);

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
    const box = screen.getByPlaceholderText(/^reply to/i);

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

// « ⋯ » opens the same sheet at both widths; jsdom renders both headers, so the first copy will do.
async function openMore(user = userEvent.setup()) {
  await user.click(screen.getAllByRole("button", { name: "More" })[0]!);
  return user;
}

describe("AgentChat — header", () => {
  it("names the agent with its state, then its project and model — no pane id, no breadcrumb", () => {
    renderChat({ agent: { ...fixtureAgents[0]!, model: "Opus 5.5", effort: "high", ctxPct: 26 } });
    const banner = within(screen.getByRole("banner")); // the phone's
    expect(banner.getByText("claude")).toBeInTheDocument();
    expect(banner.getByText("waiting for you")).toBeInTheDocument();
    expect(banner.getByText("webapp")).toBeInTheDocument();
    expect(banner.getByText("Opus 5.5, high")).toBeInTheDocument();
    expect(banner.getByText("context 26%")).toBeInTheDocument();
    expect(screen.queryByText("w1:p1")).toBeNull();
    expect(screen.queryByText("~/webapp")).toBeNull();
  });

  it("backs out to the agents list", async () => {
    const props = renderChat();
    await userEvent.click(screen.getByRole("button", { name: "Back to the agents" }));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("opens the space overview from « ⋯ »", async () => {
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

    const user = await openMore();
    await user.click(await screen.findByRole("button", { name: /open webapp overview/i }));
    expect(await screen.findByText("overview:w1")).toBeInTheDocument();
  });
});

// The card a session backs: a row of « ⋯ », at both widths.
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

  it("names the card and opens it", async () => {
    renderWithCard({ ...fixtureAgents[0]!, cardId: "c-42", cardTitle: "Ship the thing" });
    const user = await openMore();
    await user.click(await screen.findByRole("button", { name: "Open card: Ship the thing" }));
    expect(await screen.findByText("card:c-42")).toBeInTheDocument();
  });

  it("shows no row at all when the pane backs no card", async () => {
    renderWithCard(fixtureAgents[0]!); // hand-launched: no cardId
    await openMore();
    expect(screen.queryByRole("button", { name: /open card/i })).toBeNull();
  });
});

// Echoes the card the pane row navigated to.
function CardSentinel() {
  const { cardId } = useParams();
  return <div>card:{cardId ?? "none"}</div>;
}

describe("AgentChat — subagents in flight", () => {
  // Named in the header (desktop) and on a line under it (phone), outside the terminal/reading switch.
  it.each([
    ["terminal", false],
    ["reading", true],
  ])("shows the running subagents in the %s view", (_view, readingPick) => {
    localStorage.setItem("collie:display-prefs:v3", JSON.stringify({ readingPick }));
    renderChat({ agent: { ...fixtureAgents[0]!, subagents: ["Relecture", "Inventaire"] } });
    expect(screen.getAllByText(/2 subagents running/)).toHaveLength(2);
    expect(screen.getAllByText(/Relecture · Inventaire/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: readingPick ? "Switch to Terminal" : "Switch to Reading" })).toBeInTheDocument();
  });

  it("shows nothing once they are done", () => {
    renderChat();
    expect(screen.queryByText(/subagents? running/)).toBeNull();
  });
});

describe("AgentChat — tasks and background commands", () => {
  it.each([
    ["terminal", false],
    ["reading", true],
  ])("counts them in the %s view and opens the list on tap", async (_view, readingPick) => {
    localStorage.setItem("collie:display-prefs:v3", JSON.stringify({ readingPick }));
    renderChat({
      agent: {
        ...fixtureAgents[0]!,
        tasks: [
          { text: "Lire le code", status: "completed" },
          { text: "Écrire le parseur", status: "in_progress" },
          { text: "Tester", status: "pending" },
        ],
        background: ["Serveur de dev"],
      },
    });
    await userEvent.click(screen.getByRole("button", { name: /1\/3 tasks.*1 command running/ }));
    expect(await screen.findByText("Écrire le parseur")).toBeInTheDocument();
    expect(screen.getByLabelText("In progress")).toBeInTheDocument();
    expect(screen.getByLabelText("Done")).toBeInTheDocument();
    expect(screen.getByText("Serveur de dev")).toBeInTheDocument();
  });

  it("shows no mark when the agent has neither", () => {
    renderChat();
    expect(screen.queryByText(/tasks?$|commands? running/)).toBeNull();
  });
});

describe("AgentChat — read-only device", () => {
  it("disables the composer and shows the banner when the device isn't authorised", () => {
    renderChat({ device: { enforced: true, device: "spare-phone", authorized: false } });

    // The banner names the read-only state (and the device id), and the composer is locked.
    expect(screen.getByText("Read-only")).toBeInTheDocument();
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
    expect(screen.getByPlaceholderText(/^reply to/i)).not.toBeDisabled();
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
      JSON.stringify({ wrap: true, fontSize: 11, rawTerminal: true, readingPick: false }),
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
      JSON.stringify({ wrap: true, fontSize: 11, rawTerminal: true, readingPick: false }),
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
    await openMore(user);
    await user.click(await screen.findByRole("button", { name: "Find in output" }));

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

    await openMore(user);
    await user.click(await screen.findByRole("button", { name: "Find in output" })); // freeze the tail
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

  it("re-surfaces the Claude input-box statusline at the head of « ⋯ »", async () => {
    renderChat({ text: STATUS_TEXT }); // default claude agent
    expect(screen.queryByText("[Opus 4.8] ~/webapp · main")).toBeNull(); // not in the mirror, not on screen
    expect(screen.queryByText(/❯/)).toBeNull(); // the input box was stripped off the mirror
    await openMore();
    const line = await screen.findByText("[Opus 4.8] ~/webapp · main");
    expect(line.closest("pre")).toBeNull(); // app chrome, not mirror text
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
    const box = screen.getByPlaceholderText(/^reply to/i);
    const yes = await screen.findByRole("button", { name: "Yes" });

    await user.click(yes);
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(box).not.toHaveFocus();
  });

  it("DOES still focus the composer when the raw mirror text is tapped", async () => {
    const user = userEvent.setup();
    renderChat({ text: "recent pane output" });
    const box = screen.getByPlaceholderText(/^reply to/i);

    await user.click(screen.getByText("recent pane output"));
    await waitFor(() => expect(box).toHaveFocus());
  });

  it("focuses during the tap event so mobile browsers can open the software keyboard", () => {
    renderChat({ text: "recent pane output" });
    const box = screen.getByPlaceholderText(/^reply to/i);

    fireEvent.click(screen.getByText("recent pane output"));

    expect(box).toHaveFocus();
  });
});

// The header's state (« t'attend depuis… ») is the LAST snapshot's: it dims while the connection isn't
// live. Two copies (phone header, desktop toolbar — jsdom renders both), fed the same `stale`.
describe("AgentChat — shared header: stale-status dimming", () => {
  beforeEach(() => __resetConnectionHealth());

  it("dims the agent's state while the connection is not live and restores it on recovery", () => {
    // fixtureAgents[0] is a blocked claude agent → « waiting for you ».
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

    // The pane column lists this agent too, in its own words: only the headers' copies count here.
    const states = screen.getAllByText("waiting for you").filter((el) => !el.closest("nav"));
    expect(states).toHaveLength(2);
    for (const state of states) expect(state).toHaveClass("opacity-50"); // not live → frozen, dimmed
    act(() => setError(false)); // snapshot recovers → live
    for (const state of states) expect(state).not.toHaveClass("opacity-50"); // undimmed instantly
  });
});

// The History affordance opens the agent's own transcript — the only real scrollback a Claude pane
// has, because its terminal runs on the alternate screen and Herdr retains nothing behind the
// viewport. It's gated on the pane actually reporting an agent session, so the button can never
// lead to an empty screen.
describe("AgentChat — history affordance", () => {
  it("is offered in « ⋯ » when the pane reports an agent session id", async () => {
    const agent = { ...fixtureAgents[0]!, agentSessionId: "d7e62e23-8576-4c63-98ba-ec1b02902c6b" };
    renderChat({ agent, agents: [agent] });
    await openMore();
    expect(await screen.findByRole("button", { name: "History" })).toBeInTheDocument();
  });

  // Deliberately NOT gated on `agentSessionId` any more: herdr only reports it once the optional
  // integration hook is planted, and the bridge resolves the transcript from the pane's process
  // otherwise — the same route the context gauge has always used.
  it("is offered for an agent pane with no session id (the default install)", async () => {
    renderChat(); // fixture agents carry no agentSessionId
    await openMore();
    expect(await screen.findByRole("button", { name: "History" })).toBeInTheDocument();
  });

  it("is hidden on a bare shell, which has no agent and therefore no transcript", async () => {
    const shell = { ...fixtureAgents[0]!, kind: "shell" as const };
    renderChat({ agent: shell, agents: [shell] });
    await openMore();
    expect(screen.queryByRole("button", { name: "History" })).not.toBeInTheDocument();
  });
});

// Terminal ⇄ Reading: two modes of ONE screen. The mirror is the mode you pilot in (native dialog
// buttons, key grammars, statusline); reading renders the agent's own transcript, which was never cut
// to a terminal's columns. The state is a display pref, so it's per device and survives a reload.
describe("AgentChat — terminal / reading toggle", () => {
  // An agent pane, integration or not — the bridge finds the transcript either way.
  // Working, not the fixture's `blocked`: a blocked agent (or an idle one with no input box on
  // screen) adds the terminal-screen banner to reading mode.
  const withTranscript = () => ({ ...fixtureAgents[0]!, status: "working" as const });
  beforeEach(() => localStorage.clear());

  it("is hidden on a bare shell, which has no transcript to read", () => {
    const shell = { ...fixtureAgents[0]!, kind: "shell" as const };
    renderChat({ agent: shell, agents: [shell] });
    expect(screen.queryByRole("button", { name: /^switch to/i })).not.toBeInTheDocument();
  });

  it("opens on Reading by default and swaps to the terminal mirror on Terminal, remembering it", async () => {
    const user = userEvent.setup();
    const agent = withTranscript();
    renderChat({ agent, agents: [agent], text: "recent pane output" });

    // The transcript (MSW's default history fixture) is the default view; the composer stays.
    expect(await screen.findByText("One commit: abc1234.")).toBeInTheDocument();
    expect(screen.queryByText(/recent pane output/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/^reply to/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Switch to Terminal" }));
    expect(screen.getByText(/recent pane output/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("collie:display-prefs:v3")!).readingPick).toBe(false);
  });


  it("falls back to the terminal when the agent has no readable transcript, keeping the pref", async () => {
    server.use(
      http.get(/\/api\/pane\/[^/]+\/history/, () =>
        HttpResponse.json({ available: false, reason: "unsupported" }),
      ),
    );
    const agent = withTranscript();
    renderChat({ agent, agents: [agent], text: "recent pane output" });

    expect(await screen.findByText(/recent pane output/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to Reading" })).toBeInTheDocument();
    // Never written back: the choice is the user's, not this pane's.
    const stored = localStorage.getItem("collie:display-prefs:v3");
    expect(stored === null || JSON.parse(stored).readingPick !== false).toBe(true);
  });

  it("lets the More sheet leave the terminal fallback for Reading", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(/\/api\/pane\/[^/]+\/history/, () =>
        HttpResponse.json({ available: false, reason: "unsupported" }),
      ),
    );
    const agent = withTranscript();
    renderChat({ agent, agents: [agent], text: "recent pane output" });
    await screen.findByText(/recent pane output/);

    server.resetHandlers();
    await user.click(screen.getAllByRole("button", { name: "More" })[0]!);
    await user.click(await screen.findByText("Switch to Reading"));
    expect(await screen.findByText("One commit: abc1234.")).toBeInTheDocument();
  });

  it("persists the mode per device, so a remount comes back reading", async () => {
    const user = userEvent.setup();
    const agent = withTranscript();
    renderChat({ agent, agents: [agent] });
    await user.click(screen.getByRole("button", { name: "Switch to Terminal" }));
    await user.click(screen.getByRole("button", { name: "Switch to Reading" }));
    await screen.findByText("One commit: abc1234.");

    cleanup();
    renderChat({ agent, agents: [agent] });
    expect(await screen.findByText("One commit: abc1234.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to Terminal" })).toBeInTheDocument();
  });

  it("returns to an untouched terminal mode — find, mirror and all", async () => {
    const user = userEvent.setup();
    const agent = withTranscript();
    renderChat({ agent, agents: [agent], text: "recent pane output" });

    await user.click(screen.getByRole("button", { name: "Switch to Terminal" }));
    expect(screen.getByText(/recent pane output/)).toBeInTheDocument();
    // Find searches the mirror's buffer, so it belongs to terminal mode only.
    await openMore(user);
    expect(await screen.findByRole("button", { name: /find in output/i })).toBeInTheDocument();
  });
});

// The trigger is a labelled button in the composer's action row, not the grab handle that used to
// sit in a band of its own above the composer (a handle affords dragging, and that band cost the
// mirror ~34px permanently). The sheet it opens is unchanged.
describe("AgentChat — pane-switcher button", () => {
  const trigger = () => screen.queryByRole("button", { name: /switch pane/i });

  it("is hidden when this is the only pane", () => {
    renderChat({ agents: [fixtureAgents[0]!], shellPanes: [] });
    expect(trigger()).not.toBeInTheDocument();
  });

  it("opens the switcher sheet on a plain tap once a second pane exists", async () => {
    const user = userEvent.setup();
    renderChat({ agents: [fixtureAgents[0]!, fixtureAgents[1]!], shellPanes: [] });
    await user.click(trigger()!);
    expect(await screen.findByRole("dialog", { name: /switch pane/i })).toBeInTheDocument();
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

// The pane screen doesn't hold a transcript (the mirror is a terminal snapshot), so "Images" fetches
// one on demand — an explicit tap, never a poll. What matters is that it reaches the viewer with the
// session's images, and that an empty session says so instead of opening on nothing.
describe("AgentChat — session images", () => {
  const IMG = "/tmp/claude-1/p/s/scratchpad/render.png";
  // The viewer's host lives in App, beside the router — so it has to be mounted here too, or
  // "no dialog appeared" would pass for the wrong reason.
  const renderChatWithViewer = (...args: Parameters<typeof renderChat>) => {
    const r = renderChat(...args);
    render(<ImageLightboxHost />);
    return r;
  };
  afterEach(() => closeLightbox());

  const historyReturning = (entries: unknown[]) =>
    http.get("/api/pane/:paneId/history", () =>
      HttpResponse.json({
        paneId: "w1:p1",
        available: true,
        entries,
        hasMore: false,
        total: entries.length,
        fileTruncated: false,
        queued: [],
      }),
    );

  const imageTurn = {
    uuid: "t1",
    ts: "2026-08-09T10:00:00Z",
    role: "assistant",
    parts: [{ kind: "tool", name: "Read", summary: IMG, image: IMG }],
  };

  it("opens the viewer over the session's images", async () => {
    server.use(historyReturning([imageTurn]));
    renderChatWithViewer();
    await userEvent.click(screen.getAllByRole("button", { name: "More" })[0]!);
    await userEvent.click(await screen.findByText("Images"));
    expect(await screen.findByRole("dialog", { name: "Image viewer" })).toBeInTheDocument();
    expect(screen.getByAltText("render.png")).toBeInTheDocument();
  });

  it("says so when the session produced none, rather than opening an empty viewer", async () => {
    server.use(historyReturning([{ ...imageTurn, parts: [{ kind: "text", text: "no pictures" }] }]));
    renderChatWithViewer();
    await userEvent.click(screen.getAllByRole("button", { name: "More" })[0]!);
    await userEvent.click(await screen.findByText("Images"));
    expect(await screen.findByText("No images in this session")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Image viewer" })).not.toBeInTheDocument();
  });

  it("is hidden on a bare shell, which has no transcript to read images from", async () => {
    const shell = { ...fixtureAgents[0]!, kind: "shell" as const };
    renderChat({ agent: shell, agents: [shell] });
    await userEvent.click(screen.getAllByRole("button", { name: "More" })[0]!);
    expect(screen.queryByText("Images")).not.toBeInTheDocument();
  });
});

// The worktree-artifacts affordance: the reader is confined to the CARD's worktree, so the button
// only exists on a card-backed pane — a hand-launched agent has no root to read from.
describe("AgentChat — session artifacts affordance", () => {
  const cardAgent = { ...fixtureAgents[0]!, cardId: "c1" as const };

  it("stays hidden on a hand-launched pane, which has no card worktree", async () => {
    renderChat(); // fixtureAgents[0] has no cardId
    await openMore();
    expect(screen.queryByText("Artifacts")).not.toBeInTheDocument();
  });

  it("lives in the '⋯' sheet, next to History and Images", async () => {
    const user = userEvent.setup();
    renderChat({ agent: cardAgent, agents: [cardAgent] });
    await user.click(screen.getAllByRole("button", { name: "More" })[0]!);
    expect(await screen.findByText("Artifacts")).toBeInTheDocument();
  });
});

// A screen the transcript never shows (folder trust, repo MCP…): reading mode must not be blind to it.
describe("AgentChat — reading mode, an agent blocked on a terminal screen", () => {
  beforeEach(() => localStorage.clear()); // Reading is the default view
  const blocked = () => ({ ...fixtureAgents[0]!, status: "blocked" as const });
  const fixture = (name: string) =>
    readFileSync(join(import.meta.dirname, "..", "fixtures", "panes", name), "utf8");

  it("shows the screen's tail as text and answers it with a key, without leaving reading mode", async () => {
    let sent: unknown = null;
    server.use(
      http.post(/\/api\/pane\/[^/]+\/keys$/, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const user = userEvent.setup();
    const agent = blocked();
    renderChat({ agent, agents: [agent], text: "Pick one\n<img src=x onerror=alert(1)>\n Enter to go" });

    const banner = await screen.findByRole("region", { name: /waiting for an answer in the terminal/i });
    expect(within(banner).getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(banner.querySelector("img")).toBeNull();
    await user.click(within(banner).getByRole("button", { name: "Send Enter" }));
    await waitFor(() => expect(sent).toMatchObject({ keys: ["Enter"] }));
    expect(screen.getByRole("button", { name: "Switch to Terminal" })).toBeInTheDocument();

    await user.click(within(banner).getByRole("button", { name: /show terminal/i }));
    expect(screen.getByRole("button", { name: "Switch to Reading" })).toBeInTheDocument();
  });

  it("a recognised first-run screen gets its named choices instead (repo MCP approval)", async () => {
    const agent = blocked();
    renderChat({ agent, agents: [agent], text: fixture("claude--v2318-mcp-server.txt") });
    expect(await screen.findByRole("button", { name: /continue without using this mcp server/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /waiting for an answer/i })).not.toBeInTheDocument();
  });

  it("also shows for an idle agent held by a screen with no input box (the MCP checklist herdr calls idle)", async () => {
    const agent = { ...fixtureAgents[0]!, status: "idle" as const };
    renderChat({ agent, agents: [agent], text: fixture("claude--v2318-mcp-checklist.txt") });
    const banner = await screen.findByRole("region", { name: /waiting for an answer in the terminal/i });
    expect(within(banner).getByText(/Enable selected/)).toBeInTheDocument();
  });

  it("not for an idle agent at its own input box", async () => {
    const agent = { ...fixtureAgents[0]!, status: "idle" as const };
    renderChat({ agent, agents: [agent], text: fixture("claude--fresh-idle.txt") });
    await screen.findByText("One commit: abc1234.");
    expect(screen.queryByRole("region", { name: /waiting for an answer/i })).not.toBeInTheDocument();
  });

  it("is gone once the agent is working again", async () => {
    const agent = { ...fixtureAgents[0]!, status: "working" as const };
    renderChat({ agent, agents: [agent], text: "Pick one\n Enter to go" });
    await screen.findByText("One commit: abc1234.");
    expect(screen.queryByRole("region", { name: /waiting for an answer/i })).not.toBeInTheDocument();
  });
});
