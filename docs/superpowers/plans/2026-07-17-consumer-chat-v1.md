# Consumer Chat v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Step 0 design: per-expert identity in the relay, the branded consumer chat with real expert cards, an editable context card, and auto-open at invocation.

**Architecture:** Four tracks. The relay gains a committed roster and maps auth tokens to expert profiles; the claim path already exists and now emits the full profile. The consumer chat page (`apps/dashboard/public/chat.*`) is rebuilt to the locked visual spec. The agent (`packages/agent`) gains a hardened `openUrl` and a profile-aware status card. Context editing adds one validated message per direction with a customer-always-wins conflict rule. Tracks R, C, A are independent and run in parallel worktrees; track E needs R and C merged first.

**Tech Stack:** TypeScript, Node 20+, pnpm workspaces, vitest, zod (relay protocol), vanilla JS browser scripts (dashboard convention), ws.

**Visual spec (source of truth for all pixels and copy):**
`docs/superpowers/specs/2026-07-17-consumer-chat-visual-spec.html`: the approved rev 7 prototype. Open it in a browser next to your diff. Copy strings EXACTLY from it.

## Global Constraints

- **No em dashes in any customer-facing string.** Grep `-` before every commit. (Pulkit hard rule.)
- **No stock AI phrasing** (seamless, delve, unlock, elevate, empower, vetted).
- **Palette:** cream `#FAF7F0`, paper `#FFFFFF`, sand `#E8DFC9`/`#D6CBB0`, ink `#1C1A16`/`#4B4841`/`#8A8578`, forest `#2F4A38`, sage `#8FB89B` (fills/borders only, never text on cream), sage-soft `#EDF3EE`, bronze `#8C7136` (marks) / `#7D6530` (text) / `#F6F1E4` (fill), rust `#A04A3C` (attention text), terracotta `#D98A79` (fills only). Consumer chat is **light only**.
- **No accent rails / half-coloured left borders on cards** (rejected as an AI-generated tell). Attention = elevation + serif heading.
- **Shape system:** cards 14px radius, chips/buttons/inputs pill (999px), shadows `0 1px 3px rgba(28,26,22,0.06), 0 1px 2px rgba(28,26,22,0.04)` (soft) and `0 2px 8px rgba(28,26,22,0.08), 0 1px 2px rgba(28,26,22,0.05)` (raised).
- **Motion:** only `rise` (0.32s), `settle` (0.45s, pinned region only), `breathe` (2.8s, connection dot only). Everything inside `@media (prefers-reduced-motion: reduce)` kill switch.
- **Typefaces (decision 2026-07-17): Claude desktop's type system.** Stacks name the exact commercial faces first and deliver legal stand-ins: display `'Copernicus', Georgia, ui-serif, serif`; UI `'Styrene B', 'Familjen Grotesk', -apple-system, BlinkMacSystemFont, sans-serif`. Only `familjen.woff2` is self-hosted (`docs/superpowers/specs/assets/familjen.woff2`, OFL); Georgia is a system font; **Styrene B and Copernicus files are commercial: never embed them unlicensed.** Scale: prose 16px/1.65, secondary UI 14px, captions 12px, serif display 20 to 22px. Never a font CDN link.
- **Expert-side dashboard (`index.html`, `app.js`, `viewer.js`, `styles.css`) is untouched.** Theme applies to `chat.html`/`chat.js` only.
- **The shared expert token never appears in any payload sent to customers.** There are no per-expert codes; identity is self-selected at dashboard login (org-trust decision 2026-07-17).
- Tests: `pnpm --filter <pkg> test` per package; `pnpm -r test` green before any merge.
- Commit style: match repo (`feat(relay): ...`, `fix(agent): ...`). Every commit message ends with the Co-Authored-By line per session rules.

---

## Wire Contracts (read first: every track builds against these)

### PublicExpertProfile: the only expert shape that ever crosses the wire

```ts
export interface PublicExpertProfile {
  id: string;                // "rohit"
  name: string;              // "Rohit Jain"
  photo: string;             // "/experts/rohit.jpg" (relay-served path)
  role: string;              // "Senior software engineer"
  companies: { logo?: string; label: string }[]; // logo is a relay-served path
  tag: string;               // "Code, payments & APIs"
  rating: number;            // 4.8
  fixesDelivered: number;    // 12
  linkedin?: string;         // full https URL
}
```

### Server→client additions (NOT zod-validated: additive, no schema change)

```ts
// on expert claim, to BOTH the agent socket and customer chat sockets:
{ type: "expert-joined", expertName: string, expert?: PublicExpertProfile }

// customer hello reply gains:
{ type: "hello-ok", status, expertName, history, activity,
  expert?: PublicExpertProfile,        // present when session is claimed
  bench: PublicExpertProfile[],        // full roster, always
  permissions: Permissions,            // granted scopes for the access row
  issue?: string,                      // current issue text
  issueEditedAt?: number, issueEditedBy?: "customer" | "expert" }

// after any accepted edit, to agent + expert + chat sockets:
{ type: "issue-updated", issue: string, by: "customer" | "expert", at: number }

// to an expert whose stale edit was refused:
{ type: "edit-rejected", reason: string, issue: string, at: number, by: string }
```

### Client→server additions (zod-validated: real schema changes, track E only)

```ts
// customerMessageSchema gains:
{ type: "edit-issue", text: string /* 1..2000 */ }

// expertMessageSchema gains:
{ type: "edit-issue", sessionId: string, text: string /* 1..2000 */,
  baseAt?: number /* issueEditedAt the expert last saw */ }

// and (Track R) the existing auth variant gains:
{ type: "auth", token, name, expertId?: string }
```

### Conflict rule (decided, do not re-litigate)

Last write wins. **Customer always beats expert:** an expert `edit-issue` whose
`baseAt` is older than a customer edit's `issueEditedAt` is rejected with
`edit-rejected`. Customer edits are never rejected.

### Identity model (decided 2026-07-17: keep it simple)

**No per-expert codes.** `GET_AN_EXPERT_EXPERT_TOKENS` stays exactly as today
(shared token, same login for everyone). Identity is **self-selected**: at
dashboard login the expert picks who they are from the roster, and the `auth`
message carries that choice. Trust model, stated plainly: every expert is a
member of the same organization, so self-selection is acceptable; anyone with
the shared token could claim any face. Revisit only if outside experts join.

```ts
// expertAuth (zod-validated) gains one optional field:
{ type: "auth", token: string, name: string, expertId?: string /* roster id */ }
```

---

## Parallelization Map

```
Phase 0 (main checkout, needs Pulkit's explicit commit approval)
  └─ P0: branch consumer-chat-v1 off main; commit plan + spec + assets

Phase 1: three worktrees off consumer-chat-v1, fully independent:
  ├─ wt-relay   branch feat/relay-roster   Tasks R1–R5   (apps/relay)
  ├─ wt-chat    branch feat/chat-rebuild   Tasks C1–C4   (apps/dashboard)
  └─ wt-agent   branch feat/agent-autoopen Tasks A1–A3   (packages/agent)
  Merge order into consumer-chat-v1: R, then C, then A (no file overlap;
  order only matters for clean e2e testing).

Phase 2: one worktree, after R+C merged:
  └─ wt-edit    branch feat/context-edit   Tasks E1–E4   (relay+dashboard+agent)

Phase 3: on consumer-chat-v1 directly:
  └─ I1–I2: e2e demo gate (GIF), docs
```

Worktree creation (executor runs, via superpowers:using-git-worktrees):

```bash
cd /Users/pulkitwalia/Programs/get-an-expert
git worktree add ../gae-wt-relay -b feat/relay-roster consumer-chat-v1
git worktree add ../gae-wt-chat  -b feat/chat-rebuild consumer-chat-v1
git worktree add ../gae-wt-agent -b feat/agent-autoopen consumer-chat-v1
# each worktree: pnpm install
```

**Do NOT touch the main checkout's branch (`eval-harness-v0`): it holds
uncommitted variant-F work in `packages/mcp-server/src/index.ts`.**

---

## Phase 0

### Task P0: Plan branch: DONE 2026-07-17 (approved and committed)

**Files:**
- Commit: `docs/superpowers/plans/2026-07-17-consumer-chat-v1.md`, `docs/superpowers/specs/2026-07-17-consumer-chat-visual-spec.html`, `docs/superpowers/specs/assets/{inigo.jpg,familjen.woff2}` (cormorant/hanken woff2 stay parked but are no longer used by the product)

- [ ] **Step 1:** `git branch consumer-chat-v1 main` (worktrees need the docs IN git; untracked files don't propagate)
- [ ] **Step 2:** In a temp worktree for that branch (`git worktree add ../gae-wt-plan consumer-chat-v1`), copy the docs/ tree in, `git add docs && git commit -m "docs: consumer-chat v1 plan + locked visual spec"`
- [ ] **Step 3:** `git ls-tree consumer-chat-v1 docs/ -r --name-only` → shows the plan, spec, and asset files.

---

## Phase 1, Track R: relay roster & identity (worktree `gae-wt-relay`)

### Task R1: Roster module

**Files:**
- Create: `apps/relay/src/roster.ts`
- Test: `apps/relay/src/roster.test.ts`

**Interfaces:**
- Produces: `PublicExpertProfile` (shape above), `ROSTER: readonly PublicExpertProfile[]`, `findExpert(id: string): PublicExpertProfile | undefined`

- [ ] **Step 1: Write the failing test**

```ts
// apps/relay/src/roster.test.ts
import { describe, expect, it } from "vitest";
import { ROSTER, findExpert } from "./roster";

describe("roster", () => {
  it("has six experts in the approved order", () => {
    expect(ROSTER.map((e) => e.id)).toEqual([
      "rohit", "aakash", "senjal", "inigo", "hardik", "pulkit",
    ]);
  });
  it("findExpert returns a profile by id and undefined for unknowns", () => {
    expect(findExpert("inigo")?.name).toBe("Iñigo Fernández");
    expect(findExpert("inigo")?.rating).toBe(4.8);
    expect(findExpert("inigo")?.fixesDelivered).toBe(6);
    expect(findExpert("nobody")).toBeUndefined();
  });
  it("never contains anything secret-shaped", () => {
    const json = JSON.stringify(ROSTER);
    expect(json).not.toMatch(/token|code|secret|password/i);
  });
});
```

- [ ] **Step 2:** `pnpm --filter get-an-expert-relay test roster` → FAIL (module not found)
- [ ] **Step 3: Implement**: data is verbatim from the locked spec (which took it from get-an-expert-web):

```ts
// apps/relay/src/roster.ts
/**
 * The public expert roster. Everything here is public marketing data
 * (mirrors get-an-expert-web); join codes NEVER live here: they exist
 * only in GET_AN_EXPERT_EXPERT_TOKENS as <code>:<id> pairs.
 * Ratings and fix counts are hardcoded by decision (2026-07-17) until a
 * review system exists.
 */
export interface PublicExpertProfile {
  id: string;
  name: string;
  photo: string;
  role: string;
  companies: { logo?: string; label: string }[];
  tag: string;
  rating: number;
  fixesDelivered: number;
  linkedin?: string;
}

export const ROSTER: readonly PublicExpertProfile[] = [
  {
    id: "rohit", name: "Rohit Jain", photo: "/experts/rohit.jpg",
    role: "Senior software engineer",
    companies: [
      { logo: "/experts/amazon.jpg", label: "Amazon" },
      { logo: "/experts/square.jpg", label: "Square" },
    ],
    tag: "Code, payments & APIs", rating: 4.8, fixesDelivered: 12,
    linkedin: "https://www.linkedin.com/in/rohit-jain-343437187/",
  },
  {
    id: "aakash", name: "Aakash Sangani", photo: "/experts/aakash.jpg",
    role: "Senior full-stack cloud engineer",
    companies: [
      { logo: "/experts/fidelity.jpg", label: "Fidelity" },
      { label: "IIT Kharagpur" },
    ],
    tag: "Deploys & infrastructure", rating: 4.7, fixesDelivered: 9,
    linkedin: "https://www.linkedin.com/in/aakash-sangani/",
  },
  {
    id: "senjal", name: "Senjal Pandharpatte", photo: "/experts/senjal.jpg",
    role: "Senior UX designer",
    companies: [
      { logo: "/experts/lightbox.jpg", label: "LightBox" },
      { logo: "/experts/rit.jpg", label: "RIT" },
    ],
    tag: "Design & user experience", rating: 4.8, fixesDelivered: 14,
    linkedin: "https://www.linkedin.com/in/senjalpandharpatte/",
  },
  {
    id: "inigo", name: "Iñigo Fernández", photo: "/experts/inigo.jpg",
    role: "AI engineer & product owner",
    companies: [
      { logo: "/experts/mck.jpg", label: "McKinsey & Company" },
      { logo: "/experts/hbs.jpg", label: "Harvard Business School" },
    ],
    tag: "AI, RAG & agents", rating: 4.8, fixesDelivered: 6,
    linkedin: "https://www.linkedin.com/in/inigofernandezguerraabdala/",
  },
  {
    id: "hardik", name: "Hardik Acharya", photo: "/experts/hardik.jpg",
    role: "Senior security operations analyst",
    companies: [{ logo: "/experts/mck.jpg", label: "McKinsey & Company" }],
    tag: "Security & compliance", rating: 4.6, fixesDelivered: 7,
    linkedin: "https://www.linkedin.com/in/acharyahardik/",
  },
  {
    id: "pulkit", name: "Pulkit Walia", photo: "/experts/pulkit.jpg",
    role: "Business & growth leader",
    companies: [
      { logo: "/experts/uc.jpg", label: "Urban Company" },
      { logo: "/experts/bessemer.jpg", label: "Bessemer" },
      { logo: "/experts/hbs.jpg", label: "Harvard Business School" },
    ],
    tag: "GTM & business automations", rating: 4.7, fixesDelivered: 10,
    linkedin: "https://www.linkedin.com/in/pulkitwalia/",
  },
];

export function findExpert(id: string): PublicExpertProfile | undefined {
  return ROSTER.find((e) => e.id === id);
}
```

- [ ] **Step 4:** `pnpm --filter get-an-expert-relay test roster` → PASS
- [ ] **Step 5:** `git add apps/relay/src/roster.ts apps/relay/src/roster.test.ts && git commit -m "feat(relay): public expert roster with the six launch profiles"`

### Task R2: Auth carries a self-selected roster identity

**Files:**
- Modify: `apps/relay/src/protocol.ts`: `expertAuth` gains `expertId: z.string().min(1).max(40).optional()`
- Modify: `apps/relay/src/server.ts`: `ExpertConn` (line ~51) gains `profile?: PublicExpertProfile`; auth handler (~line 441)
- Test: extend `apps/relay/src/server.test.ts` (follow its existing ws helpers)

**Interfaces:**
- Consumes: `findExpert` (R1)
- Produces: `experts.get(ws).profile` for R4; `auth-ok` becomes `{ type: "auth-ok", name, expert? }`

- [ ] **Step 1: Failing tests**

```ts
it("auth with an expertId adopts the roster identity", async () => {
  // send { type: "auth", token: SHARED, name: "Whoever", expertId: "rohit" }
  // expect { type: "auth-ok", name: "Rohit Jain",
  //          expert: expect.objectContaining({ id: "rohit" }) }
});
it("auth without expertId keeps today's self-declared name", async () => {
  // { type: "auth", token: SHARED, name: "Whoever" } → auth-ok name "Whoever", no expert
});
it("auth with an unknown expertId falls back to the declared name", async () => {
  // expertId "nobody" → auth-ok name "Whoever", no expert (and no crash)
});
```

- [ ] **Step 2:** `pnpm --filter get-an-expert-relay test server` → FAIL
- [ ] **Step 3: Implement.** Protocol: add the optional field. Server auth case:
`const profile = msg.expertId ? findExpert(msg.expertId) : undefined;`
`experts.set(ws, { name: profile?.name ?? msg.name, profile, claimed: new Set() });`
`sendTo(ws, { type: "auth-ok", name: profile?.name ?? msg.name, expert: profile });`
Token checking is UNCHANGED (`options.expertTokens.some((t) => tokenEquals(t, msg.token))`).
- [ ] **Step 4:** run → PASS (whole file)
- [ ] **Step 5:** commit `feat(relay): expert self-selects a roster identity at auth`

### Task R3: Roster endpoint + dashboard identity picker

**Files:**
- Modify: `apps/relay/src/server.ts`: HTTP handler: serve `GET /api/roster` (JSON `ROSTER`) before the static fallback
- Modify: `apps/dashboard/public/index.html` + `apps/dashboard/public/app.js`: login block
- Test: extend `apps/relay/src/server.test.ts` (HTTP request against the test server)

**Interfaces:**
- Consumes: `ROSTER` (R1)
- Produces: `GET /api/roster` → `200 application/json`, body `PublicExpertProfile[]`; dashboard `auth` messages now include `expertId` when a face was picked

- [ ] **Step 1: Failing test**

```ts
it("GET /api/roster returns the six public profiles and nothing secret", async () => {
  // http GET against the relay's server → 200, json array length 6,
  // JSON.stringify(body) does not contain the configured token
});
```

- [ ] **Step 2:** run → FAIL (404)
- [ ] **Step 3: Implement relay side**: in the HTTP request handler, before `serveStatic`:

```ts
if (url.pathname === "/api/roster") {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(ROSTER));
  return;
}
```

- [ ] **Step 4:** run → PASS
- [ ] **Step 5: Dashboard picker.** In the login card (`index.html`), after the
token field, add a "Who are you?" grid: fetch `/api/roster`, render each expert
as photo + name + tag (dashboard's own dark theme: the consumer theme does NOT
apply here); clicking selects and highlights one. Keep the existing free-text
name input, relabeled "Someone else", as the fallback when no face is picked.
`app.js` includes `expertId` in the `auth` message when a face is selected and
shows the `auth-ok` name in the header (so picking Rohit greets you as Rohit).
- [ ] **Step 6:** Manual check: token + pick Iñigo → header shows "Iñigo Fernández"; token + typed name only → header shows the typed name.
- [ ] **Step 7:** commit `feat(dashboard): who-are-you roster picker at expert login`

### Task R4: Claim carries the profile; hello-ok carries card/bench/scopes

**Files:**
- Modify: `apps/relay/src/sessions.ts`: `Session` gains `expertId?: string`; `claim(id, expertName, expertId?)` stores it; `release` clears it
- Modify: `apps/relay/src/server.ts`: claim handler (~line 457) and customer `hello` handler (~line 315)
- Modify: `apps/relay/src/persistence.ts`: `PersistedSession` gains `expertId?: string` (serialize + hydrate)
- Test: extend `apps/relay/src/sessions.test.ts`, `server.test.ts`, `persistence.test.ts`

**Interfaces:**
- Consumes: `ROSTER`, `findExpert`, `conn.profile` (R2)
- Produces (wire): `expert-joined` + `hello-ok` payloads exactly as in Wire Contracts. Track C builds against these.

- [ ] **Step 1: Failing tests**

```ts
// sessions.test.ts
it("claim stores expertId and release clears it", () => {
  const { session } = store.create({ customerName: "c", projectDir: "/p" });
  store.claim(session.id, "Rohit Jain", "rohit");
  expect(store.get(session.id)?.expertId).toBe("rohit");
  store.release(session.id);
  expect(store.get(session.id)?.expertId).toBeUndefined();
});

// server.test.ts
it("claim fans the full profile out to agent and chat sockets", async () => {
  // roster-bound expert claims; both the agent ws and a customer chat ws
  // receive { type: "expert-joined", expertName: "Rohit Jain",
  //           expert: expect.objectContaining({ photo: "/experts/rohit.jpg" }) }
});
it("hello-ok includes bench, permissions, issue, and expert when claimed", async () => {
  // customer hello on a claimed session →
  // bench: 6 entries, permissions object, issue text, expert.id === "rohit"
});
it("hello-ok bench never includes token material", async () => {
  // JSON.stringify(reply) has no match for the configured token strings
});
```

- [ ] **Step 2:** run → FAIL
- [ ] **Step 3: Implement.** Claim: `store.claim(msg.sessionId, conn.name, conn.profile?.id)`; both `expert-joined` sends gain `expert: conn.profile`. Hello: after the existing `hello-ok` object, add `expert: session.expertId ? findExpert(session.expertId) : undefined, bench: ROSTER, permissions: session.permissions, issue: session.issue`. Persistence: add `expertId: session.expertId` to serialize; pass through on hydrate.
- [ ] **Step 4:** `pnpm --filter get-an-expert-relay test` → all PASS
- [ ] **Step 5:** commit `feat(relay): expert profile on claim + card/bench/scopes in hello-ok`

### Task R5: Static assets: photos, logos, fonts, MIME

**Files:**
- Modify: `apps/relay/src/static.ts`: MIME map (line ~5): add `".jpg": "image/jpeg", ".jpeg": "image/jpeg"`
- Create (binary copies): `apps/dashboard/public/experts/*.jpg` (6 faces + 8 logos), `apps/dashboard/public/vendor/fonts/{cormorant.woff2,hanken.woff2}`
- Test: extend `apps/relay/src/server.test.ts` or `static` tests if present; otherwise add `apps/relay/src/static.test.ts`

- [ ] **Step 1: Failing test**

```ts
// static.test.ts: serve a temp dir containing x.jpg, assert 200 + image/jpeg
it("serves jpg with an image/jpeg content type", async () => { /* ... */ });
```

- [ ] **Step 2:** run → FAIL (octet-stream)
- [ ] **Step 3: MIME fix + copy assets:**

```bash
W=/Users/pulkitwalia/Programs/get-an-expert-web/assets
D=apps/dashboard/public
mkdir -p $D/experts $D/vendor/fonts
for f in rohit aakash senjal hardik pulkit amazon square fidelity mck lightbox uc bessemer hbs rit; do cp $W/$f.jpg $D/experts/; done
cp docs/superpowers/specs/assets/inigo.jpg $D/experts/
cp docs/superpowers/specs/assets/familjen.woff2 $D/vendor/fonts/
```

- [ ] **Step 4:** run → PASS
- [ ] **Step 5:** commit `feat(dashboard): expert photos, company logos, brand fonts + jpg MIME`

---

## Phase 1, Track C: consumer chat rebuild (worktree `gae-wt-chat`)

Track C builds against the Wire Contracts section with hand-written fixture
objects; it does not need Track R running.

### Task C1: Testable chat logic module

**Files:**
- Create: `apps/dashboard/public/chat-core.js` (classic browser script, publishes `globalThis.GaeChat`: same pattern as `viewer.js`)
- Test: `apps/dashboard/tests/chat-core.test.ts`
- Modify: `apps/dashboard/public/chat.html`: add `<script src="chat-core.js"></script>` before `chat.js`

**Interfaces:**
- Produces (on `GaeChat`):
  - `parseLink(hash: string): { sessionId, token } | undefined` (moved verbatim from chat.js so it becomes tested)
  - `initials(name: string): string`: "Iñigo Fernández" → "IF"
  - `validProfile(p: unknown): boolean`: guards a `PublicExpertProfile` off the wire (id, name, photo, role strings; rating number; companies array). Render code refuses invalid profiles.
  - `firstName(name: string): string`
  - `reduce(state, msg): state`: pure state machine: `{ phase: "waiting"|"claimed"|"ended"|"failed", expert?, bench, permissions?, issue?, feed: [...] }` transitioned by `hello-ok`, `hello-failed`, `chat`, `activity`, `expert-joined`, `expert-left`, `session-ended` messages. Rendering reads state; the ws handler only dispatches.

- [ ] **Step 1: Failing tests**: real cases per function, e.g.:

```ts
import "../public/chat-core.js";
const { parseLink, initials, validProfile, reduce, firstName } = (globalThis as any).GaeChat;

it("reduce: expert-joined moves waiting → claimed and stores the profile", () => {
  const s0 = reduce(undefined, { type: "hello-ok", status: "waiting", history: [], activity: [], bench: [] });
  const s1 = reduce(s0, { type: "expert-joined", expertName: "Rohit Jain", expert: FIXTURE_ROHIT });
  expect(s1.phase).toBe("claimed");
  expect(s1.expert.id).toBe("rohit");
});
it("reduce: expert-left returns to waiting and clears the card", () => { /* ... */ });
it("reduce: a claimed hello-ok restores the card after reload", () => { /* ... */ });
it("validProfile rejects a profile missing photo", () => { /* ... */ });
it("initials handles single and accented names", () => {
  expect(initials("Iñigo Fernández")).toBe("IF");
  expect(initials("Cher")).toBe("C");
});
```

`FIXTURE_ROHIT` is written out in the test file exactly per Wire Contracts.

- [ ] **Step 2:** `pnpm --filter get-an-expert-dashboard test chat-core` → FAIL
- [ ] **Step 3:** Implement `chat-core.js` (pure logic only, no DOM).
- [ ] **Step 4:** run → PASS
- [ ] **Step 5:** commit `feat(dashboard): tested chat state core (GaeChat)`

### Task C2: chat.html: brand theme

**Files:**
- Modify: `apps/dashboard/public/chat.html` (full `<style>` replacement + body skeleton additions)

Port the `.device`-scoped CSS from the visual spec 1:1, renaming `.c-*`
selectors to the page's real elements. Mapping (spec → page):

| Spec | Page |
|---|---|
| `.device` tokens (`--c-*`, `--r-*`, shadows, `--ease-out`) | `:root` |
| `.c-top`, `.c-logo` | `.topbar`, `.topbar .logo` (serif logo "get an *expert*") |
| `.c-banner` (+ `.muted`) | `#banner` (`.ok` variant deleted: claimed state banner is the default sage-soft) |
| `.c-pinned`, `.c-pin-label`, `.c-card`, `.c-photo`, `.c-cbody`, `.c-nrow`, `.c-name`, `.c-li`, `.c-rate`, `.c-role`, `.c-cos`, `.c-tagrow`, `.c-tag`, `.c-fixes`, `.c-mini` | new `#pinned` region between `#banner` and `#messages` |
| `.c-access` details/summary + `.c-scope`, `.c-endbtn` | new `#access` inside `#pinned` |
| `.c-ctx*`, `.c-chips`, `.c-chip`, `.c-btn`, `.c-edit`, `.c-saved` | new context card rendered into `#messages` while waiting; `#ctx-mini` row in `#pinned` when claimed |
| `.c-bench*`, `.c-faces`, `.c-face` | new bench card (waiting only) |
| `.c-steps*`, `.c-foot` | new steps card (waiting only) |
| `.c-msg`, `.c-bub`, `.c-act` | existing `.msg`/`.bubble`/`.msg.activity` (restyled; activity = bronze pill row, NO left border) |
| `.c-composer`, `.c-input`, `.c-send` | existing `.composer` (pill input, focus ring, hover/active) |
| `@keyframes rise/settle/breathe` + reduced-motion kill | verbatim |

Fonts via self-hosted files (NOT data URIs: this is a served page):

```css
/* Claude type system: exact commercial names first, legal faces delivered.
   Never embed Styrene B / Copernicus files without a license. */
@font-face { font-family: 'Familjen Grotesk'; src: url(/vendor/fonts/familjen.woff2) format('woff2'); font-weight: 400 700; font-display: swap; }
/* stacks used by the page:
   --cd-serif: 'Copernicus', Georgia, ui-serif, serif;
   --cd-ui: 'Styrene B', 'Familjen Grotesk', -apple-system, BlinkMacSystemFont, sans-serif; */
```

**Also:** replace the file's header comment ("palette copied from the
dashboard theme on purpose: do not link styles.css") with:

```
Standalone customer page, deliberately NOT the dashboard theme: the customer
is a client, the dashboard is an operator tool. Brand palette + type follow
docs/superpowers/specs/2026-07-17-consumer-chat-visual-spec.html. Still no
styles.css link: this page stays self-contained.
```

- [ ] **Step 1:** Port CSS + skeleton per table.
- [ ] **Step 2:** Static check: open `chat.html#test.token` via `python3 -m http.server` in `apps/dashboard/public` → fatal-card state renders in brand theme, fonts load (Network tab: familjen.woff2 200; serif renders as Georgia unless Copernicus is installed), zero console errors.
- [ ] **Step 3:** `grep -c '-' apps/dashboard/public/chat.html` → 0.
- [ ] **Step 4:** commit `feat(dashboard): consumer chat brand theme (locked visual spec)`

### Task C3: chat.js: render the new states

**Files:**
- Modify: `apps/dashboard/public/chat.js`
- Test: extend `apps/dashboard/tests/chat-core.test.ts` (any new pure logic goes in chat-core, not chat.js)

Rebuild rendering on top of `GaeChat.reduce`. Structure (mirrors the spec's
prototype JS, which is the reference implementation):

- `render(state)`: single entry point after every dispatch:
  - `waiting`: hide `#pinned`; banner = waiting copy; `#messages` gets context card, steps card, bench card (in that order) + any queued chat feed.
  - `claimed`/`working`: show `#pinned` (label "Your expert", card via `renderExpertCard`, `#ctx-mini` issue row with Edit, access disclosure closed); banner = `{firstName} is here and working on your machine.`; feed renders messages + bronze activity rows.
  - `ended`: pinned collapses to the mini row (`{name} worked on this session.`); banner muted; composer disabled (`Session ended`), conn label ENDED.
- `renderExpertCard(profile)`: guard with `GaeChat.validProfile`; photo `<img>` with `alt=""`, LinkedIn anchor only when `profile.linkedin` (never a dead icon), rating `★ {rating}`, `{fixesDelivered} fixes delivered`, companies row with logo images + labels, single tag pill.
- `renderBench(list)`: heading "Experts on bench", right label "100+ other experts", 3×2 grid, each face: photo, first name, tag short-form, `★ rating` + LinkedIn link.
- Bench short label: derive from `tag` (text before the first `&`/`,`, trimmed, e.g. "Code" from "Code, payments & APIs")? **No: decided:** add `short` NOWHERE; render the full `tag` at 8px as in spec (`.c-face .sb` uses full tag, CSS truncates with `text-overflow: ellipsis; white-space: nowrap; max-width: 100%`). One field fewer to drift.
- All copy strings verbatim from the spec's copy deck (context card note, steps, walk-away line, banners).
- Context card in C3 is **display-only** (issue text + chips + disabled-looking Edit affordance is NOT shown yet). Edit ships in Track E; render the card without action buttons until then.

- [ ] **Step 1:** Any new pure helpers → failing tests in chat-core.test.ts first.
- [ ] **Step 2:** Implement rendering.
- [ ] **Step 3:** Manual state walkthrough with a stub ws (paste in DevTools: dispatch fixture `hello-ok` waiting → `expert-joined` → `activity` → `session-ended`; screenshot each). Verify the card entrance animation replays on claim.
- [ ] **Step 4:** `pnpm --filter get-an-expert-dashboard test` → PASS; em-dash grep → 0.
- [ ] **Step 5:** commit `feat(dashboard): expert card, bench, context and access states in customer chat`

### Task C4: Guard the existing chat tests

- [ ] **Step 1:** `pnpm --filter get-an-expert-dashboard test && pnpm --filter get-an-expert-relay test` (relay unchanged here: confirms no cross-package breakage from public/ changes)
- [ ] **Step 2:** commit anything outstanding; `git log --oneline consumer-chat-v1..feat/chat-rebuild` reads as a clean narrative.

---

## Phase 1, Track A: agent auto-open + status card (worktree `gae-wt-agent`)

### Task A1: `openUrl`

**Files:**
- Create: `packages/agent/src/open-url.ts`
- Test: `packages/agent/src/open-url.test.ts` (mirror the DI style of `browser-auto.test.ts`: inject a fake spawner)

**Interfaces:**
- Produces: `openUrl(url: string, opts: { relayOrigin: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; spawner?: SpawnFn }): boolean`
- Consumed by: A2

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { openUrl } from "./open-url";

const URL_OK = "https://relay.example.com/chat#abc.def";
const base = { relayOrigin: "https://relay.example.com", env: {} as NodeJS.ProcessEnv };

it("darwin uses open with the url as its own argv entry", () => {
  const spawner = vi.fn(() => ({ unref: vi.fn() }));
  expect(openUrl(URL_OK, { ...base, platform: "darwin", spawner })).toBe(true);
  expect(spawner).toHaveBeenCalledWith("open", [URL_OK],
    expect.objectContaining({ detached: true, stdio: "ignore", shell: false }));
});
it("win32 uses cmd /c start with an empty title arg", () => { /* ["cmd", ["/c","start","",URL_OK]] */ });
it("linux uses xdg-open only when a display exists", () => { /* env.DISPLAY="::1" → xdg-open; env {} → false, no spawn */ });
it("refuses a url on a different origin", () => {
  expect(openUrl("https://evil.example.com/chat#a.b", { ...base, platform: "darwin", spawner: vi.fn() })).toBe(false);
});
it("refuses non-http(s) schemes", () => { /* "file:///etc/passwd" → false */ });
it("GET_AN_EXPERT_NO_AUTO_OPEN=1 short-circuits", () => { /* → false, spawner not called */ });
it("skips over SSH without a TTY", () => { /* env.SSH_CONNECTION set → false */ });
it("never throws when the spawner throws", () => {
  const spawner = vi.fn(() => { throw new Error("ENOENT"); });
  expect(openUrl(URL_OK, { ...base, platform: "darwin", spawner })).toBe(false);
});
```

- [ ] **Step 2:** run → FAIL
- [ ] **Step 3: Implement**

```ts
// packages/agent/src/open-url.ts
import { spawn } from "node:child_process";

type SpawnFn = typeof spawn;

/**
 * Best-effort: open the customer chat page in the default browser. Security
 * posture (this package grants an outsider machine access, so the spawn
 * surface stays minimal: approved by Rohit 2026-07-17):
 *   - fixed argv per platform, never a shell string, shell: false
 *   - only http(s) URLs on the configured relay origin
 *   - opt-out via GET_AN_EXPERT_NO_AUTO_OPEN; skipped over SSH / headless
 * Returns whether a spawn was attempted successfully; the chat URL is ALWAYS
 * also printed by the caller, so failure here costs one click, never access.
 */
export function openUrl(
  url: string,
  opts: {
    relayOrigin: string;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    spawner?: SpawnFn;
  },
): boolean {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const spawner = opts.spawner ?? spawn;

  if (env.GET_AN_EXPERT_NO_AUTO_OPEN) return false;
  if (env.SSH_CONNECTION && !process.stdout.isTTY) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.origin !== opts.relayOrigin) return false;

  let cmd: string;
  let args: string[];
  if (platform === "darwin") {
    cmd = "open"; args = [url];
  } else if (platform === "win32") {
    cmd = "cmd"; args = ["/c", "start", "", url];
  } else {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
    cmd = "xdg-open"; args = [url];
  }

  try {
    const child = spawner(cmd, args, { detached: true, stdio: "ignore", shell: false });
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4:** run → PASS
- [ ] **Step 5:** commit `feat(agent): hardened best-effort browser open for the chat url`

### Task A2: Wire into request flow + new copy

**Files:**
- Modify: `packages/agent/src/index.ts`: in the `request_expert_help` success path, after the session registers and `session.chatUrl` exists
- Modify: `packages/agent/src/messages.ts`: `queueMessage`
- Test: extend `packages/agent/src/messages.test.ts`

**Interfaces:**
- Consumes: `openUrl` (A1); relay origin from the agent's existing config (`config.ts` relay URL → derive http origin the same way `chat-url.ts` does)
- Produces: `queueMessage(chatUrl?: string, opened?: boolean): string`

- [ ] **Step 1: Failing tests**

```ts
it("queueMessage when a tab opened", () => {
  expect(queueMessage("https://r.example/chat#a.b", true)).toBe(
    "Opening your expert chat now. Your request is queued and stays queued if you close it. Link: https://r.example/chat#a.b",
  );
});
it("queueMessage when it could not open", () => {
  expect(queueMessage("https://r.example/chat#a.b", false)).toBe(
    "Your request is queued. Open your expert chat here: https://r.example/chat#a.b",
  );
});
it("queueMessage with no chat url keeps a plain queue line", () => {
  expect(queueMessage(undefined)).toBe(
    "You're in the expert queue. Check back anytime with expert_status.",
  );
});
```

- [ ] **Step 2:** run → FAIL
- [ ] **Step 3:** Implement copy; in `index.ts`, `const opened = chatUrl ? openUrl(chatUrl, { relayOrigin }) : false;` inside try/catch (a throw must never fail the request), pass `opened` into `queueMessage`.
- [ ] **Step 4:** `pnpm --filter get-an-expert-agent test` → PASS; em-dash grep on messages.ts → 0.
- [ ] **Step 5:** commit `feat(agent): auto-open the chat page at queue time, one-line queue copy`

### Task A3: Profile-aware `expert_status` text card

**Files:**
- Modify: `packages/agent/src/relay-client.ts`: `expert-joined` case (~line 203) forwards the whole message, not just the name
- Modify: `packages/agent/src/agent-session.ts`: store `#expertProfile?: PublicExpertProfile` (type imported locally: define a minimal structural type in `types.ts`, do NOT import from apps/relay across the workspace boundary); expose in `status()`
- Modify: `packages/agent/src/messages.ts`: `statusMessage` connected case gains an optional profile line
- Test: `messages.test.ts`, `agent-session.test.ts`

**Interfaces:**
- Produces: `statusMessage(state, expertName?, profile?)`: connected with profile renders:
  `"Rohit Jain (Senior software engineer, ★ 4.8, 12 fixes delivered) is working on your machine right now, within the scopes you approved [...unchanged tail...]"`

- [ ] **Step 1:** failing tests for the new line (exact string) + profile plumbing.
- [ ] **Step 2:** run → FAIL
- [ ] **Step 3:** implement (guard: any missing field → fall back to today's name-only line; never render "undefined").
- [ ] **Step 4:** `pnpm --filter get-an-expert-agent test` → PASS
- [ ] **Step 5:** commit `feat(agent): expert_status reports who the expert actually is`

---

## Phase 2, Track E: context card editing (worktree `gae-wt-edit` off consumer-chat-v1 AFTER R+C merge)

### Task E1: Protocol + relay handling

**Files:**
- Modify: `apps/relay/src/protocol.ts`: add `edit-issue` variants to `customerMessageSchema` and `expertMessageSchema` per Wire Contracts
- Modify: `apps/relay/src/sessions.ts`: `Session` gains `issueEditedAt?: number; issueEditedBy?: "customer" | "expert"`; new `setIssue(id, text, by): Session`
- Modify: `apps/relay/src/server.ts`: customer + expert `edit-issue` cases; `hello-ok` gains `issueEditedAt/issueEditedBy`
- Modify: `apps/relay/src/persistence.ts`: persist the two new fields
- Test: `protocol.test`-style cases inside `server.test.ts` + `sessions.test.ts`

- [ ] **Step 1: Failing tests**

```ts
it("customer edit-issue updates, redacts, and broadcasts issue-updated", async () => {
  // customer sends { type: "edit-issue", text: "new text sk-ant-xxx" }
  // agent ws + expert ws + other chat ws all receive issue-updated
  // with the secret redacted; session.issueEditedBy === "customer"
});
it("expert edit with a stale baseAt against a customer edit is rejected", async () => {
  // customer edits at t1; expert sends edit-issue baseAt: t0 (< t1)
  // expert receives edit-rejected carrying the current issue; session unchanged
});
it("expert edit with current baseAt wins normally", async () => { /* LWW */ });
```

- [ ] **Step 2:** run → FAIL
- [ ] **Step 3:** Implement. Reuse the relay's existing `redactText` import (chat messages already pass through it: same treatment for issue text). Broadcast `issue-updated` via the existing fan-out helpers.
- [ ] **Step 4:** `pnpm --filter get-an-expert-relay test` → PASS
- [ ] **Step 5:** commit `feat(relay): two-way issue editing, customer always wins`

### Task E2: Customer chat UI edit flow

**Files:**
- Modify: `apps/dashboard/public/chat-core.js`: `reduce` handles `issue-updated` + `edit-rejected`; new pure `editPayload(text): { type, text } | undefined` (trim, 1..2000)
- Modify: `apps/dashboard/public/chat.js`: context card gains Edit → textarea → Save/Cancel (Esc cancels), saved-state line "Updated. The expert sees this now."; claimed-state `#ctx-mini` Edit opens the same editor
- Test: chat-core.test.ts

- [ ] Steps: failing reduce/editPayload tests → implement → manual walkthrough (edit while waiting, edit while claimed, receive an expert `issue-updated`) → `pnpm --filter get-an-expert-dashboard test` → commit `feat(dashboard): editable context card`

### Task E3: Expert dashboard minimal edit affordance

**Files:**
- Modify: `apps/dashboard/public/app.js`: the session header shows the issue; add an Edit control posting `{ type: "edit-issue", sessionId, text, baseAt }` and an `edit-rejected` toast ("The customer updated this while you were editing; here is their version.")
- Styling: dashboard theme (dark), NOT the consumer theme.

- [ ] Steps: implement → manual check both directions with two browser windows → commit `feat(dashboard): expert-side issue editing with stale-edit refusal`

### Task E4: Agent hears issue updates, rebuilds CONTEXT.md

**Files:**
- Modify: `packages/agent/src/relay-client.ts`: forward `issue-updated`
- Modify: `packages/agent/src/agent-session.ts`: `#issue = msg.issue`; call the existing context rebuild path (`context.ts` `buildContextMarkdown` writer) so `.get-an-expert/CONTEXT.md` reflects the edit
- Test: `agent-session.test.ts`: an `issue-updated` message updates `status().issue` and triggers one rebuild (spy on the writer)

- [ ] Steps: failing test → implement → `pnpm --filter get-an-expert-agent test` → commit `feat(agent): context file follows issue edits`

---

## Phase 3: integration on `consumer-chat-v1`

### Task I1: Merge + full suite

- [ ] `git merge feat/relay-roster && git merge feat/chat-rebuild && git merge feat/agent-autoopen` (then Phase 2 merged after its tasks)
- [ ] `pnpm install && pnpm -r test` → green
- [ ] `grep -rn '-' apps/dashboard/public packages/agent/src/messages.ts apps/relay/src/roster.ts` → nothing

### Task I2: End-to-end demo gate (the GIF Pulkit approves)

- [ ] Terminal 1: `GET_AN_EXPERT_EXPERT_TOKENS="demo1" pnpm --filter get-an-expert-relay dev` (or the package's start script)
- [ ] Terminal 2: run `packages/agent/examples/local-demo.ts` pointed at the local relay → **a browser tab opens by itself**; the returned message is the new one-line copy with the link
- [ ] The opened page shows: waiting banner, context card with the issue, steps, bench with 6 real faces + ratings + LinkedIn links
- [ ] Expert dashboard: auth with `demo1`, pick Rohit on the who-are-you grid, claim → **Rohit's full card settles in** on the customer page
- [ ] Edit the issue from the customer page → expert header updates; edit from the expert → customer card updates; race it → customer wins
- [ ] Reload the customer tab mid-session → card, scopes, issue all survive
- [ ] End session → card collapses to the mini row, composer disables
- [ ] `GET_AN_EXPERT_NO_AUTO_OPEN=1` re-run → no tab, link still printed
- [ ] Record the whole flow as a GIF (claude-in-chrome `gif_creator`, name `consumer-chat-v1-demo.gif`), publish stills/GIF for Pulkit's demo gate. **No merge to main before his approval.**

---

## Kickoff: two parallel sessions (chosen mode)

Fresh windows, one worktree each, subagent-driven inside each session.

**Round 1 (parallel):**

```bash
# Session A (relay + roster + picker)
cd /Users/pulkitwalia/Programs/get-an-expert
git worktree add ../gae-wt-relay -b feat/relay-roster consumer-chat-v1
cd ../gae-wt-relay && pnpm install && claude
# paste into the session:
#   Execute Track R (Tasks R1 to R5) of docs/superpowers/plans/2026-07-17-consumer-chat-v1.md
#   using superpowers:subagent-driven-development. Work only in this worktree.
#   Read Global Constraints and Wire Contracts first. Stop after R5 and report.

# Session B (consumer chat rebuild)
cd /Users/pulkitwalia/Programs/get-an-expert
git worktree add ../gae-wt-chat -b feat/chat-rebuild consumer-chat-v1
cd ../gae-wt-chat && pnpm install && claude
#   Execute Track C (Tasks C1 to C4) of docs/superpowers/plans/2026-07-17-consumer-chat-v1.md
#   using superpowers:subagent-driven-development. Work only in this worktree.
#   The visual spec is docs/superpowers/specs/2026-07-17-consumer-chat-visual-spec.html.
#   Stop after C4 and report.
```

**Between rounds:** merge `feat/relay-roster` then `feat/chat-rebuild` into
`consumer-chat-v1`; `pnpm -r test` green.

**Round 2 (parallel):** Session A → `../gae-wt-edit -b feat/context-edit`
(Track E). Session B → `../gae-wt-agent -b feat/agent-autoopen` (Track A -
independent, could also start during Round 1 if a third session is open).

**Finish:** merge E and A, run Phase 3 (I1, I2 demo gate GIF) in one session.
No merge to main before Pulkit approves the GIF.

## Pending / prerequisites (Pulkit)

1. ~~P0 commit approval~~ **DONE 2026-07-17**: `consumer-chat-v1` branch carries the plan, spec, and assets.
2. **Deploy env is unchanged** (shared token as today). Identity is self-selected at login by decision; revisit only if outside experts join.
3. **Iñigo has no card on get-an-expert-web**: site parity task, separate repo, his data is in this plan.
4. **eval-harness-v0 variant-F work is still uncommitted** in the main checkout. Worktrees don't touch it, but it remains one careless checkout from gone.

## Deferred by decision

Dark-mode toggle; live "on call" presence; specialties list per expert (Iñigo's four stay compressed into one tag); typing indicator; join sound; push notification; problem-summary-before-work card (the pinned region is already a card list, so it slots in later); diff/PR link in the post-session summary.

## Optional Claude-native polish (small, post-v1, pick any)

- Dynamic tab title on claim: `document.title = "● Rohit joined: get an expert"` (attention cue without sound; clear it on focus).
- `Esc` cancels the context editor; `Enter` already sends chat.
- Timestamp grouping: suppress the meta row when the previous message is the same author within 3 minutes (quieter feed, very Claude).

## Self-review notes

- Spec coverage: invocation copy + auto-open (A1–A2), status card (A3), roster/identity/claim/hello (R1–R4), assets+MIME (R5), theme (C2), card/bench/steps/access states (C3), context edit both directions + conflict rule + CONTEXT.md (E1–E4), demo gates (I2). Bench "100+ other experts" label and all copy live in the visual spec, referenced by C2/C3.
- Type consistency: `PublicExpertProfile` defined once in roster.ts; agent uses a minimal structural copy in `types.ts` (documented in A3) because apps/relay is not a workspace dependency of packages/agent.
- No placeholders: every task carries real code or an exact porting map to the committed visual spec.
