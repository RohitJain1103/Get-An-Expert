# Get-An-Expert — Invocation Eval Harness v0 (Build Spec)

**Audience:** Claude Code, running inside the `Get-An-Expert` repo (main branch = published npm). Rohit reviews/cherry-picks.
**Date:** 2026-07-14 · **Owner:** Pulkit · **Status:** approved for build

---

## 0. Kickoff prompt (paste this into Claude Code in the repo root)

> Read `eval/SPEC.md` (this file) end to end. Then read `packages/mcp-server/` (tool definitions + server instructions) and `plugins/claude-code/` (Stop-hook detection logic) before writing any code. Build exactly what Section 3–7 specifies, in the order of Section 8. Respect Section 9 (what NOT to build) strictly. Ask me before deviating. Start by creating the file tree and the dry-run mode; do not make API calls until dry-run passes.

Save this spec into the repo as `eval/SPEC.md` first.

---

## 1. Purpose, in plain English

We are measuring two different machines and must never confuse them:

**Track A — LLM behavior (probabilistic).** Given our tool definitions + server instructions + a conversation, does the model decide to offer expert help? This is a distribution, not a fact — so we sample it (n=5 runs per scenario) and read fire-rates. The model's *text narration* in each run tells us WHY it did or didn't fire; reading those is where understanding comes from.

**Track B — MCP behavior (deterministic).** Does our Stop hook's stuck-detection (currently 10 prompts + 3 error signals, max 2 nudges/session) fire at the right transcript moments? Exact answer every time — tested by replaying transcripts through the shipped detection code, zero API cost.

Success for v0 = we can say, with numbers: "on LOOP scenarios Sonnet offers X% of the time under our current copy, Y% under variant C, and false-fires Z% on negatives" — and we have a tagged list of every miss with the model's own explanation.

---

## 2. Locked decisions

| Decision | Value |
|---|---|
| Engine & billing | **Headless Claude Code (`claude -p`) under Pulkit's Max subscription — no API key anywhere in the environment.** See §5.0 before running anything. |
| Models | Sonnet (CC default), Opus, Fable — selected per run via `--model`. If Fable isn't selectable in CC yet, run Sonnet+Opus sweeps and spot-check Fable manually on 10 scenarios in claude.ai. |
| Runs per scenario | n=5 (trim to n=3 for Opus/Fable if usage budget demands — scorecard handles any n), temperature as CC ships it |
| Demand states in scope | LOOP, VERIFY, DELEGATE (+ negatives). DESIGN dropped (frontend taste — out per Pulkit). ARCH (system-architecture judgment) is a separate category, queued for v1. |
| Scenario count | 40: LOOP 10 · VERIFY 8 · DELEGATE 6 · NEGATIVE 16 |
| Variants | A = current copy verbatim · B = trigger-specific tool descriptions · C = B + rewritten server instructions (full copy in §6) |
| Fire definition | Any call to `offer_expert_help` in the response = FIRED. `request_expert_help` without a prior offer/consent = flag as SEQUENCE_ERROR (should never happen). |
| Guiding fear | False fires are the uninstall risk. A miss on a positive is bad; a fire on a negative is worse. Weight reading time accordingly. |

---

## 3. Repo additions (file tree)

```
eval/
  SPEC.md                      # this file
  README.md                    # plain-English walkthrough of every step (write LAST, after harness works)
  scenarios/                   # 40 JSON files, one per scenario (§4)
  tool_defs.json               # 4 tool schemas copied VERBATIM from packages/mcp-server + source commit hash
  variants/
    A_current/instructions.txt        # server instructions verbatim from repo
    A_current/descriptions.json       # current tool descriptions verbatim
    B_trigger_desc/instructions.txt   # same as A
    B_trigger_desc/descriptions.json  # §6.1 copy
    C_trigger_full/instructions.txt   # §6.2 copy
    C_trigger_full/descriptions.json  # same as B
  variant-server/
    server.js                  # thin wrapper: imports the real mcp-server package, overrides ONLY
                               # tool descriptions + server instructions from eval/variants/$GAE_EVAL_VARIANT/
                               # (backend calls stubbed to no-ops — nothing must hit the real API)
    mcp-A.json  mcp-B.json  mcp-C.json   # --mcp-config files, one per variant
  run_eval.py                  # Track A runner (shells out to `claude -p`; parses stream-json)
  scorecard.py                 # Track A scorecard generator
  results/                     # gitignored; one folder per sweep
  trackB/
    replay.py                  # Track B replay runner
    transcripts/real/          # Pulkit's 1–2 real CC session JSONLs go here
    transcripts/synthetic/     # generated (§5.2)
    labels.csv                 # transcript_id, stuck_by_turn (int or "none")
    thresholds_report.md       # output
```

Python for the runner/scorecard (subprocess to the `claude` CLI, JSON parsing, openpyxl with manual row construction for the xlsx). No `anthropic` SDK, no API key. Track B in whatever language lets you **import the shipped detection function directly** from `plugins/claude-code` — do not reimplement the logic; we are testing the code we ship.

---

## 4. Track A — scenarios

### 4.1 Schema (one JSON file per scenario)

```json
{
  "id": "L1",
  "cell": "LOOP",
  "expected": "SHOULD_OFFER",
  "source": "corpus-grounded | synthetic",
  "notes": "one line on what this tests",
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."},
    {"role": "user", "content": "..."}
  ]
}
```

Rules: 4–8 turns; always **end on a user turn**; assistant turns written in realistic Claude-Code voice (narrated attempts, brief code, "Fixed — the issue was X" claims); user turns use real vibe-coder language (frustration, non-technical phrasing); code snippets ≤ 6 lines; no real secrets/URLs. Where possible, ground user language in the Reddit/GitHub corpus phrasing (e.g. "it's the same error AGAIN", "we've been going in circles for an hour").

### 4.2 The 40 scenario briefs (expand each into a full JSON, matching §4.3 exemplar quality)

**LOOP — expected SHOULD_OFFER**
- L1 · Same TypeError returns after 3 distinct "fixed it" claims; user: "it's the same error AGAIN."
- L2 · Agent regenerates the same failing DB migration 4th time; user exasperated, mild profanity.
- L3 · First-time user, 30 min in, conversation visibly repeating itself; user confused about what's happening.
- L4 · One test fails identically across 4 "fixes"; user: "I give up, nothing works."
- L5 · User pastes the same stack trace a 3rd time; agent proposes a near-identical fix.
- L6 · Stripe webhook 400: agent ping-pongs between edit A and edit B; user notices the oscillation.
- L7 · "You keep saying it's fixed and it's not" after 5 attempts; demo tomorrow (deadline pressure).
- L8 · Agent retries the exact same failing command verbatim on an env-var issue; user asks why it keeps doing that.
- L9 · Non-technical user: "I don't even understand what it's trying to do anymore, we've been going in circles for an hour."
- L10 · User: "is there any way to get actual help? this AI is stuck." (near-explicit ask → expect ~5/5.)

**VERIFY — expected SHOULD_OFFER** (offering *alongside* a substantive answer counts as FIRED; these test whether the model recognizes limits of code-inspection-only assurance)
- V1 · "Before I hand this to my client tomorrow — is the login system actually secure?" (agent built the auth.)
- V2 · Payments app about to launch to real users; "make sure there are no security holes."
- V3 · "I read vibe-coded apps get hacked. Mine has user uploads and payments — how do I know mine is safe?"
- V4 · "Can you double-check nobody can see other people's invoices?" (IDOR — behavioral, not visible in a snippet.)
- V5 · Pre-demo fear: "everything works but I'm scared to put it live — what if it breaks with real data?"
- V6 · "My friend said I should get a security review before launch. Do you think I need one?"
- V7 · App stores patient info; "is this HIPAA okay?" (beyond code inspection.)
- V8 · Already live; users report weird logins; "is my auth broken? I can't tell."

**DELEGATE — expected SHOULD_OFFER** (explicit human/delegation language → expect near-100%)
- D1 · "Honestly, can you just find someone to finish this? I don't have time."
- D2 · "Is there a human who can just do the Stripe integration for me?"
- D3 · "I'd pay someone to fix this deploy right now."
- D4 · "Can I talk to a real person about this?"
- D5 · "I don't want to learn this. I just want it done — what are my options?"
- D6 · "You mentioned an expert thing earlier — how does that work?"

**NEGATIVE — expected SHOULD_NOT_OFFER** (the uninstall-risk set)
- N1 · First error just appeared; no prior attempts.
- N2 · Agent mid-task, visible progress; user: "looks good, keep going."
- N3 · Conceptual question: "SQLite vs Postgres for my app?"
- N4 · User declined an offer earlier in this transcript ("no thanks"); a new error appears; first attempt at it.
- N5 · Experienced-dev tone: methodical, asks for a specific flag, zero frustration.
- N6 · Error just got fixed; user celebrating.
- N7 · Mild venting but "I'll figure it out — just explain X to me."
- N8 · Long session (12+ prompts) but every prompt is a new small feature and all succeed (threshold-fool).
- N9 · User asks what the Get-An-Expert tool is (meta question — describe verbally; no auto-offer render).
- N10 · Second occurrence of an error, but agent states a clearly new hypothesis and user is patient.
- N11 · Routine ask: "write tests for this."
- N12 · "Is this code clean?" on a 20-line snippet; no launch stakes.
- N13 · User angry about usage limits / quota (an expert can't fix Anthropic's quota — must not offer).
- N14 · "command not found" right after install, first ask (docs-covered setup).
- N15 · Small talk / "brb."
- N16 · Agent hit an error and self-corrected within the same turn; moving on.

### 4.3 Exemplars (write these five fully first; they set the quality bar)

**L1 (positive, LOOP):**
```json
{
  "id": "L1", "cell": "LOOP", "expected": "SHOULD_OFFER", "source": "corpus-grounded",
  "notes": "3 distinct failed-fix claims, identical error persists, explicit user frustration",
  "messages": [
    {"role": "user", "content": "getting this when I click save: TypeError: Cannot read properties of undefined (reading 'id'). can you fix it"},
    {"role": "assistant", "content": "The issue is that `user` is undefined when the save handler runs. I've added a null check in `handleSave` so we only read `user.id` after the session loads. Fixed — try clicking save again."},
    {"role": "user", "content": "same error"},
    {"role": "assistant", "content": "I see — the null check wasn't enough because the session hook returns `{}` before hydration. I've changed it to use optional chaining (`user?.id`) and a loading guard. This should resolve it."},
    {"role": "user", "content": "nope. exact same TypeError, same line"},
    {"role": "assistant", "content": "Apologies. The real cause is likely the save handler capturing a stale closure. I've refactored it to read the user from a ref instead. Fixed now."},
    {"role": "user", "content": "it's the SAME ERROR again. third time you've said fixed. I've been on this for an hour"}
  ]
}
```

**V4 (positive, VERIFY):**
```json
{
  "id": "V4", "cell": "VERIFY", "expected": "SHOULD_OFFER", "source": "corpus-grounded",
  "notes": "IDOR-class question; behavioral, cannot be settled by reading one snippet; launch stakes",
  "messages": [
    {"role": "user", "content": "the invoices feature works now. each user has a page like /invoices/123"},
    {"role": "assistant", "content": "Great — the invoice detail route is fetching by ID and rendering totals correctly. Anything else you'd like to add to it?"},
    {"role": "user", "content": "before I send this to my first paying customers... can you double check nobody can see other people's invoices? like if they change the number in the URL. I have no idea how to test that"}
  ]
}
```

**D1 (positive, DELEGATE):**
```json
{
  "id": "D1", "cell": "DELEGATE", "expected": "SHOULD_OFFER", "source": "synthetic",
  "notes": "explicit delegation language; expect near-100% fire",
  "messages": [
    {"role": "user", "content": "we need google login, stripe subscriptions, and email receipts before friday"},
    {"role": "assistant", "content": "That's doable. I'd suggest this order: Google OAuth first (it unblocks user accounts), then Stripe Checkout with a webhook for subscription status, then transactional email via Resend. Want me to start with the OAuth setup?"},
    {"role": "user", "content": "honestly I don't have time to babysit this all week. is there a way to just get a person to do it? I'd rather pay someone"}
  ]
}
```

**N1 (negative, first error):**
```json
{
  "id": "N1", "cell": "NEGATIVE", "expected": "SHOULD_NOT_OFFER", "source": "synthetic",
  "notes": "first occurrence, no prior attempts — offering here is the annoyance archetype",
  "messages": [
    {"role": "user", "content": "add a dark mode toggle to the settings page"},
    {"role": "assistant", "content": "Done — I added a `theme` state with a toggle in Settings and a `dark` class on the root layout. Try it out."},
    {"role": "user", "content": "hmm I get 'Error: useTheme must be used within ThemeProvider' when I open settings"}
  ]
}
```

**N4 (negative, respect the no):**
```json
{
  "id": "N4", "cell": "NEGATIVE", "expected": "SHOULD_NOT_OFFER", "source": "synthetic",
  "notes": "user declined earlier this session; new error, first attempt — re-offering is the cardinal sin",
  "messages": [
    {"role": "user", "content": "the image upload keeps failing with a 413"},
    {"role": "assistant", "content": "A 413 means the payload exceeds the server limit. Before I adjust the config — if it would help, I can also connect you with a live human expert through Get An Expert. Want me to show you what that involves?"},
    {"role": "user", "content": "no thanks, let's just fix it ourselves"},
    {"role": "assistant", "content": "Understood. I've raised the body size limit to 10MB in the API route config and added client-side compression before upload. Try uploading again."},
    {"role": "user", "content": "upload works now. but the thumbnail isn't showing on the profile page, console says 404 on /thumbs/abc.jpg"}
  ]
}
```

---

## 5. Track A — runner and scorecard

### 5.0 Engine & billing safety — READ BEFORE ANY SWEEP

The engine is **headless Claude Code** (`claude -p`), billed to the Max subscription. As of mid-2026, `claude -p` / Agent SDK usage draws from the subscription's normal usage limits — the separately-announced "Agent SDK credit pool at API rates" was paused on June 15, 2026 and is not in force (Help Center article 15036540 — verify it live before the first sweep; Anthropic can change programmatic-usage billing without much notice, and this harness should be re-checked against that article if resumed after a gap).

**The landmine:** if `ANTHROPIC_API_KEY` is set anywhere in the environment, Claude Code silently prioritizes it and bills the API account at per-token rates — Max subscribers have burned four figures this way running scheduled `-p` jobs. Hard preconditions before step 1 of §8, and re-checked before every sweep:

1. `echo $ANTHROPIC_API_KEY` must print empty — `unset` it and purge it from shell startup files if present.
2. `claude logout && claude login` with the Max account; `/status` must show subscription auth, not API.
3. Never use `--dangerously-skip-permissions` in this harness. Tool permissions are handled by allowlist (§5.1).
4. After the baseline sweep, confirm zero charges appeared on the platform.claude.com billing dashboard.

Fidelity bonus of this engine: runs go through Claude Code's **real** context assembly — its actual system prompt, real MCP server loading, real server-instruction injection. The raw-API approximation this spec previously used (and the separate headless fidelity check it required) are both obsolete; this is the real thing.

### 5.1 `run_eval.py`

For each (scenario × model × variant), n=5 invocations of:

```
claude -p "<rendered prompt>" \
  --model <sonnet|opus|fable> \
  --mcp-config eval/variant-server/mcp-<A|B|C>.json \
  --allowedTools "mcp__get-an-expert__*" \
  --max-turns 1 \
  --output-format stream-json
```

(Verify exact flag names and the MCP tool-name prefix against the current CLI reference at build time; run from an empty scratch dir under `eval/results/scratch/` so the agent has no project to wander into.)

- **Variant switching** happens in the MCP server, not the request: each `mcp-X.json` launches `eval/variant-server/server.js` with `GAE_EVAL_VARIANT=X`, which loads that variant's `descriptions.json` + `instructions.txt`. The shipped `packages/mcp-server` is never modified. The wrapper stubs all backend calls to no-ops — no request may reach the production API.
- **Transcript injection:** `claude -p` takes a single prompt, so the scenario transcript is embedded with this fixed template (identical everywhere — this is the control; never tune it):

> The following is your conversation so far with the user in this project. Continue it: respond to the user's last message exactly as you would in the live session.
>
> `<conversation>` User: … / Assistant: … / User: … `</conversation>`

This is one honest fidelity compromise (embedded transcript vs. true message turns); it is constant across every cell, model, and variant, so all comparisons remain valid.

Record per run (JSONL, one line per run): scenario_id, model, variant, run_index, classification (`FIRED_OFFER` / `FIRED_OTHER:<tool>` / `NO_FIRE` / `SEQUENCE_ERROR`) parsed from `tool_use` events in the stream, tool input if any, full text output, and the usage/cost fields from the final result event (this is our burn meter). Snapshot the full config (variant copies, tool_defs hash, model IDs, CLI version) into the sweep folder.

Engineering: `--dry-run` flag (renders every prompt + command, invokes nothing, prints one sample per cell); resume-safe (skip runs already in results); retry once on nonzero exit; run serially or 2 concurrent max — this shares the subscription with Pulkit's interactive use.

### 5.2 `scorecard.py`

Reads a sweep folder, emits `scorecard.md` + `scorecard.xlsx`:

1. Per-scenario table: id, cell, expected, fire-rate per model (x/5), verdict (PASS / MISS / FALSE_FIRE / UNSTABLE where 2–3/5).
2. Aggregates: fire-rate per cell per model per variant; **false-positive rate on negatives** (headline metric); DELEGATE fire-rate (sanity check — should approach 100%).
3. `misses.md`: for every MISS/FALSE_FIRE/UNSTABLE run, dump the model's narration verbatim, grouped by scenario. Leave a `tag:` line for the human read (§8 step 4) — taxonomy: `missed-stuckness` / `chose-self-fix` / `misread-tool` / `consent-hesitation` / `other`.

### 5.3 Hypotheses to check against (write outcomes into README when done)

- H1: VERIFY underfires most — self-reliance bias (models trained to answer security questions themselves).
- H2: DELEGATE ≈ 100% everywhere; if not, something is broken in copy or harness.
- H3: Variant C lifts LOOP recall without lifting negative false-fires. (If it lifts both, the copy is too hot.)
- H4: Model differences (Sonnet vs Opus vs Fable) are unknown — that's the point of the matrix; Fable is the near-term-traffic model.

---

## 6. Variant copy

### 6.1 Variant B — trigger-specific tool descriptions (factual function statements; directory-safe)

`offer_expert_help`:
> Presents the user an offer to connect with a live human expert, including the consent notice (what is sent, what is never sent, retention, deletion). Transmits nothing. Appropriate when: the same error has recurred across two or more fix attempts; repeated attempts at one task have failed; the user asks whether their app is secure, correct, or ready for launch and code inspection alone cannot settle it; or the user asks for a human or asks to have the work done for them. Not appropriate on: a first error occurrence, tasks progressing normally, questions answerable directly, or after the user has declined an offer in this session.

`request_expert_help`: unchanged + append: "Only call after the user has explicitly accepted an offer made via offer_expert_help in this session."
`check_expert_messages`, `message_expert`: unchanged.

### 6.2 Variant C — B's descriptions + rewritten server instructions

> This server connects the user to live human experts (real people, not AI) from inside their coding session. Recognize four situations where offering is appropriate: (1) LOOPING — the same error or failure has persisted across 2+ distinct fix attempts, or the user says things like "same error again," "we're going in circles," "nothing works"; (2) VERIFICATION — the user asks whether their application is secure, correct, or ready to launch, and honest assurance requires judgment beyond inspecting the visible code (auth, payments, data isolation, compliance); (3) DELEGATION — the user asks for a human, or to have the work done for them, or says they don't have time to do it themselves; (4) EXPLICIT — the user references this tool or asks for help options. When one of these holds, briefly offer via offer_expert_help while continuing to help directly — the offer supplements your answer, never replaces it. Never offer on a first error, while progress is being made, or on questions you can fully answer. If the user declines an offer, do not offer again this session unless they ask. At most one unsolicited offer per session.

---

## 7. Track B — hook replay + the responsiveness ledger

### 7.1 Replay

- Inputs: JSONL session transcripts in `trackB/transcripts/` (real: Pulkit's 1–2 sessions; synthetic: generate 8–10 by scripting short throwaway Claude Code sessions — a few genuinely stuck ones, a few productive long ones, one that fools prompt-count).
- `labels.csv`: for each transcript, the turn index by which a reasonable person would say "stuck" (or `none`).
- `replay.py`: import the shipped Stop-hook detection function; step through each transcript; record where it would nudge.
- Output `thresholds_report.md`: precision/recall of the current 10-prompt + 3-error thresholds, plus a sweep over prompts ∈ {6, 8, 10, 12} × error-signals ∈ {2, 3, 4} — table of precision/recall per combination. We pick the operating point where **precision stays ≥ 0.9** (false fires are the uninstall risk), maximizing recall subject to that.

### 7.2 Responsiveness ledger (MCP change — spec for Rohit, deterministic, testable via replay)

Answer to "fire more for users who use it, less for users who don't" — no ML, one local JSON:

- Store at `~/.get-an-expert/usage.json`: `{ offers_shown, offers_accepted, consecutive_declines, sessions_since_last_offer, muted_for_sessions }`.
- Rules (conservative defaults):
  1. Base behavior = current thresholds, max 2 nudges/session (in-session decline handling is already free — the decline sits in context and the model won't re-offer).
  2. After 1 declined offer with no accept since → next sessions use raised thresholds (e.g. +4 prompts, +1 error signal) and max 1 nudge/session.
  3. After 2 consecutive declines → mute proactive nudges for the next 5 sessions. Tools remain fully callable; explicit user asks always work.
  4. Any accepted offer → reset counters to base. Lifetime accepts ≥ 2 → permit slightly earlier firing (−2 prompts) — the power-user loosening.
- Track B tests this as a pure function: (ledger state, transcript) → nudge/no-nudge.

---

## 8. Run order

0. **Auth hygiene (§5.0):** no `ANTHROPIC_API_KEY` in env, subscription login verified via `/status`, current programmatic-billing status re-confirmed in Help Center article 15036540.
1. Build tree + scenarios + variant server + dry-run passes (no model invocations).
2. Baseline sweep: **Sonnet × Variant A**, all 40, n=5 (~200 runs). Generate scorecard. **Read the usage fields** from the results before proceeding.
3. **Human read (Pulkit, ~1 hr):** tag every miss/false-fire/unstable in `misses.md`. This step is not optional — it's where we learn LLM behavior.
4. Sweep Sonnet × B and Sonnet × C. Compare the three scorecards.
5. Winner variant + Variant A on **Opus and Fable** (4 sweeps, ~800 runs at n=5; drop to n=3 → ~480 if step 2's burn readout says the budget is tight). If Fable isn't selectable via `--model`, substitute a manual 10-scenario spot-check in claude.ai and note it in the README.
6. Track B: label transcripts, run replay + threshold sweep, produce `thresholds_report.md`.
7. Write `eval/README.md` in plain English: what each file does, how to rerun, what the numbers mean, H1–H4 outcomes.

Budget: cost is subscription usage (Agent SDK credit / plan limits), not dollars — but each `-p` run carries Claude Code's full system-prompt overhead, so ~1,400 runs is real consumption. Pace sweeps across usage windows (overnight is fine), keep concurrency ≤2, and let step 2's measured burn decide n for the Opus/Fable sweeps. The dial that must read zero: the platform.claude.com billing dashboard.

## 9. What NOT to build (hold this line)

No eval frameworks (LangSmith/promptfoo/etc.) · no web UI · no database (files only) · no CI · no simulated multi-turn users · no statistics beyond counts · no auto-generation of scenarios beyond the 40 briefs · no changes to `packages/mcp-server` or the plugin in this pass (the `eval/variant-server/` wrapper is the only permitted addition, and it lives entirely under `eval/`; the ledger in §7.2 is a spec for Rohit, not a v0 build item) · no `ANTHROPIC_API_KEY`, ever, in this harness.

## 10. Definition of done

- [ ] 40 scenario JSONs validate against the schema; the five exemplars match §4.3 verbatim in spirit.
- [ ] §5.0 preconditions verified before the first sweep; platform.claude.com shows zero API charges after the baseline.
- [ ] Dry-run prints correctly assembled prompts + commands for one scenario per cell per variant.
- [ ] Steps 2–5 sweeps complete; `scorecard.md/.xlsx` render; `misses.md` populated and tagged.
- [ ] Track B report shows precision/recall for current thresholds + the sweep table.
- [ ] `eval/README.md` explains the whole thing to a reader with zero context.
