/**
 * The consent card for Flow B (the onmachine agent). It rides
 * request_expert_help on hosts that support MCP Apps UI: a calm privacy panel
 * with a one-click Yes, replacing the "type yes in chat" fallback. The card's
 * buttons finalize the real scopes through the existing confirm_expert_scopes
 * tool, so the card is a nicer surface over the same consent path, never a
 * shortcut around it.
 *
 * Copy is Flow-B-truthful: in onmachine the expert works in the user's files,
 * so the assurances are about live logging, encryption, private-file
 * protection, and the confidentiality agreement, not "nothing is sent".
 * Hosts without app UI never load this file; they get the one-voice text.
 */
import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { ic, injectSprite } from "./icons";
import "./shared.css";

interface Cell {
  icon: string;
  title: string;
  line: string;
}
interface ConsentData {
  card: "consent";
  projectDir: string;
  scopeLine: string;
  cells: Cell[];
  footer: string;
}

const SAMPLE: ConsentData = {
  card: "consent",
  projectDir: "~/my-project",
  scopeLine: "Files, terminal, and browser",
  cells: [
    { icon: "lock", title: "Consent based", line: "Nothing happens until you approve" },
    { icon: "eye", title: "You see it all, live", line: "Every action in a running log" },
    { icon: "shield", title: "Private by design", line: "Goes straight to the expert, encrypted" },
    { icon: "fileoff", title: "Secrets stay yours", line: "Private files stay shut, secrets stripped" },
  ],
  footer: "Under a signed confidentiality agreement, logged live, revoke anytime",
};

/** Escape a value before it lands in markup. Card data crosses the tool
 * boundary, so treat every dynamic string as untrusted. */
function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}

const root = document.getElementById("root") as HTMLElement;
let answered = false;
let enterWired = false;
let act: (kind: "yes" | "no" | "choose") => void = () => {};

function render(data: ConsentData): void {
  injectSprite();
  const cells = data.cells
    .map(
      (c) =>
        `<div class="pcell">${ic(c.icon)}<div><b>${esc(c.title)}</b><span>${esc(
          c.line,
        )}</span></div></div>`,
    )
    .join("");
  root.innerHTML = `
    <div class="card">
      <div class="body">
        <div class="consent-hd">
          <div class="lock-badge">${ic("lock")}</div>
          <div class="hd-text">
            <div class="lead-line">Allow an expert into your project, with your consent</div>
            <div class="lead-sub">${esc(data.scopeLine)} in ${esc(
              data.projectDir,
            )}</div>
          </div>
        </div>
        <div class="privacy-grid">${cells}</div>
        <div class="btns">
          <button class="btn primary sel" data-a="yes">Yes, allow</button>
          <button class="btn" data-a="no">No</button>
          <button class="btn link" data-a="choose">Choose which parts</button>
        </div>
        <p class="note" id="note" style="display:none"></p>
      </div>
      <div class="foot">${ic("lock")}${esc(data.footer)}</div>
    </div>`;

  const note = document.getElementById("note") as HTMLElement;
  const feedback: Record<string, string> = {
    yes: "Approved. Bringing in your expert.",
    no: "Declined. Nothing was shared.",
    choose: "Got it. Pick the parts in the chat.",
  };

  root.querySelectorAll<HTMLButtonElement>(".btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (answered) return;
      const a = (btn.dataset.a ?? "yes") as "yes" | "no" | "choose";
      answered = true;
      root
        .querySelectorAll<HTMLButtonElement>(".btn")
        .forEach((b) => (b.disabled = true));
      note.innerHTML = `${ic("check")}${esc(feedback[a])}`;
      note.style.display = "flex";
      act(a);
    });
  });

  // Yes is preselected: Enter approves without reaching for the mouse.
  if (!enterWired) {
    enterWired = true;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !answered) {
        root.querySelector<HTMLButtonElement>('[data-a="yes"]')?.click();
      }
    });
  }
}

async function main(): Promise<void> {
  // Opened directly in a browser (design preview): render sample data.
  if (window.parent === window) {
    render(SAMPLE);
    return;
  }

  const app = new App({ name: "Get An Expert Consent", version: "1.0.0" });

  app.ontoolresult = (result) => {
    const data = result.structuredContent as ConsentData | undefined;
    if (data?.card === "consent") render(data);
  };

  app.onhostcontextchanged = (ctx) => {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.safeAreaInsets) {
      const { top, right, bottom, left } = ctx.safeAreaInsets;
      document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
    }
  };

  // One click puts the user's decision into the conversation. The agent, per
  // its instructions, then finalizes through confirm_expert_scopes, the same
  // proven path the typed-yes fallback uses, so the user still sees the full
  // "expert on the way" confirmation with their chat link.
  const messages: Record<string, string> = {
    yes: "Yes, I approve expert access to files, terminal, and browser (and sharing this conversation as context). Please confirm and bring in the expert.",
    no: "No, I do not want to share access right now. Please cancel the expert request.",
    choose:
      "Before approving, I want to choose which parts (files, terminal, browser) to share.",
  };
  act = (kind) => {
    void app
      .sendMessage({
        role: "user",
        content: [{ type: "text", text: messages[kind] }],
      })
      .catch(() => {});
  };

  await app.connect();
}

void main();
