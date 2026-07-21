import { describe, expect, it } from "vitest";
import { escapeCell, toCsv } from "../lib/csv";

describe("escapeCell", () => {
  it("quotes plain text", () => {
    expect(escapeCell("Stripe webhook fires twice")).toBe('"Stripe webhook fires twice"');
  });

  it("doubles embedded quotes so the row does not break", () => {
    expect(escapeCell('he said "fix it"')).toBe('"he said ""fix it"""');
  });

  it("keeps commas and newlines inside a single cell", () => {
    expect(escapeCell("one, two\nthree")).toBe('"one, two\nthree"');
  });

  // A lead's issue text is attacker-controlled and this file opens in Excel.
  it("neutralizes spreadsheet formula injection", () => {
    expect(escapeCell("=cmd|'/c calc'!A1")).toBe(`"'=cmd|'/c calc'!A1"`);
    expect(escapeCell("+1234")).toBe(`"'+1234"`);
    expect(escapeCell("-1+1")).toBe(`"'-1+1"`);
    expect(escapeCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
  });

  it("renders dates as ISO and blanks null or undefined", () => {
    expect(escapeCell(new Date("2026-07-20T10:00:00.000Z"))).toBe(
      '"2026-07-20T10:00:00.000Z"',
    );
    expect(escapeCell(null)).toBe("");
    expect(escapeCell(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("writes a header and CRLF-delimited rows", () => {
    const csv = toCsv(["customer", "request"], [["dana", "Auth loop"], ["sam", null]]);
    expect(csv).toBe('customer,request\r\n"dana","Auth loop"\r\n"sam",');
  });
});
