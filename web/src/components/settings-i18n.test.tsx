import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { setPreference } from "@/i18n";
import { BackupControl } from "./backup-control";
import { ConnectionInfo } from "./connection-info";
import { ThemeControl } from "./theme-control";

afterEach(() => setPreference("en"));

describe("the Settings controls speak the chosen language", () => {
  it("in English by default, in French once chosen — never both", () => {
    setPreference("fr");
    render(
      <>
        <ThemeControl />
        <ConnectionInfo bridge="connected" device={undefined} />
        <BackupControl device={undefined} />
      </>,
    );
    for (const fr of ["Apparence", "Clair", "Connexion", "Connecté", "Sauvegarde", "Télécharger la sauvegarde"]) {
      expect(screen.getByText(fr)).toBeInTheDocument();
    }
    for (const en of ["Appearance", "Light", "Connection", "Connected", "Backup", "Download backup"]) {
      expect(screen.queryByText(en)).not.toBeInTheDocument();
    }
  });
});
