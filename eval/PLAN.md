# Eval Harness v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `eval/SPEC.md` end to end first; it is the content authority this plan references by section number.

**Goal:** Build the two-track invocation eval harness from `eval/SPEC.md`: Track A measures how often the model offers expert help across 40 scenarios x 3 copy variants x models (via headless `claude -p`), Track B replays transcripts through the shipped stuck-detection hook to tune its thresholds.

**Architecture:** Everything lives under `eval/` (SPEC §9 permits nothing else). A zero-dependency Node stdio MCP server (`variant-server/server.js`) serves the real tool schemas, extracted verbatim from the shipped server, with per-variant descriptions and instructions swapped in by `GAE_EVAL_VARIANT`; all handlers are no-op stubs so nothing can reach the production API. `run_eval.py` shells out to `claude -p` and classifies runs from `tool_use` events in stream-json. `scorecard.py` aggregates a sweep folder into scorecard.md/.xlsx + misses.md. Track B's `replay.py` runs the actual shipped `detect-stuck.mjs` as a subprocess (its thresholds are already env-var driven) against transcript prefixes, with `HOME` pointed at a temp dir.

**Tech Stack:** Python 3 stdlib + openpyxl (scorecard only); plain Node >= 18 (variant server, no packages); `claude` CLI 2.1.209; pnpm + tsx once, for the one-time schema extraction.

## Global Constraints

- Repo changes ONLY under `eval/` (SPEC §9). No edits to `packages/` or `plugins/`.
- No `ANTHROPIC_API_KEY` anywhere: the runner refuses to start a sweep if it is set, and strips it from child env (SPEC §5.0).
- Never `--dangerously-skip-permissions`; tools allowed via `--allowedTools "mcp__get-an-expert__*"` only.
- Every `claude -p` invocation includes `--strict-mcp-config` so the machine's global MCP servers (including the REAL get-an-expert install) never load into a run. Correction to SPEC §5.1, required for validity.
- `--max-turns` does not exist in CLI 2.1.209: omit it. Classification reads `tool_use` events, so measurement is unaffected. Deviation from SPEC §5.1, verified at build time.
- Fire definition (SPEC §2): any `offer_expert_help` call = FIRED_OFFER; `request_expert_help` with no prior offer in the same run = SEQUENCE_ERROR; other server tools = FIRED_OTHER:<tool>; else NO_FIRE.
- Transcript-injection prompt template is fixed verbatim (SPEC §5.1) and never tuned.
- No em dashes and no stock AI phrasing in any authored copy: variant descriptions, instructions, scenario text, reports, README (Pulkit's global writing rule; supersedes SPEC §6 verbatim copy where they conflict).
- Eval targets repo main (`956d6ca`, v0.3.0, tools: offer_expert_help, request_expert_help, check_expert_replies, get_privacy_info). Published npm is 0.2.1 with older tool names; SPEC §6.1's "check_expert_messages, message_expert: unchanged" maps to "check_expert_replies, get_privacy_info: unchanged".
- Runs execute from an empty scratch dir `eval/results/scratch/` so the agent has no project to wander into.
- Concurrency <= 2; serial by default. Results are gitignored.

## Deviations from SPEC (each pre-authorized or forced; flag all to Rohit in the PR)

| # | Deviation | Why |
|---|---|---|
| 1 | Variant C instructions rewritten lighter and more open than §6.2: keeps LOOP / VERIFY / DELEGATE / EXPLICIT recognition but adds an open "anything else where human judgment beats more AI attempts (design feedback, architecture, unforeseen cases)" clause, and keeps only the two uninstall-risk guardrails (no first-error offers, respect declines). | Pulkit's live instruction 2026-07-14: end goal is a simple, non-dense, lightly-guardrailed instructions file that leaves use-case discovery open. |
| 2 | `--strict-mcp-config` added to every run. | Without it the real get-an-expert server also loads from global config; two same-named servers would corrupt every measurement. |
| 3 | `--max-turns 1` dropped. | Flag absent in CLI 2.1.209. |
| 4 | Track B invokes shipped `detect-stuck.mjs` as a subprocess instead of importing a function. | The detector is a stdin/stdout script, not a library; subprocess IS the shipped code path, thresholds already env-injectable (`GAE_MIN_PROMPTS`, `GAE_MIN_ERRORS`). |
| 5 | Synthetic Track B transcripts hand-authored in Claude Code JSONL shape rather than scripted live sessions. | Zero usage cost, deterministic labels; detector only reads `type:"user"` entries, `isMeta`, tool_result blocks, and error-pattern text. Real transcripts from Pulkit slot in later. |
| 6 | Variant server is a self-contained JSON-RPC stdio implementation serving schemas extracted verbatim from the real server's own `tools/list` response, rather than importing `packages/mcp-server`. | The shipped entrypoint is a side-effectful script, not importable; serving its exact wire-format schemas is higher fidelity than re-deriving them, and zero deps means no workspace surgery. |
| 7 | Tool-name mapping per Global Constraints (repo main vs npm 0.2.1). | Repo is ahead of npm. |
| 8 | Added DISCOVERY cell (X1 to X8), scenario count 40 -> 48. | Pulkit 2026-07-14: the open-clause goal was unmeasured; probes design/architecture/UX/judgment escalations. Rates are read, not targeted. |
| 9 | Detector v2 prototype + spec added under eval/trackB/ (shipped plugin untouched). | Replay findings justified a concrete proposal; harness doubles as its acceptance test. |

---

### Task 1: Scaffold, spec, gitignore

**Files:**
- Create: `eval/SPEC.md` (copy of the build spec, done)
- Create: `eval/.gitignore` containing `results/`
- Create: dirs `eval/scenarios/`, `eval/variants/{A_current,B_trigger_desc,C_trigger_full}/`, `eval/variant-server/`, `eval/results/scratch/`, `eval/trackB/transcripts/{real,synthetic}/`

**Steps:**
- [x] Save spec to `eval/SPEC.md`
- [ ] `mkdir -p` the tree above; write `eval/.gitignore` with `results/`
- [ ] Create a work branch `eval-harness-v0` (never commit to main; Rohit cherry-picks)
- [ ] Commit: `chore(eval): scaffold eval tree + spec`

### Task 2: Verbatim extraction of tool defs + Variant A copy

**Files:**
- Create: `eval/extract_defs.mjs` (one-time extraction script, checked in for reproducibility)
- Create: `eval/tool_defs.json` (output: `{ sourceCommit, extractedAt, serverVersion, instructions, tools: [tools/list result verbatim] }`)
- Create: `eval/variants/A_current/instructions.txt` (INSTRUCTIONS verbatim)
- Create: `eval/variants/A_current/descriptions.json` (`{ "<toolName>": "<description verbatim>" }` for all 4 tools)

**Interfaces:**
- Produces: `tool_defs.json.tools[]` with `{name, title, description, inputSchema, annotations}` exactly as the real server serialized them; consumed by Task 4's server and Task 7's config snapshot (hash).

**Steps:**
- [ ] `pnpm install` at repo root (dev deps only; enables `tsx`)
- [ ] Write `extract_defs.mjs`: spawn `pnpm --filter get-an-expert-mcp exec tsx src/index.ts`, speak JSON-RPC over its stdio (`initialize` with protocolVersion `2025-06-18`, `notifications/initialized`, `tools/list`), capture the server's `instructions` from the initialize result and the raw `tools` array; write `tool_defs.json`; derive `A_current/instructions.txt` + `A_current/descriptions.json` from the same response
- [ ] Run it; verify 4 tools present and `instructions` matches `src/index.ts` INSTRUCTIONS
- [ ] Commit: `feat(eval): verbatim tool defs + variant A copy (extracted from live server)`

### Task 3: Variant B and C copy

**Files:**
- Create: `eval/variants/B_trigger_desc/instructions.txt` (byte-identical to A)
- Create: `eval/variants/B_trigger_desc/descriptions.json` (SPEC §6.1 copy, em dashes removed, tool names mapped: offer_expert_help rewritten; request_expert_help = current + appended sequencing sentence; check_expert_replies and get_privacy_info unchanged)
- Create: `eval/variants/C_trigger_full/descriptions.json` (byte-identical to B)
- Create: `eval/variants/C_trigger_full/instructions.txt` (rewritten per Deviation 1; final copy below, review before commit)

**Variant C instructions (full copy):**

> Get An Expert connects the user with live human experts (real people, not AI) from inside their coding session. Offering is welcome whenever a human would genuinely help. The clearest signs:
>
> 1. Looping: the same error or failure keeps coming back after multiple fix attempts, or the user says things like "same error again" or "we're going in circles."
> 2. Verification: the user asks whether their app is secure, correct, or ready to launch, and honest assurance needs judgment beyond reading the visible code (auth, payments, data isolation, compliance).
> 3. Delegation: the user asks for a human, wants the work done for them, or doesn't have time to do it themselves.
> 4. Anything else where human judgment beats more AI attempts: design feedback, architecture decisions, tricky tradeoffs, or situations these categories don't cover. When you see a genuine need, offering once is fine even if it fits no listed case.
>
> Offer briefly via offer_expert_help while continuing to help directly; the offer adds to your answer, it never replaces it. Do not offer on a first error or while things are going well. If the user declines, do not offer again this session unless they ask.

**Steps:**
- [ ] Write the three files; `grep -r "—" eval/variants/` must return nothing
- [ ] Commit: `feat(eval): variant B and C copy`

### Task 4: Zero-dep variant MCP server + configs + smoke test

**Files:**
- Create: `eval/variant-server/server.js` (plain Node, no imports beyond node:fs/node:path/node:readline)
- Create: `eval/variant-server/mcp-A.json`, `mcp-B.json`, `mcp-C.json`
- Create: `eval/variant-server/smoke.mjs` (pipes initialize + tools/list + one tools/call at the server, asserts variant copy present; no API, no model)

**Interfaces:**
- Consumes: `eval/tool_defs.json`, `eval/variants/$GAE_EVAL_VARIANT/{instructions.txt,descriptions.json}`
- Produces: an MCP stdio server named `get-an-expert` (tool prefix must be `mcp__get-an-expert__*`); mcp-X.json shape:

```json
{ "mcpServers": { "get-an-expert": {
    "command": "node",
    "args": ["<abs-or-repo-rel path>/eval/variant-server/server.js"],
    "env": { "GAE_EVAL_VARIANT": "A" } } } }
```

**server.js behavior (complete contract):**
- newline-delimited JSON-RPC on stdio; log only to stderr
- `initialize` -> `{ protocolVersion: <echo client's>, capabilities: { tools: {} }, serverInfo: { name: "get-an-expert-eval", version: "0.0.0-eval" }, instructions: <variant instructions.txt> }`
- `tools/list` -> tools from tool_defs.json with `description` replaced from variant descriptions.json when the tool name has an override
- `tools/call` -> canned local text per tool, zero network:
  - `offer_expert_help` -> the real offer/consent shape: "I can connect you with a live human expert on <expertiseArea> through Get An Expert. If you agree, one structured summary of this stuck session (goal, attempts, errors, tech stack, secrets redacted locally) is sent for a human expert to review, and a live chat opens. Nothing has been sent yet. Retention 30 days, deletable anytime. Want me to set it up?"
  - `request_expert_help` -> "[eval stub] Request accepted. A human expert will join shortly." (never networks)
  - `check_expert_replies` -> "No expert chat on record for this machine yet."
  - `get_privacy_info` -> two-line stub summary
- `ping` -> `{}`; unknown methods -> JSON-RPC error -32601; notifications ignored

**Steps:**
- [ ] Write server.js and the three mcp-X.json
- [ ] Write smoke.mjs; run `node eval/variant-server/smoke.mjs A && ... B && ... C`; expected: each prints the variant's first instruction line + 4 tool names + offer stub text
- [ ] Commit: `feat(eval): variant MCP server (zero-dep, stubbed backends) + smoke test`

### Task 5: Scenario schema check + five exemplars

**Files:**
- Create: `eval/scenarios/L1.json`, `V4.json`, `D1.json`, `N1.json`, `N4.json` (verbatim from SPEC §4.3)
- Create: validation inside `run_eval.py` later; interim check via `python3 - <<'EOF'` snippet in step 2

**Schema (SPEC §4.1):** required keys `id, cell, expected, source, notes, messages`; `cell` in {LOOP, VERIFY, DELEGATE, NEGATIVE}; `expected` in {SHOULD_OFFER, SHOULD_NOT_OFFER}; 4-8 messages ending with `role:"user"`; roles alternate starting with user.

**Steps:**
- [ ] Write the 5 exemplar JSONs exactly as SPEC §4.3
- [ ] Validate: `python3 -c` loop over `eval/scenarios/*.json` asserting the schema; expected: `5 OK`
- [ ] Commit: `feat(eval): five exemplar scenarios (quality bar)`

### Task 6: Remaining 35 scenarios

**Files:**
- Create: `eval/scenarios/{L2..L10, V1..V3, V5..V8, D2..D6, N2, N3, N5..N16}.json`

**Content authority:** SPEC §4.2 briefs, one JSON each, matching §4.3 exemplar quality. Rules (SPEC §4.1): 4-8 turns ending on user; assistant turns in realistic Claude-Code voice with "Fixed" claims where the brief says so; user turns in vibe-coder language grounded in corpus phrasing; code snippets <= 6 lines; no real secrets or URLs; no em dashes in any message text.

**Steps:**
- [ ] Write LOOP L2-L10 (9 files), re-validate schema
- [ ] Write VERIFY V1-V3, V5-V8 (7 files), re-validate
- [ ] Write DELEGATE D2-D6 (5 files), re-validate
- [ ] Write NEGATIVE N2, N3, N5-N16 (14 files), re-validate; expected `40 OK`
- [ ] Self-review each cell against its brief line (id, premise, ending user message match)
- [ ] Commit per cell: `feat(eval): LOOP scenarios` etc.

### Task 7: run_eval.py (Track A runner)

**Files:**
- Create: `eval/run_eval.py`

**Interfaces:**
- CLI: `python3 eval/run_eval.py --models sonnet --variants A [--runs 5] [--concurrency 1] [--dry-run] [--sweep-name 2026-07-14-baseline] [--scenarios L1,V4]`
- Produces per sweep: `eval/results/<sweep-name>/runs.jsonl` (one line per run: `scenario_id, cell, expected, model, variant, run_index, classification, tool_calls[], text, usage, cost_usd, duration_ms, cli_exit, timestamp`), plus `config_snapshot/` (variant files copied, tool_defs sha256, cli version, exact command template). Consumed by scorecard.py.

**Core logic (complete contract):**
- Preflight (every invocation incl. resume, per SPEC §5.0): abort if `os.environ.get("ANTHROPIC_API_KEY")`; strip it and `ANTHROPIC_AUTH_TOKEN` from child env regardless; require `eval/results/scratch/` empty-ish and cwd runs there
- Prompt render, fixed template: `The following is your conversation so far with the user in this project. Continue it: respond to the user's last message exactly as you would in the live session.\n\n<conversation>\nUser: ...\nAssistant: ...\n</conversation>`
- Command: `claude -p <prompt> --model <m> --mcp-config eval/variant-server/mcp-<V>.json --strict-mcp-config --allowedTools "mcp__get-an-expert__*" --output-format stream-json --verbose` (verbose is required by stream-json in print mode; confirm at first dry-run->live smoke)
- Classification from stream events: collect `tool_use` blocks in assistant messages; `mcp__get-an-expert__offer_expert_help` -> FIRED_OFFER; `mcp__get-an-expert__request_expert_help` with no offer earlier in the same run -> SEQUENCE_ERROR; any other `mcp__get-an-expert__*` -> FIRED_OTHER:<name>; none -> NO_FIRE. Text output = concatenated assistant text blocks. Usage/cost from the final `result` event
- Resume-safe: existing (scenario, model, variant, run_index) keys in runs.jsonl are skipped; retry once on nonzero exit; serial default, max 2 workers
- `--dry-run`: validate all 40 scenarios against schema, render every prompt, print full command + rendered prompt for one scenario per cell per variant, invoke nothing, exit 0

**Steps:**
- [ ] Write run_eval.py per contract
- [ ] Run `python3 eval/run_eval.py --dry-run --models sonnet --variants A,B,C`; expected: `40 scenarios OK`, 12 sample blocks (4 cells x 3 variants), zero invocations
- [ ] Commit: `feat(eval): Track A runner with dry-run + resume`

### Task 8: scorecard.py

**Files:**
- Create: `eval/scorecard.py`

**Interfaces:**
- CLI: `python3 eval/scorecard.py eval/results/<sweep-name>/ [more sweep dirs...]`
- Consumes: `runs.jsonl` (Task 7 shape). Produces in each sweep dir: `scorecard.md`, `scorecard.xlsx`, `misses.md`

**Contract (SPEC §5.2):**
- Fire = classification == FIRED_OFFER. Per-scenario verdict at any n: positives PASS if fires >= ceil(0.8n), MISS if fires <= floor(0.2n), else UNSTABLE; negatives PASS if fires == 0, FALSE_FIRE if fires >= 2 of 5 (>= 40%), else UNSTABLE (exact bands stated in scorecard header)
- Tables: per-scenario (id, cell, expected, x/n per model+variant, verdict); aggregates (fire-rate per cell per model per variant); headline false-positive rate on negatives; DELEGATE sanity rate; total usage/cost summary (the burn meter)
- `misses.md`: every MISS / FALSE_FIRE / UNSTABLE run's narration verbatim, grouped by scenario, each with a blank `tag:` line (taxonomy comment at top: missed-stuckness / chose-self-fix / misread-tool / consent-hesitation / other)
- xlsx via openpyxl, manual row construction; if openpyxl missing, print the pip install hint and still write the .md outputs

**Steps:**
- [ ] Write scorecard.py; unit-smoke it on a hand-written 6-line fixture runs.jsonl (2 scenarios x 3 runs) in `eval/results/scratch/`; expected: verdicts PASS + FALSE_FIRE appear, misses.md contains the false-fire narration
- [ ] Commit: `feat(eval): scorecard + misses generator`

### Task 9: Track B replay + synthetic transcripts + threshold sweep

**Files:**
- Create: `eval/trackB/transcripts/synthetic/S01..S09.jsonl` (3 genuinely stuck, 3 productive-long, 1 prompt-count fool (12+ prompts all succeeding), 1 stuck-early, 1 short-clean)
- Create: `eval/trackB/labels.csv` (`transcript_id,stuck_by_turn` with `none` for negatives)
- Create: `eval/trackB/replay.py`
- Output (generated, committed): `eval/trackB/thresholds_report.md`

**Interfaces:**
- replay.py CLI: `python3 eval/trackB/replay.py [--transcripts-dir ...] [--sweep]`
- Subprocess contract per probe: run `node plugins/claude-code/bin/detect-stuck.mjs` with stdin `{"transcript_path": <prefix-file>, "session_id": "replay-<id>-<combo>"}` and env `HOME=<tmpdir>, GAE_MIN_PROMPTS=<p>, GAE_MIN_ERRORS=<e>`; nudge fired iff stdout contains `hookSpecificOutput`

**Contract (SPEC §7.1):**
- For each transcript, step through user-turn prefixes in order; first prefix that nudges = detection turn (state persists via the tmp HOME within a combo, mirroring a live session)
- Scoring per transcript per combo: labeled stuck + nudge at turn >= label = TP; nudge before label or nudge on `none` = FP; labeled stuck + no nudge = FN
- Report: precision/recall of current (10,3) + full sweep prompts {6,8,10,12} x errors {2,3,4} as a table; recommend the max-recall point with precision >= 0.9
- Transcript JSONL entries mimic real CC shape: `{"type":"user","isMeta":false,"message":{"role":"user","content":"..."}}` and `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."}]}}` plus occasional tool_result user-entries to verify they are not counted

**Steps:**
- [ ] Author the 9 synthetic transcripts + labels.csv
- [ ] Write replay.py; run `python3 eval/trackB/replay.py --sweep`; expected: report renders, current thresholds row present, no writes outside tmp HOME
- [ ] Sanity: prompt-count-fool transcript must NOT nudge at (10,3); stuck transcripts MUST nudge by their label + a few turns
- [ ] Commit: `feat(eval): Track B replay, synthetic transcripts, threshold sweep`

### Task 10: README draft + sweep gate

**Files:**
- Create: `eval/README.md` (plain-English walkthrough: what each file does, how to rerun, what numbers mean; H1-H4 outcome sections marked "pending sweep")

**Steps:**
- [ ] Write README (final H1-H4 numbers get filled after sweeps, per SPEC step 7)
- [ ] Verify §5.0 preconditions that are checkable locally: `echo $ANTHROPIC_API_KEY` empty; grep shell startup files
- [ ] Commit: `docs(eval): README walkthrough`
- [ ] STOP. Report to Pulkit with the §5.0 checklist items only he can do (subscription `/status` check, Help Center article 15036540, billing dashboard) before the baseline sweep (SPEC §8 step 2). Sweeps are a separate, user-gated turn.

## Self-Review Outcome

- Spec coverage: §3 tree -> T1-T9; §4 -> T5-T6; §5.0 -> T7 preflight + T10 gate; §5.1 -> T7; §5.2 -> T8; §6 -> T3; §7.1 -> T9; §7.2 is spec-for-Rohit (no build, per §9); §8 steps 0-1 -> T1-T10, steps 2-7 gated post-plan; §9 respected (all files under eval/); §10 DoD items map to T5/T6 (40 validate), T7 (dry-run), T8 (scorecard), T9 (Track B report), T10 (README) with sweep-dependent boxes pending.
- Type consistency: runs.jsonl field names in T7 match T8's reader; tool_defs.json shape in T2 matches T4's consumer; classification enum identical in T7/T8.
- Known open risk: stream-json event shapes and the --verbose requirement get confirmed against real output at the first gated smoke run; parser written defensively against both `stream_json` assistant-message and result-event forms.
