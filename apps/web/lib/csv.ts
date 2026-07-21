/**
 * CSV serialization for the leads export.
 *
 * Lead text is written by untrusted users and the export is opened in Excel or
 * Sheets, so a leading =, +, -, or @ would be run as a formula. Every cell is
 * neutralized before quoting.
 */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_TRIGGER.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Build a CRLF-delimited CSV document from a header row and data rows. */
export function toCsv(columns: readonly string[], rows: readonly unknown[][]): string {
  return [columns.join(","), ...rows.map((r) => r.map(escapeCell).join(","))].join("\r\n");
}
