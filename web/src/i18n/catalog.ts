import { common } from "./messages/common";
import { board } from "./messages/board";
import { card } from "./messages/card";
import { project } from "./messages/project";
import { prs } from "./messages/prs";
import { recette } from "./messages/recette";
import { sheets } from "./messages/sheets";
import { orchestrator } from "./messages/orchestrator";
import { languageMessages } from "./messages/language";
import { templates } from "./messages/templates";
import { flows } from "./messages/flows";
import { home } from "./messages/home";
import { settings } from "./messages/settings";
import { gallery } from "./messages/gallery";
import { history } from "./messages/history";
import { spaces } from "./messages/spaces";
import { pane } from "./messages/pane";
import { shell } from "./messages/shell";
import { peers } from "./messages/peers";
import { people } from "./messages/people";

// One file per area, so two people (or agents) never edit the same one. Adding an area is one line here.
export const CATALOG = { ...common, ...board, ...card, ...project, ...prs, ...recette, ...sheets, ...orchestrator, ...languageMessages, ...templates, ...flows, ...home, ...settings, ...gallery, ...history, ...spaces, ...pane, ...shell, ...peers, ...people };
export type MessageKey = keyof typeof CATALOG;
