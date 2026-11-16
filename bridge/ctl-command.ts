// The command a person is told to run to restart or update Collie. Under herdr 0.9 it is the Herdr
// plugin action (runs from any directory, CLAUDE.md). herdr-core has no plugins, so `herdr plugin
// action invoke` there answers `server_not_running`: give it the checkout's own ctl script instead, by
// absolute path so it still runs from any directory.

import { join } from "node:path";

import type { MachineEngine } from "./mux/mux.ts";

const CTL = join(import.meta.dir, "..", "scripts", "collie-board-ctl.sh");

export function ctlCommand(action: "restart" | "update", engine: MachineEngine | null, ctl = CTL): string {
  return engine?.engine === "hc"
    ? `bash '${ctl}' ${action}`
    : `herdr plugin action invoke ${action} --plugin herdr.collie-board`;
}
