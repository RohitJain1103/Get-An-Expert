import { readFileSync } from "node:fs";

/**
 * Load a built card's single-file HTML. The Vite build writes dist/ui/*.html
 * next to the bundled server (see vite.config.ts), so in the published
 * package the first candidate hits. Running from source without a build
 * returns null and the server degrades to text-only tools: the cards are an
 * enhancement, never a requirement.
 */
export function loadCardHtml(name: "consent" | "status"): string | null {
  const candidates = [
    new URL(`./ui/${name}.html`, import.meta.url), // dist/index.js next to dist/ui/
    new URL(`../dist/ui/${name}.html`, import.meta.url), // tsx from src/
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
