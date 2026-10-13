import { render } from "@testing-library/react";
import { expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { Rich } from "./rich";

it("renders <c> as code and <b> as bold", () => {
  setPreference("en");
  const { container } = render(<Rich id="settings.backup.previous" params={{ path: "/x/y" }} />);
  expect(container.querySelector("code")?.textContent).toBe("/x/y");
  const b = render(<Rich id="settings.followUps.hint" />).container;
  expect(b.querySelector("strong")?.textContent).toBe("auto");
});

it("leaves an unknown tag as text", () => {
  setPreference("en");
  // an unknown key renders the key itself; a tag-looking key proves nothing is parsed besides <c>/<b>
  const { container } = render(<Rich id={"x <i>y</i>" as never} />);
  expect(container.textContent).toBe("x <i>y</i>");
  expect(container.querySelector("i")).toBeNull();
});
