# Get An Expert | Invocation Eval Harness v0

This folder measures one thing from two angles: **when does the assistant offer expert help, and when should it?**

- **Track A (probabilistic):** given our tool descriptions and server instructions, how often does the model decide to call `offer_expert_help`? Sampled with repeated runs because model behavior is a distribution, not a fact.
- **Track B (deterministic):** does our Stop-hook stuck-detector nudge at the right moments? Tested by replaying session transcripts through the exact shipped code. Zero API cost, exact answers.

The two must never be confused: Track A tests copy, Track B tests thresholds.

## The shape of it

```
scenarios/ (40 conversations)          transcripts/ (real + synthetic sessions)
        |                                        |
        v                                        v
  run_eval.py  --- claude -p --->          replay.py --- node detect-stuck.mjs
        |         (variant server:               |        (shipped code, env-var
        v          A, B, or C copy)              v         thresholds)
  results/<sweep>/runs.jsonl            thresholds_report.md
        |
        v
  scorecard.py -> scorecard.md/.xlsx + misses.md (the human read)
```

## What each file does

| Path | What it is |
|---|---|
| `SPEC.md` | The build spec. Section numbers referenced everywhere. |
| `PLAN.md` | Implementation plan + every deviation from the spec, with reasons. |
| `scenarios/*.json` | 48 test conversations: LOOP 10, VERIFY 8, DELEGATE 6, NEGATIVE 16, DISCOVERY 8. Each ends on a user message; the model continues it. DISCOVERY (X1 to X8) probes whether open-ended instructions fire on use cases we never listed: design judgment, architecture calls, UX diagnosis, third-party evaluation, capacity planning, app review, schema smell, pricing. Read those rates, don't target them. |
| `tool_defs.json` | The real server's tool schemas, captured verbatim from its own `tools/list` response, with source commit hash. |
| `variants/A_current/` | Copy shipped today, verbatim. The control. |
| `variants/B_trigger_desc/` | A's instructions + trigger-specific tool descriptions. |
| `variants/C_trigger_full/` | B's descriptions + rewritten server instructions: simple, light on guardrails, open to unlisted use cases (design, architecture, anything). |
| `variant-server/server.js` | Zero-dependency MCP server serving the real schemas with a variant's copy. All handlers are stubs; nothing can reach the production API. |
| `variant-server/mcp-{A,B,C}.json` | Claude Code `--mcp-config` files (repo-relative; the runner generates absolute-path copies per sweep). |
| `variant-server/smoke.mjs` | Protocol test for all three variants. Free to run. |
| `run_eval.py` | Track A runner. Refuses to run if `ANTHROPIC_API_KEY` is set. `--dry-run` renders everything and invokes nothing. Resume-safe: rerunning a sweep skips completed runs. |
| `scorecard.py` | Turns a sweep folder into `scorecard.md`, `scorecard.xlsx`, and `misses.md` (every miss/false-fire with the model's own words, for human tagging). |
| `trackB/make_synthetic.py` | Regenerates the 9 synthetic transcripts + `labels.csv` deterministically. |
| `trackB/replay.py` | Steps each transcript turn by turn through the shipped detector. `--sweep` grids prompts {6,8,10,12} x errors {2,3,4}. |
| `trackB/labels.csv` | Per transcript: the turn a reasonable person would call it stuck, or `none`. Real transcripts start as `TBD` until a human labels them. |
| `trackB/thresholds_report.md` | Precision/recall for the current thresholds and the full grid, plus a recommended operating point (max recall with precision >= 0.9). |
| `trackB/detector-v2/` + `trackB/DETECTOR_V2_SPEC.md` | Proposed detector rewrite (recurrence counting, recovery awareness, first-nudge fix) with replay evidence: precision 0.50 to 1.00 on the labeled set. Spec for Rohit; shipped plugin untouched. |
| `gtm/` | Draft go-to-market kit: registry listings, README rewrite, launch content. Drafts for Pulkit/Rohit approval, not published anywhere. |

## How to rerun everything

```bash
# free checks (no model, no network)
node eval/variant-server/smoke.mjs                 # variant server protocol
python3 eval/run_eval.py --dry-run --models sonnet --variants A,B,C
python3 eval/trackB/replay.py --sweep              # Track B, shipped detector

# billed sweeps (Max subscription usage; see SPEC 5.0 preconditions FIRST)
python3 eval/run_eval.py --models sonnet --variants A --runs 5 --sweep-name baseline
python3 eval/scorecard.py eval/results/baseline
```

Before any billed sweep, all four SPEC 5.0 preconditions must hold: no `ANTHROPIC_API_KEY` in the environment, subscription login confirmed via `/status`, programmatic-billing status re-confirmed in Help Center article 15036540, and the platform.claude.com billing dashboard checked after the first sweep (it must show zero API charges).

## What the numbers mean

- **Fire-rate** per scenario: fires/runs, e.g. 4/5. Positives want high, negatives want zero.
- **The headline metric is the false-positive rate on negatives.** A missed offer costs one opportunity; an unwanted offer risks an uninstall.
- **UNSTABLE** (roughly 2-3 of 5) marks scenarios where the model flips; those are copy problems worth reading, not averaging away.
- `misses.md` is where learning happens: every bad run with the model's narration, tagged by a human with why it went wrong.

## Hypothesis outcomes (SPEC 5.3)

Pending the Track A sweeps:

- **H1** (VERIFY underfires most): pending
- **H2** (DELEGATE near 100%): pending
- **H3** (Variant C lifts LOOP recall without lifting negative false-fires): pending
- **H4** (model differences Sonnet vs Opus vs Fable): pending

Track B findings so far (9 labeled synthetics + 1 unlabeled real session; small adversarial set, labels by Pulkit, treat as directional):

1. **Shipped-code quirk:** the renudge-spacing check also floors the FIRST nudge at `RENUDGE_AFTER` (default 10) prompts, so `GAE_MIN_PROMPTS` below 10 does nothing in production today. The sweep couples the two to make the prompt axis real.
2. **The error-signal axis is dead:** 2 vs 3 vs 4 required signals produce identical results everywhere, because the regex counts word occurrences (any failing conversation racks up dozens) rather than distinct or persistent errors.
3. **Two structural false-fire sources:** benign uses of trigger words ("add error handling") and errors that were already fixed (the tail window has no notion of recovery). These cap precision at 0.5 at current thresholds on this set; no combo in the grid reaches the 0.9 precision bar.
4. Raising the prompt floor to 12 trades nothing on this set (recall stays 1.0, precision rises to 0.67) but the real fix is signal quality, not thresholds: distinct-error counting and recovery awareness would attack the false fires directly. Pairs with the responsiveness ledger spec in SPEC 7.2 (Rohit's side).

Full grid and per-transcript detail in `trackB/thresholds_report.md`.
