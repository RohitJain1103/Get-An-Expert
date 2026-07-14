# Detector v2 Spec (for Rohit)

Status: proposal with a working reference implementation and replay evidence.
Reference code: `eval/trackB/detector-v2/detect-stuck-v2.mjs` (same hook contract as shipped; drop-in shape for `plugins/claude-code/bin/detect-stuck.mjs`).
Acceptance test: `eval/trackB/replay.py` precision/recall tables. Nothing ships without a replay run over the labeled transcript set.

## Why change anything

Replaying the shipped detector over 9 labeled synthetic transcripts plus 1 real session (2026-07-14) surfaced three problems:

1. **The first nudge is accidentally floored at 10 prompts.** The renudge-spacing check (`userPrompts < lastNudgePromptCount + RENUDGE_AFTER_PROMPTS`) runs with `lastNudgePromptCount = 0` before any nudge exists, so `GAE_MIN_PROMPTS` below 10 is unreachable. Threshold tuning below 10 is currently dead code.
2. **The error count measures mention, not failure.** The regex counts every occurrence of words like "error" in the last 400 lines. A productive session that says "add error handling to the upload function" false-fires. Any genuinely failing conversation racks up dozens of matches instantly, which also makes the 2 vs 3 vs 4 signal threshold meaningless (identical results across the whole grid).
3. **No notion of recovery.** Errors fixed five turns ago still count. A session that hit a rough patch, got past it, and is now shipping features false-fires on its own history.

Net effect: precision 0.50 at current thresholds on the adversarial set, and no combination in the {6,8,10,12} x {2,3,4} grid reaches 0.9.

## The three rules

### R1: first-nudge decoupling
Spacing between nudges applies only when a nudge already happened:

```js
if (state.nudgeCount > 0 &&
    userPrompts < state.lastNudgePromptCount + RENUDGE_AFTER_PROMPTS) return;
```

One-line change. Makes the prompt floor a real, tunable dial.

### R2: count recurrence turns, not failure words
A signal is a *turn* (user message plus the assistant reply that followed it) containing a **recurrence phrase**: "same error", "still failing", "keeps crashing", "error ... again", "not working", "didn't work", "nothing works", "going in circles", "no change". Bare failure-word mentions do not count. The count is taken over a window of the last `GAE_WINDOW_TURNS` (default 6) user turns, and the threshold `GAE_MIN_ERRORS` (default 3, recommend 4) is "recurrence turns inside the window".

Why turns, not matches: one long rant can contain five matches; five separate turns saying the same fix keeps failing is what stuckness actually looks like.

### R3: recovery check
If the newest `GAE_CLEAN_TURNS` (default 2) turns contain no failure mention at all, suppress the nudge. Old errors that stopped appearing are history, not stuckness.

Everything else stays as shipped: max 2 nudges per session, state file location and shape, hook input/output contract, 4MB transcript tail cap, nothing transmitted anywhere.

## Evidence (replay, 9 labeled synthetics)

Shipped detector, best case anywhere in the grid: precision 0.67 (at prompts=12). Current (10,3): **precision 0.50**.

Detector v2 on the same transcripts and labels:

| min_prompts | recurrence turns (of last 6) | precision | recall |
|---|---|---|---|
| 10 | 3 | 0.75 | 1.00 |
| 6 | 4 | **1.00** | **1.00** |
| 8 | 4 | **1.00** | **1.00** |
| 10 | 4 | **1.00** | **1.00** |
| 12 | any | 1.00 | 1.00 |

The two structural false-fire sources (benign mentions, recovered sessions) are eliminated by R2 and R3 respectively; remaining low-threshold false positives in the v2 grid are premature fires (nudging 1 to 2 turns before the human label), which R2's turn-counting keeps rare.

**Recommended operating point: prompts >= 8, recurrence turns >= 4 of the last 6, clean turns = 2.** That fires earlier than today's floor of 10 while being strictly more precise. Conservative alternative: keep prompts >= 10.

Honest caveats: the transcript set is small, synthetic-heavy, and labeled by us. Before shipping, add 3 to 5 labeled real sessions (Pulkit's and Rohit's) to `transcripts/real/` + `labels.csv` and require: precision >= 0.9 and recall >= shipped on the full set.

## Interaction with the responsiveness ledger (SPEC 7.2)

The ledger's raise/lower rules move exactly these dials, which R1 makes real:
- After 1 decline with no accept: prompts +4, recurrence turns +1, max 1 nudge.
- After 2 consecutive declines: mute proactive nudges 5 sessions.
- Any accept: reset. Lifetime accepts >= 2: prompts -2.

Track B tests the composition as a pure function: (ledger state, transcript) -> nudge decision. The replay harness already supports this via env overrides.

## Rollout

1. Land v2 behind the existing env vars (defaults = recommended operating point).
2. Re-run `python3 eval/trackB/replay.py --sweep` against the enlarged labeled set; paste the table into the PR.
3. Ship. Ledger follows as its own change, tested the same way.
