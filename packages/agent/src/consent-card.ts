import { readFileSync } from "node:fs";
import { homedir } from "node:os";

/** Shorten an absolute path under the home directory to ~/…, for display. */
export function tildify(dir: string, home: string = homedir()): string {
  if (home && (dir === home || dir.startsWith(`${home}/`))) {
    return `~${dir.slice(home.length)}`;
  }
  return dir;
}

/**
 * Server side of the consent card. Provides the structured data the card
 * renders and loads the built single-file HTML. The card content is a
 * card-shaped view of the same one-voice assurances in consent.ts: four
 * calm, non-technical safety points for a 2x2 grid, plus the confidentiality
 * agreement in the footer. Kept truthful to Flow B, where the expert works
 * in the user's files (so the points are about live logging, encryption,
 * private-file protection, and the signed agreement, never "nothing is sent").
 */

export const CONSENT_RESOURCE_URI = "ui://get-an-expert/consent.html";

export interface ConsentCardData {
  card: "consent";
  projectDir: string;
  scopeLine: string;
  cells: { icon: string; title: string; line: string }[];
  footer: string;
  [key: string]: unknown;
}

/** Build the structured card data for a given project directory. */
export function consentCardData(projectDir: string): ConsentCardData {
  return {
    card: "consent",
    projectDir,
    scopeLine: "Files, terminal, and browser",
    cells: [
      { icon: "lock", title: "Consent based", line: "Nothing happens until you approve" },
      { icon: "eye", title: "You see it all, live", line: "Every action in a running log" },
      { icon: "shield", title: "Private by design", line: "Goes straight to the expert, encrypted" },
      { icon: "fileoff", title: "Secrets stay yours", line: "Private files stay shut, secrets stripped" },
    ],
    footer: "Under a signed confidentiality agreement, logged live, revoke anytime",
  };
}

/**
 * Load the built consent card HTML. Vite writes dist/ui/consent.html next to
 * the bundled server (see vite.ui.config.ts). Running from source without a
 * UI build returns null, and the agent degrades to its text consent: the card
 * is an enhancement, never a requirement.
 */
export function loadConsentCardHtml(): string | null {
  const candidates = [
    new URL("./ui/consent.html", import.meta.url), // dist/index.js next to dist/ui/
    new URL("../dist/ui/consent.html", import.meta.url), // tsx from src/
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // try the next location
    }
  }
  return null;
}
