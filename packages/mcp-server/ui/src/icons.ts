/**
 * Icon sprite for the cards, drawn in the SF Symbols convention the approved
 * iOS-icon mock uses: solid filled objects (lock, eye, shield, person, star,
 * play), bold rounded strokes for actions (check, arrow), and outline where a
 * fill would lose detail at 15 to 19px (fileoff, terminal, globe, clock,
 * edit). Symbols carry their own fill/stroke attributes; the .ic class only
 * sets caps, joins and sizing. The MCP Apps iframe CSP blocks icon libraries,
 * so the sprite ships inside the bundle and is injected once.
 */
export const ICON_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="lock" viewBox="0 0 24 24">
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/>
    <path fill="currentColor" fill-rule="evenodd" d="M6.5 10.3h11A2.5 2.5 0 0 1 20 12.8v5.7A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-5.7a2.5 2.5 0 0 1 2.5-2.5Zm5.5 3.9a1.5 1.5 0 0 0-.7 2.83V18.1a.7.7 0 0 0 1.4 0v-1.07a1.5 1.5 0 0 0-.7-2.83Z"/>
  </symbol>
  <symbol id="eye" viewBox="0 0 24 24">
    <path fill="currentColor" fill-rule="evenodd" d="M12 5.4C5.9 5.4 2.4 12 2.4 12s3.5 6.6 9.6 6.6S21.6 12 21.6 12 18.1 5.4 12 5.4Zm0 3.9a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z"/>
  </symbol>
  <symbol id="shield" viewBox="0 0 24 24">
    <path fill="currentColor" fill-rule="evenodd" d="M11.6 2.6a1 1 0 0 1 .8 0l7 3a1 1 0 0 1 .6.92V11c0 4.8-3.2 8.3-7.7 9.95a.9.9 0 0 1-.6 0C7.2 19.3 4 15.8 4 11V6.52a1 1 0 0 1 .6-.92l7-3Zm4.3 6.86a1 1 0 0 0-1.5-1.32l-3.25 3.66-1.3-1.3a1 1 0 0 0-1.42 1.42l2.05 2.05a1 1 0 0 0 1.46-.05l3.96-4.46Z"/>
  </symbol>
  <symbol id="fileoff" viewBox="0 0 24 24">
    <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10A1.5 1.5 0 0 0 18.5 19V8.5L13.5 3.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M13 4v4.2a1 1 0 0 0 1 1H18.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <line x1="5" y1="20.4" x2="19" y2="4" stroke="currentColor" stroke-width="1.9"/>
  </symbol>
  <symbol id="terminal" viewBox="0 0 24 24">
    <rect x="3" y="4.5" width="18" height="15" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M7.5 9.5l2.8 2.5-2.8 2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="12.4" y1="15" x2="16.5" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </symbol>
  <symbol id="person" viewBox="0 0 24 24">
    <circle cx="12" cy="8" r="3.7" fill="currentColor"/>
    <path fill="currentColor" d="M5 19.4a7 7 0 0 1 14 0 1 1 0 0 1-1 1H6a1 1 0 0 1-1-1Z"/>
  </symbol>
  <symbol id="play" viewBox="0 0 24 24">
    <path fill="currentColor" d="M8.4 5.3c0-.82.9-1.32 1.6-.86l8.5 6.2a1.05 1.05 0 0 1 0 1.72l-8.5 6.2c-.7.46-1.6-.04-1.6-.86Z"/>
  </symbol>
  <symbol id="globe" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.7"/>
    <line x1="3.6" y1="12" x2="20.4" y2="12" stroke="currentColor" stroke-width="1.7"/>
    <path d="M12 3.6c2.4 2.4 2.4 14.4 0 16.8M12 3.6c-2.4 2.4-2.4 14.4 0 16.8" fill="none" stroke="currentColor" stroke-width="1.7"/>
  </symbol>
  <symbol id="clock" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M12 7.4V12l3.2 1.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>
  <symbol id="edit" viewBox="0 0 24 24">
    <path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17v3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>
  <symbol id="star" viewBox="0 0 24 24">
    <path fill="currentColor" d="M11.1 3.25a1 1 0 0 1 1.8 0l2.15 4.42 4.86.72a1 1 0 0 1 .56 1.7l-3.53 3.45.83 4.86a1 1 0 0 1-1.45 1.05L12 17.2l-4.33 2.3a1 1 0 0 1-1.45-1.05l.83-4.86-3.53-3.45a1 1 0 0 1 .56-1.7l4.86-.72Z"/>
  </symbol>
  <symbol id="check" viewBox="0 0 24 24">
    <path d="M5 12.6l4.4 4.4L19 7.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>
  <symbol id="arrow" viewBox="0 0 24 24">
    <path d="M4.5 12h13M12.5 6.5l5.5 5.5-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>
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
