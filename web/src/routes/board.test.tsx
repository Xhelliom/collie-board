import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BoardRoute } from "./board";
import type { ProjectData } from "@/lib/board-loaders";
import type { CardStatus, CardView, Phase } from "@/lib/board";

// The board's desktop drag, end to end — and above all the ONE thing about it that no amount of
// reading the component tells you: a drag dies if the card it started on loses its layout box while
// the browser is still getting the gesture off the ground. Taking the card "in hand" is exactly what
// takes that box away (the source tile goes `hidden` so the ghost can stand in for it), so the board
// waits a frame before it does. Do it in the dragstart tick and Chrome answers `dragend` on the spot:
// no dragover, no drop, no move. That is a real regression this file exists to keep out.
//
// jsdom has no native drag, so the frame is what's asserted rather than the cancellation itself —
// the events are ours to fire either way, and the invariant ("the source keeps its box this tick")
// is the part that has to hold.

const patchCard = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const createRun = vi.hoisted(() => vi.fn(async () => ({ run: { id: "r1" }, cardIds: [] as string[] })));
vi.mock("@/lib/board", async (orig) => ({
  ...(await orig<typeof import("@/lib/board")>()),
  patchCard,
  createRun,
  fetchBoardPrefs: async () => ({ autoFollowUps: false, followUpCategories: [], maxAgents: 3, autoHandoff: false }),
  // The remembered repo scope would otherwise navigate the board out from under the test.
  loadRepoScope: () => null,
  saveRepoScope: () => {},
}));

function card(id: string, status: CardStatus, position: number): CardView {
  return {
    id,
    title: id,
    spec: null,
    rawInput: null,
    acceptance: [],
    status,
    repoPath: null,
    baseRef: null,
    branch: null,
    workspaceId: null,
    agentKind: null,
    parentId: null,
    duplicateOf: null,
    dependsOn: null,
    origin: null,
    originCardId: null,
    category: null,
    tag: null,
    position,
    createdAt: 0,
    updatedAt: 0,
    session: null,
    runtime: null,
    sessionCount: 0,
    copilotBusy: false,
    wrapupPending: false,
    keepWorktree: false,
    autoHandoff: null,
  };
}

/** `lg` and up, or below it — the board reads the same query for its drag as Tailwind does for the grid. */
function viewport(wide: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: wide,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// jsdom gives a DragEvent no dataTransfer, and the tile writes to it on dragstart.
const dataTransfer = () => ({ setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "", dropEffect: "" });

async function mount(cards: CardView[], url = "/board", phases: Phase[] = []) {
  const router = createMemoryRouter(
    [
      {
        path: "/board",
        loader: (): ProjectData => ({ cards, phases, lots: [], roadmap: null, error: false, authError: false }),
        element: <BoardRoute />,
      },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Board", level: 1 });
}

/** Two cards, one per manual column of the "To do" lane — the smallest board a drag can happen on. */
const two = [card("Alpha", "backlog", 0), card("Bravo", "ready", 0)];

const tileOf = (title: string) => screen.getByText(title).closest("button") as HTMLElement;
const columnOf = (title: string) => screen.getByText(title).closest("section") as HTMLElement;
/** The columns the board says a card in hand may land in — the dashed outline is that statement. */
const armedColumns = () =>
  [...document.querySelectorAll("main section")].filter((s) => s.className.includes("outline-dashed"));

/** Pick a card up the way a mouse does, then let the frame the board waits for pass. */
function lift(tile: HTMLElement) {
  act(() => {
    fireEvent.dragStart(tile, { dataTransfer: dataTransfer() });
  });
}
const nextFrame = () => act(() => void vi.advanceTimersToNextFrame());

beforeEach(() => {
  patchCard.mockClear();
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  viewport(true);
});
afterEach(() => vi.useRealTimers());

describe("board drag and drop — desktop", () => {
  it("leaves the dragged tile in the layout for the frame the drag starts in", async () => {
    await mount(two);
    const tile = tileOf("Alpha");
    lift(tile);
    // THE regression: hiding the source here is what makes Chrome cancel the drag outright.
    expect(tile.parentElement).not.toHaveClass("hidden");
    expect(armedColumns()).toHaveLength(0);

    // A frame later the board takes the card in hand — by then the gesture is under way and safe.
    nextFrame();
    expect(tile.parentElement).toHaveClass("hidden");
    expect(armedColumns().length).toBeGreaterThan(0);
  });

  it("moves a card to another column, and its status follows the drop", async () => {
    await mount(two);
    lift(tileOf("Alpha"));
    nextFrame();
    const target = columnOf("Bravo");
    act(() => void fireEvent.dragOver(target, { dataTransfer: dataTransfer() }));
    act(() => void fireEvent.drop(target, { dataTransfer: dataTransfer() }));
    expect(patchCard).toHaveBeenCalledWith("Alpha", expect.objectContaining({ status: "ready" }));
  });

  it("reorders a card inside its own column, writing position and nothing else", async () => {
    await mount([card("Alpha", "backlog", 0), card("Bravo", "backlog", 1), card("Charlie", "backlog", 2)]);
    lift(tileOf("Alpha"));
    nextFrame();
    // Over the BOTTOM half of the last tile — which half of a tile the pointer is on is the whole
    // difference between "somewhere in this column" and an actual slot. (jsdom measures every box as
    // 0×0 at the origin, so any non-negative clientY reads as the lower half.)
    const last = tileOf("Charlie").parentElement as HTMLElement;
    act(() => void fireEvent.dragOver(last, { dataTransfer: dataTransfer(), clientY: 10 }));
    act(() => void fireEvent.drop(columnOf("Charlie"), { dataTransfer: dataTransfer() }));
    expect(patchCard).toHaveBeenCalledWith("Alpha", { position: 3 });
  });

  it("arms nothing when the gesture dies before that frame", async () => {
    await mount(two);
    const tile = tileOf("Alpha");
    lift(tile);
    act(() => {
      fireEvent.dragEnd(tile);
      vi.advanceTimersToNextFrame();
    });
    // The cancelled frame must not dress the board for a drag that is already over.
    expect(armedColumns()).toHaveLength(0);
    expect(tile.parentElement).not.toHaveClass("hidden");
  });
});

describe("board drag and drop — phone", () => {
  it("offers no drag at all", async () => {
    viewport(false);
    await mount(two);
    expect(tileOf("Alpha")).not.toHaveAttribute("draggable");
  });
});

describe("choosing a run's set (ADR 0017)", () => {
  const inRepo = (id: string, status: CardStatus, repoPath: string, extra: Partial<CardView> = {}) => ({
    ...card(id, status, 0),
    repoPath,
    ...extra,
  });
  const board = [
    inRepo("Alpha", "backlog", "/repo"),
    inRepo("Bravo", "ready", "/repo", { dependsOn: "Alpha" }),
    inRepo("Working", "working", "/repo"),
    inRepo("Taken", "backlog", "/repo", { runId: "older" }),
    inRepo("Elsewhere", "backlog", "/other"),
  ];

  it("offers no selection without a repo scope — a run is one repo's", async () => {
    await mount(board);
    expect(screen.queryByRole("button", { name: /select/i })).toBeNull();
  });

  it("selects only the scoped repo's startable cards, and records exactly those", async () => {
    viewport(false);
    await mount(board, "/board?repo=/repo");
    // The scope is what bounds the set: another repo's card is not even on screen.
    expect(screen.queryByText("Elsewhere")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /select/i }));

    fireEvent.click(tileOf("Alpha"));
    fireEvent.click(tileOf("Bravo"));
    fireEvent.click(tileOf("Working"));
    fireEvent.click(tileOf("Taken"));
    expect(tileOf("Alpha")).toHaveAttribute("aria-pressed", "true");
    expect(tileOf("Bravo")).toHaveAttribute("aria-pressed", "true");
    // Started, or already in a run: not a member to offer.
    expect(tileOf("Working")).not.toHaveAttribute("aria-pressed");
    expect(tileOf("Taken")).not.toHaveAttribute("aria-pressed");

    fireEvent.click(tileOf("Bravo"));
    expect(tileOf("Bravo")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(tileOf("Bravo"));

    fireEvent.click(screen.getByRole("button", { name: "Run 2 cards" }));
    fireEvent.click(await screen.findByRole("button", { name: "Lancer le run" }));
    await act(async () => {});
    expect(createRun).toHaveBeenCalledWith({ cardIds: ["Alpha", "Bravo"], foldInCap: 2, leadAgent: null });
  });
});

describe("one rule on every screen (ADR 0022)", () => {
  const inRepo = (id: string, status: CardStatus, extra: Partial<CardView> = {}) => ({
    ...card(id, status, 0),
    repoPath: "/repo",
    ...extra,
  });
  const phase: Phase = { id: "p1", repoPath: "/repo", name: "Phase un", goal: "", position: 0, roadmapItemId: null };

  for (const wide of [false, true]) {
    it(`${wide ? "desktop" : "phone"}: a container takes no tile and each sub-task sits in its own column, naming it`, async () => {
      viewport(wide);
      await mount([
        inRepo("Dictation", "working"),
        inRepo("Kid done", "done", { parentId: "Dictation" }),
        inRepo("Kid todo", "backlog", { parentId: "Dictation" }),
      ]);
      // The container's only appearance is the caption on its sub-tasks, never a tile of its own.
      expect(screen.getAllByText("Dictation")).toHaveLength(2);
      expect(columnOf("Kid done")).not.toBe(columnOf("Kid todo"));
      expect(within(tileOf("Kid todo")).getByText("Dictation")).toBeInTheDocument();
    });
  }

  it("a card in a phase carries its pill with the phase's progress, and ?phase= narrows the board", async () => {
    viewport(true);
    const cards = [
      inRepo("In one", "done", { phaseId: "p1" }),
      inRepo("In one too", "backlog", { phaseId: "p1" }),
      inRepo("Free", "backlog"),
    ];
    await mount(cards, "/board?repo=/repo&phase=p1", [phase]);
    expect(within(tileOf("In one")).getByText("Phase un · 1/2")).toBeInTheDocument();
    expect(screen.queryByText("Free")).toBeNull();
  });

  it("selects every startable card of the filtered phase at once, and plans them as a lot instead of launching", async () => {
    viewport(false);
    const cards = [
      inRepo("A", "backlog", { phaseId: "p1" }),
      inRepo("B", "ready", { phaseId: "p1" }),
      inRepo("Started", "working", { phaseId: "p1" }),
      inRepo("Other phase", "backlog"),
    ];
    await mount(cards, "/board?repo=/repo&phase=p1", [phase]);
    fireEvent.click(screen.getByRole("button", { name: /select/i }));
    fireEvent.click(screen.getByRole("button", { name: "All in phase" }));
    expect(tileOf("A")).toHaveAttribute("aria-pressed", "true");
    expect(tileOf("B")).toHaveAttribute("aria-pressed", "true");
    expect(tileOf("Started")).not.toHaveAttribute("aria-pressed");

    fireEvent.click(screen.getByRole("button", { name: "Run 2 cards" }));
    fireEvent.change(await screen.findByPlaceholderText("Nom du lot"), { target: { value: "Lot 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Planifier un lot" }));
    await act(async () => {});
    expect(createRun).toHaveBeenLastCalledWith({
      cardIds: ["A", "B"],
      foldInCap: 2,
      leadAgent: null,
      planned: true,
      phaseId: "p1",
      name: "Lot 1",
    });
  });
});
