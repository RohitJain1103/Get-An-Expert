/**
 * Cards 2, 3 and 4, riding expert_status. One resource, three view modes:
 *
 *   waiting            -> Card 2 "Finding your expert" (radar)
 *   connected          -> Card 3 "Working" (header + live activity glance)
 *   connected+delivery -> Card 4 "Delivered" (check pop + rating)
 *
 * The card polls the app-only expert_status_refresh tool so the radar
 * resolves onto the matched expert and activity updates in place, without
 * the model being involved. Activity stays trimmed to the latest two lines:
 * a glance, not a log viewer.
 */
import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { activityIcon, ic, injectSprite } from "./icons";
import "./shared.css";

interface StatusActivity {
  at: number;
  kind: string;
  summary: string;
}

interface StatusProfile {
  name?: string;
  photo?: string;
  role?: string;
  tag?: string;
  rating?: number;
  fixesDelivered?: number;
}

interface StatusData {
  card: "status";
  state: "idle" | "waiting" | "connected" | "ended";
  expertName?: string;
  expertiseArea?: string;
  chatUrl?: string;
  profile?: StatusProfile;
  lastDelivery?: { summary: string; accepted?: boolean; at?: number };
  startedAt?: number;
  updatedAt?: number;
  activity: StatusActivity[];
}

type Mode = "idle" | "waiting" | "matched" | "working" | "delivered";

/** Escape a value before it lands in markup. Activity summaries and profile
 * fields cross the expert boundary, so every dynamic string is untrusted. */
function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}

/** Only ever load expert photos over https; anything else gets the monogram. */
function safePhoto(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function monogram(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "GE";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase() || "GE";
}

function clockTime(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function elapsedMin(from: number | undefined, to: number): string | null {
  if (!from || from <= 0 || to <= from) return null;
  return `${Math.max(1, Math.round((to - from) / 60000))} min`;
}

const root = document.getElementById("root") as HTMLElement;
let app: App | null = null;
let current: StatusData | null = null;
let mode: Mode | null = null;
let rated = false;

function say(text: string): void {
  void app
    ?.sendMessage({ role: "user", content: [{ type: "text", text }] })
    .catch(() => {});
}

function avatarHtml(data: StatusData, cls: string): string {
  const name = data.profile?.name ?? data.expertName;
  const photo = safePhoto(data.profile?.photo);
  return photo
    ? `<div class="${cls}"><img src="${esc(photo)}" alt="${esc(name)}"/></div>`
    : `<div class="${cls}">${esc(monogram(name))}</div>`;
}

function metaLine(data: StatusData): string {
  const p = data.profile ?? {};
  const bits: string[] = [];
  if (p.role) bits.push(esc(p.role));
  if (typeof p.rating === "number")
    bits.push(`<span class="star">★</span> ${esc(p.rating.toFixed(1))}`);
  if (typeof p.fixesDelivered === "number")
    bits.push(`${esc(p.fixesDelivered)} fixes delivered`);
  return bits.join(" &nbsp;·&nbsp; ");
}

/* ---------------- views ---------------- */

function renderWaiting(data: StatusData): void {
  const area = data.expertiseArea
    ? `the right person for ${esc(data.expertiseArea)}`
    : "the right person for this";
  root.innerHTML = `
    <div class="card"><div class="body">
      <div class="match">
        <div class="radar">
          <span class="ring"></span><span class="ring"></span><span class="ring"></span>
          <span class="core">${ic("person")}</span>
        </div>
        <div>
          <div class="headline">Finding your expert</div>
          <div class="sub">Matching you with ${area}, usually under a few minutes.</div>
        </div>
        <div class="match-meta">
          <span>${ic("shield")}vetted only</span>
          <span>${ic("lock")}confidential</span>
        </div>
        <div class="reassure">You can step away. Your request stays queued and reconnects on its own.</div>
        <button class="btn link" id="cancel">Cancel request</button>
      </div>
    </div></div>`;
  document.getElementById("cancel")?.addEventListener("click", () => {
    say("Cancel my Get An Expert request. Don't wait for a match.");
    const btn = document.getElementById("cancel") as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Cancel requested";
    }
  });
}

function renderMatched(data: StatusData): void {
  const name = data.profile?.name ?? data.expertName ?? "your expert";
  const meta = metaLine(data);
  root.innerHTML = `
    <div class="card"><div class="body">
      <div class="matched show">
        ${avatarHtml(data, "av").replace(
          "</div>",
          `<span class="tick">${ic("check")}</span></div>`,
        )}
        <div>
          <div class="headline">Matched with ${esc(name)}</div>
          <div class="sub">${meta ? `${meta}. ` : ""}Connecting you now.</div>
        </div>
      </div>
    </div></div>`;
}

function renderWorking(data: StatusData): void {
  const name = data.profile?.name ?? data.expertName ?? "Your expert";
  const lines = data.activity.slice(-2);
  const activityHtml = lines.length
    ? lines
        .map(
          (a) =>
            `<div class="aline"><span class="t">${esc(clockTime(a.at))}</span>${ic(
              activityIcon(a.kind),
            )}<span class="s">${esc(a.summary)}</span></div>`,
        )
        .join("")
    : `<div class="aline"><span class="s">Connected. No actions logged yet.</span></div>`;
  root.innerHTML = `
    <div class="card">
      <div class="body">
        <div class="top">
          ${avatarHtml(data, "avatar")}
          <div class="who2">
            <b>${esc(name)}</b>
            <span class="meta">${metaLine(data)}</span>
          </div>
          <div class="live"><span class="d"></span>Live</div>
        </div>
        <div class="field">
          <div class="k">Live activity</div>
          <div class="activity" id="activity">${activityHtml}</div>
        </div>
        <div class="actions">
          ${
            data.chatUrl
              ? `<button class="btn primary go" id="chat">Go to chat ${ic("arrow")}</button>`
              : ""
          }
          <div class="quiet">
            <button class="btn link" id="pause">Pause relaying</button>
            <span class="sep">·</span>
            <button class="btn link danger" id="end">End session</button>
          </div>
          <div class="confirm" data-kind="pause">
            <p>Pause relaying to the expert? <span>The chat stays open; nothing relays until you resume.</span></p>
            <div class="cbtns"><button class="btn yes" data-c="pause">Pause relaying</button><button class="btn no">Cancel</button></div>
          </div>
          <div class="confirm" data-kind="end">
            <p>End the session? <span>This stops everything and nothing relays anymore. It cannot be undone.</span></p>
            <div class="cbtns"><button class="btn yes" data-c="end">Yes, end session</button><button class="btn no">Cancel</button></div>
          </div>
        </div>
      </div>
      <div class="foot">${ic("lock")}Relaying this session only &nbsp;·&nbsp; logged live &nbsp;·&nbsp; you can end anytime</div>
    </div>`;

  document.getElementById("chat")?.addEventListener("click", () => {
    if (data.chatUrl) void app?.openLink({ url: data.chatUrl }).catch(() => {});
  });
  const closeAll = () =>
    root
      .querySelectorAll(".confirm")
      .forEach((c) => c.classList.remove("show"));
  const wire = (btnId: string, kind: string) => {
    document.getElementById(btnId)?.addEventListener("click", () => {
      const c = root.querySelector(`.confirm[data-kind="${kind}"]`);
      const open = c?.classList.contains("show");
      closeAll();
      if (!open) c?.classList.add("show");
    });
  };
  wire("pause", "pause");
  wire("end", "end");
  root
    .querySelectorAll<HTMLButtonElement>(".confirm .no")
    .forEach((b) => b.addEventListener("click", closeAll));
  root
    .querySelectorAll<HTMLButtonElement>(".confirm .yes")
    .forEach((b) =>
      b.addEventListener("click", () => {
        say(
          b.dataset.c === "end"
            ? "End the Get An Expert session now."
            : "Pause relaying to the expert for now.",
        );
        closeAll();
      }),
    );
}

function renderDelivered(data: StatusData): void {
  const name = data.profile?.name ?? data.expertName ?? "Your expert";
  const deliveredAt = data.lastDelivery?.at ?? data.updatedAt ?? 0;
  const took = elapsedMin(data.startedAt, deliveredAt);
  const stats: string[] = [];
  if (took) stats.push(`<span>${ic("clock")}${esc(took)}</span>`);
  if (data.lastDelivery?.accepted)
    stats.push(`<span>${ic("check")}fix confirmed</span>`);
  root.innerHTML = `
    <div class="card">
      <div class="confetti" id="confetti"></div>
      <div class="body">
        <div class="celebrate">
          <div class="check-hero">${ic("check")}</div>
          <div>
            <div class="big">Delivered</div>
            <div class="sub">${esc(name)} delivered: ${esc(
              data.lastDelivery?.summary ?? "your fix is ready",
            )}</div>
          </div>
          ${stats.length ? `<div class="deliver-stats">${stats.join("")}</div>` : ""}
        </div>
        <div class="actions">
          ${
            data.chatUrl
              ? `<button class="btn primary go" id="chat">Go to chat ${ic("arrow")}</button>`
              : ""
          }
          <div class="rating" id="rating">
            <span class="lbl">Rate your expert</span>
            <div class="stars" id="stars">
              ${[1, 2, 3, 4, 5].map((v) => ic("star", `s${v}`)).join("")}
            </div>
            <div class="rated-msg" id="ratedMsg">${ic("check")}Thanks for the rating</div>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById("chat")?.addEventListener("click", () => {
    if (data.chatUrl) void app?.openLink({ url: data.chatUrl }).catch(() => {});
  });

  // Confetti burst, brand greens and cream only, honoring reduced motion.
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cf = document.getElementById("confetti");
  if (cf && !reduce) {
    const colors = ["#2F4A38", "#5E8A6C", "#7FAE8D", "#E7E1D3"];
    for (let n = 0; n < 14; n++) {
      const p = document.createElement("i");
      p.style.left = `${10 + Math.floor((n / 14) * 80)}%`;
      p.style.background = colors[n % colors.length];
      p.style.animationDelay = `${(n % 5) * 0.09}s`;
      cf.appendChild(p);
    }
  }

  // Rating fills on hover, one tap sends it and closes the loop.
  const stars = Array.from(
    root.querySelectorAll<SVGElement>("#stars .ic"),
  ).map((el, i) => ({ el, v: i + 1 }));
  const paint = (v: number) =>
    stars.forEach((s) => s.el.classList.toggle("on", s.v <= v));
  stars.forEach(({ el, v }) => {
    el.addEventListener("mouseenter", () => {
      if (!rated) paint(v);
    });
    el.addEventListener("click", () => {
      if (rated) return;
      rated = true;
      paint(v);
      say(`Rate my Get An Expert session ${v} out of 5 stars.`);
      window.setTimeout(() => {
        const row = document.getElementById("stars");
        const lbl = root.querySelector<HTMLElement>("#rating .lbl");
        if (row) row.style.display = "none";
        if (lbl) lbl.style.display = "none";
        document.getElementById("ratedMsg")?.classList.add("show");
      }, 260);
    });
  });
  document.getElementById("stars")?.addEventListener("mouseleave", () => {
    if (!rated) paint(0);
  });
}

function renderIdle(): void {
  root.innerHTML = `
    <div class="card"><div class="body">
      <div class="idle">${ic("person")}<span>No live expert session right now. Ask for an expert when you're stuck.</span></div>
    </div></div>`;
}

/* ---------------- mode machine ---------------- */

function update(data: StatusData): void {
  injectSprite();
  const prev = mode;
  current = data;
  let next: Mode;
  if (data.state === "waiting") next = "waiting";
  else if (data.state === "connected")
    next = data.lastDelivery ? "delivered" : "working";
  else next = "idle";

  // The resolve moment: radar was searching, an expert just joined. Show the
  // matched beat for a moment before settling into the working view.
  if (prev === "waiting" && next === "working") {
    mode = "matched";
    renderMatched(data);
    window.setTimeout(() => {
      if (mode === "matched" && current) {
        mode = "working";
        renderWorking(current);
      }
    }, 2600);
    return;
  }

  if (next === mode && next === "working") {
    // Update activity in place instead of re-rendering, so lines fade in.
    const act = document.getElementById("activity");
    if (act) {
      const lines = data.activity.slice(-2);
      const html = lines
        .map(
          (a) =>
            `<div class="aline" data-k="${esc(a.at)}"><span class="t">${esc(
              clockTime(a.at),
            )}</span>${ic(activityIcon(a.kind))}<span class="s">${esc(a.summary)}</span></div>`,
        )
        .join("");
      if (html !== act.innerHTML) {
        act.innerHTML = html;
        act.lastElementChild?.classList.add("in");
      }
      return;
    }
  }

  if (next === mode && next !== "working") return;
  mode = next;
  if (next === "waiting") renderWaiting(data);
  else if (next === "working") renderWorking(data);
  else if (next === "delivered") renderDelivered(data);
  else renderIdle();
}

/* ---------------- wiring ---------------- */

const SAMPLE: StatusData = {
  card: "status",
  state: "connected",
  expertName: "Rohit Jain",
  chatUrl: "https://midsesh.com",
  profile: {
    name: "Rohit Jain",
    role: "Senior software engineer",
    rating: 4.8,
    fixesDelivered: 12,
  },
  startedAt: Date.now() - 21 * 60000,
  updatedAt: Date.now(),
  activity: [
    { at: Date.now() - 120000, kind: "run_command", summary: "Ran npm test" },
    {
      at: Date.now() - 30000,
      kind: "browser_screenshot",
      summary: "Viewing localhost:3000/invoices",
    },
  ],
};

async function main(): Promise<void> {
  if (window.parent === window) {
    // Direct browser open (design preview loop): cycle the three modes so
    // every view is reviewable without a host. #waiting / #delivered pin one.
    const pin = location.hash.replace("#", "");
    if (pin === "waiting") update({ ...SAMPLE, state: "waiting" });
    else if (pin === "delivered")
      update({
        ...SAMPLE,
        lastDelivery: {
          summary: "Users can no longer see other people's invoices.",
          accepted: true,
          at: Date.now(),
        },
      });
    else update(SAMPLE);
    return;
  }

  app = new App({ name: "Get An Expert Session", version: "1.0.0" });

  app.ontoolresult = (result) => {
    const data = result.structuredContent as StatusData | undefined;
    if (data?.card === "status") update(data);
  };

  app.onhostcontextchanged = (ctx) => {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.safeAreaInsets) {
      const { top, right, bottom, left } = ctx.safeAreaInsets;
      document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
    }
  };

  // Default transport talks postMessage to the host; auto-resize is on by
  // default, so the iframe grows with the card.
  await app.connect();

  // Live polling through the app-only refresh tool: the radar resolves and
  // activity updates in place without the model in the loop. Stop polling
  // once the session is over; back off silently on errors.
  const poll = async () => {
    if (!app || mode === "idle" || mode === "delivered") return;
    try {
      const res = await app.callServerTool({
        name: "expert_status_refresh",
        arguments: {},
      });
      const data = res.structuredContent as StatusData | undefined;
      if (data?.card === "status") update(data);
    } catch {
      // Transient poll failure: keep the last good render.
    }
  };
  window.setInterval(() => void poll(), 4000);
}

void main();
