/**
 * Card 1: Consent, riding offer_expert_help.
 *
 * The approval as a card: lock badge, the assurances as a 2x2 icon grid,
 * scope chips, and Yes (preselected) / No / Choose which parts. The card
 * itself sends nothing anywhere; every button only puts the user's answer
 * into the conversation, where the existing consent flow (request_expert_help
 * plus the host's own confirmation prompt) still does the real gating.
 *
 * Text-only hosts never see this file: they get buildOfferMessage as before.
 */
import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { ic, injectSprite } from "./icons";
import "./shared.css";

interface ConsentData {
  card: "consent";
  expertiseArea: string;
  projectDir: string;
  privacyUrl: string;
}

const SAMPLE: ConsentData = {
  card: "consent",
  expertiseArea: "React state management",
  projectDir: "~/my-project",
  privacyUrl: "https://midsesh.com/privacy",
};

/** Escape a value before it lands in markup. Card data crosses process and
 * network boundaries, so treat every dynamic string as untrusted. */
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
let sendAnswer: (text: string) => void = () => {};

function render(data: ConsentData): void {
  injectSprite();
  root.innerHTML = `
    <div class="card">
      <div class="body">
        <div class="consent-hd">
          <div class="lock-badge">${ic("lock")}</div>
          <div class="hd-text">
            <div class="lead-line">Allow expert to get context with your consent</div>
            <div class="lead-sub">${esc(data.expertiseArea)} in ${esc(
              data.projectDir,
            )}</div>
          </div>
        </div>
        <div class="scope-icons">
          <span>${ic("terminal")}[files//terminal]</span>
        </div>
        <div class="privacy-grid">
          <div class="pcell">${ic("lock")}<div><b>Consent based</b><span>Nothing is sent until you approve</span></div></div>
          <div class="pcell">${ic("eye")}<div><b>Fully logged</b><span>Every action, visible live</span></div></div>
          <div class="pcell">${ic("shield")}<div><b>Secrets redacted</b><span>Locally, before anything is sent</span></div></div>
          <div class="pcell">${ic("fileoff")}<div><b>Source files stay put</b><span>Never sent. Auto-deletes in 30 days</span></div></div>
        </div>
        <div class="btns">
          <button class="btn primary sel" data-a="yes">Yes</button>
          <button class="btn" data-a="no">No</button>
          <button class="btn link" data-a="parts">Choose which parts</button>
        </div>
        <p class="note" id="note">${ic("check")}One tap. Yes is preselected, so Enter approves.</p>
      </div>
      <div class="foot">${ic("lock")}Scoped to ${esc(
        data.projectDir,
      )} · logged live · revocable anytime</div>
    </div>`;

  const note = document.getElementById("note") as HTMLElement;
  const answers: Record<string, { message: string; note: string }> = {
    yes: {
      message:
        "Yes. I read the consent notice and I agree. Send my request to Get An Expert.",
      note: "Approved. Preparing your request.",
    },
    no: {
      message: "No. Don't send anything to Get An Expert.",
      note: "Declined. Nothing was sent.",
    },
    parts: {
      message:
        "Before I decide, I want to choose which parts are shared with the expert.",
      note: "Got it. Pick the parts in the conversation.",
    },
  };

  root.querySelectorAll<HTMLButtonElement>(".btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (answered) return;
      answered = true;
      const choice = answers[btn.dataset.a ?? "yes"];
      root
        .querySelectorAll<HTMLButtonElement>(".btn")
        .forEach((b) => (b.disabled = true));
      note.innerHTML = `${ic("check")}${esc(choice.note)}`;
      sendAnswer(choice.message);
    });
  });

  // Yes is preselected: Enter approves without reaching for the mouse.
  // Registered once even though render can run twice (input, then result).
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
  // Opened directly in a browser (design preview loop): render sample data.
  if (window.parent === window) {
    render(SAMPLE);
    return;
  }

  const app = new App({ name: "Get An Expert Consent", version: "1.0.0" });

  app.ontoolinput = (params) => {
    // Early paint from the tool arguments; the server result refines it.
    const area = (params.arguments?.expertiseArea as string) ?? "";
    render({ ...SAMPLE, expertiseArea: area || SAMPLE.expertiseArea });
  };

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

  sendAnswer = (text) => {
    void app
      .sendMessage({ role: "user", content: [{ type: "text", text }] })
      .catch(() => {
        // The host declined the message; the buttons already reflect the
        // choice locally, and the user can still answer in the conversation.
      });
  };

  // Default transport talks postMessage to the host; auto-resize is on by
  // default, so the iframe grows with the card.
  await app.connect();
}

void main();
