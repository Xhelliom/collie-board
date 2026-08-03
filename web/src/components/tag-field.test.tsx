import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TagField } from "./tag-field";

// The field exists to stop tags fragmenting, so what is worth pinning is the two entry paths
// agreeing — typing a tag that already exists has to land on THAT tag, not on a second spelling of
// it. Rendered rather than unit-tested because "the chip lights up" is the only feedback the user
// gets that they are about to reuse a tag rather than invent one.

function Harness({ tags, initial = "" }: { tags: string[]; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <TagField value={value} onChange={setValue} tags={tags} />;
}

// `combobox`, not `textbox`: binding the box to the inventory with `list=` is what makes it ONE
// control that both types and offers, and the role is how that shows up to a screen reader too.
const box = () => screen.getByRole("combobox", { name: /tag/i });

describe("TagField", () => {
  it("marks the existing tag selected when you type another spelling of it", async () => {
    render(<Harness tags={["bug", "infra"]} />);
    await userEvent.type(box(), "  Bug ");

    expect(screen.getByRole("button", { name: "bug" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "infra" })).toHaveAttribute("aria-pressed", "false");
  });

  it("fills the box when a tag is tapped, so both paths end in the same value", async () => {
    render(<Harness tags={["bug", "infra"]} />);
    await userEvent.click(screen.getByRole("button", { name: "infra" }));

    expect(box()).toHaveValue("infra");
    expect(screen.getByRole("button", { name: "infra" })).toHaveAttribute("aria-pressed", "true");
  });

  it("clears the tag when the selected chip is tapped again", async () => {
    render(<Harness tags={["bug"]} initial="bug" />);
    await userEvent.click(screen.getByRole("button", { name: "bug" }));

    expect(box()).toHaveValue("");
  });

  it("offers the inventory to the box itself, not only as chips", () => {
    render(<Harness tags={["bug", "infra"]} />);
    const list = box().getAttribute("list");

    expect(list).toBeTruthy();
    expect(document.getElementById(list!)?.querySelectorAll("option")).toHaveLength(2);
  });

  it("shows no chips at all on a board that has never had a tag", () => {
    render(<Harness tags={[]} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
