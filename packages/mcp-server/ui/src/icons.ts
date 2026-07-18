/**
 * Hand-drawn inline SVG icon set from the approved card preview. The MCP Apps
 * iframe CSP blocks icon libraries and external assets, so the symbols ship
 * inside the bundle and are injected once as a hidden sprite sheet.
 * Consistent 1.7 stroke, rounded caps (the .ic class in shared.css).
 */
export const ICON_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="lock" viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2.6"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/></symbol>
  <symbol id="eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.7"/></symbol>
  <symbol id="shield" viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.4-3 7.4-7 8.9-4-1.5-7-4.5-7-8.9V6l7-3Z"/><path d="M9 12l2.2 2.2L15 10.4"/></symbol>
  <symbol id="fileoff" viewBox="0 0 24 24"><path d="M13.5 3H7a1 1 0 0 0-1 1v13"/><path d="M18 8.5V20a1 1 0 0 1-1 1H8"/><path d="M14 3v4a1 1 0 0 0 1 1h4"/><line x1="4.5" y1="20.5" x2="19.5" y2="3.5"/></symbol>
  <symbol id="folder" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></symbol>
  <symbol id="terminal" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.2"/><path d="M7.5 9.5l3 2.5-3 2.5"/><line x1="12.5" y1="15" x2="16" y2="15"/></symbol>
  <symbol id="globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><line x1="3.5" y1="12" x2="20.5" y2="12"/><path d="M12 3.5c2.4 2.3 2.4 14.7 0 17M12 3.5c-2.4 2.3-2.4 14.7 0 17"/></symbol>
  <symbol id="arrow" viewBox="0 0 24 24"><line x1="5" y1="12" x2="18" y2="12"/><path d="M13 7l5 5-5 5"/></symbol>
  <symbol id="check" viewBox="0 0 24 24"><path d="M4 12.5l5 5 11-11"/></symbol>
  <symbol id="edit" viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17v3Z"/></symbol>
  <symbol id="play" viewBox="0 0 24 24"><path d="M7 5l11 7-11 7V5Z" fill="currentColor" stroke="none"/></symbol>
  <symbol id="person" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></symbol>
  <symbol id="clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.2v5l3.4 2"/></symbol>
  <symbol id="star" viewBox="0 0 24 24"><path d="M12 3.4l2.6 5.3 5.9.9-4.3 4.1 1 5.9L12 16.8l-5.2 2.8 1-5.9L3.5 9.6l5.9-.9L12 3.4Z"/></symbol>
</svg>`;

/** Inline `<svg><use>` reference into the sprite sheet. */
export function ic(name: string, extraClass = ""): string {
  return `<svg class="ic${extraClass ? ` ${extraClass}` : ""}"><use href="#${name}"/></svg>`;
}

/** Inject the sprite sheet once, before any card markup renders. */
export function injectSprite(): void {
  if (document.getElementById("gae-icon-sprite")) return;
  const holder = document.createElement("div");
  holder.id = "gae-icon-sprite";
  holder.innerHTML = ICON_SPRITE;
  document.body.prepend(holder);
}

/** Map an agent activity `kind` to the icon that reads right at a glance. */
export function activityIcon(kind: string): string {
  if (kind === "write_file" || kind === "edit") return "edit";
  if (kind === "run_command" || kind.startsWith("terminal")) return "play";
  if (kind.startsWith("browser")) return "globe";
  if (kind === "consent") return "lock";
  if (kind === "read_file" || kind === "list_files") return "eye";
  return "clock";
}
