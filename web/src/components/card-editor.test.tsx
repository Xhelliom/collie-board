import { act, fireEvent, render, screen } from "@testing-library/react";

import type { CardView } from "@/lib/board";
import { publishIdentities } from "@/lib/identities";
import { CardEditor } from "./card-editor";

const card = {
  id: "c1", title: "t", spec: null, rawInput: null, acceptance: [], status: "backlog", repoPath: "/r/s",
  baseRef: null, branch: null, workspaceId: null, agentKind: null, parentId: null, duplicateOf: null,
  dependsOn: null, origin: null, originCardId: null, category: null, tag: null, position: 0, createdAt: 0,
  updatedAt: 0, session: null, runtime: null, sessionCount: 0, copilotBusy: false, wrapupPending: false,
  keepWorktree: false, autoHandoff: null, assignee: null,
} as CardView;

// ADR 0048 §5: the assignee is picked among the repo's known identities, and only on a shared repo.
describe("CardEditor — assignee", () => {
  afterEach(() => act(() => publishIdentities({})));

  it("assigns a card to a known identity", async () => {
    act(() => publishIdentities({ "/r/s": { me: "me@x", people: ["alice@x", "me@x"] } }));
    const onSave = vi.fn(() => Promise.resolve());
    render(<CardEditor card={card} open onClose={() => {}} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "alice@x" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assignee: "alice@x" }));
  });

  it("offers no picker on an unshared repo", () => {
    render(<CardEditor card={card} open onClose={() => {}} onSave={() => Promise.resolve()} />);
    expect(screen.queryByLabelText("Assignee")).toBeNull();
  });
});
