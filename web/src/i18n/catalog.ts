import { common } from "./messages/common";
import { board } from "./messages/board";
import { card } from "./messages/card";
import { project } from "./messages/project";
import { prs } from "./messages/prs";
import { sheets } from "./messages/sheets";
import { orchestrator } from "./messages/orchestrator";
import { languageMessages } from "./messages/language";

// One file per area, so two people (or agents) never edit the same one. Adding an area is one line here.
export const CATALOG = { ...common, ...board, ...card, ...project, ...prs, ...sheets, ...orchestrator, ...languageMessages };
export type MessageKey = keyof typeof CATALOG;
