import { describe, expect, it } from "vitest";
import { consentCardData, tildify } from "./consent-card";

describe("tildify", () => {
  it("shortens paths under home to ~/", () => {
    expect(tildify("/Users/sam/my-project", "/Users/sam")).toBe("~/my-project");
  });
  it("shortens home itself to ~", () => {
    expect(tildify("/Users/sam", "/Users/sam")).toBe("~");
  });
  it("leaves paths outside home alone", () => {
    expect(tildify("/opt/work", "/Users/sam")).toBe("/opt/work");
  });
  it("does not treat a sibling prefix as home", () => {
    expect(tildify("/Users/samantha/x", "/Users/sam")).toBe("/Users/samantha/x");
  });
});

describe("consentCardData", () => {
  const data = consentCardData("~/my-project");

  it("carries the project dir and a scope line naming all three scopes", () => {
    expect(data.card).toBe("consent");
    expect(data.projectDir).toBe("~/my-project");
    expect(data.scopeLine.toLowerCase()).toContain("files");
    expect(data.scopeLine.toLowerCase()).toContain("terminal");
    expect(data.scopeLine.toLowerCase()).toContain("browser");
  });

  it("has four assurance cells, each with an icon in the shipped set", () => {
    const icons = new Set([
      "lock",
      "eye",
      "shield",
      "fileoff",
      "terminal",
      "person",
      "check",
    ]);
    expect(data.cells).toHaveLength(4);
    for (const cell of data.cells) {
      expect(icons.has(cell.icon)).toBe(true);
      expect(cell.title.length).toBeGreaterThan(0);
      expect(cell.line.length).toBeGreaterThan(0);
    }
  });

  it("keeps the copy truthful to Flow B: no 'never sent' claim about the code", () => {
    // In onmachine the expert works in the user's files, so the card must not
    // claim the code is never shared. Guard against a Flow A copy regression.
    const blob = JSON.stringify(data).toLowerCase();
    expect(blob).not.toContain("never sent");
    expect(blob).not.toContain("stays put");
  });

  it("names the confidentiality agreement in the footer", () => {
    expect(data.footer.toLowerCase()).toContain("confidentiality agreement");
  });

  it("uses no em dashes in any card copy", () => {
    expect(JSON.stringify(data)).not.toContain("—");
  });
});
