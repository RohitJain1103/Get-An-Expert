# Decider: E vs F (undecided, pending manual review)

Date: 2026-07-15 · Run: `eval/results/2026-07-15-DECIDER-EF/` (gitignored, local only)
Sonnet, 48 scenarios, n=5, 480 runs, 0 errors. Both variants re-run in the same
sweep so no cross-day drift.

Status: **no winner picked.** Both variants are committed for manual evaluation.
The product server (`packages/mcp-server/src/index.ts`) is untouched by this call.

## What F is

F is E verbatim plus one sentence in the opening paragraph, at byte 223:

> If the user asks for a human, asks about this tool, or follows up on an
> earlier mention of it, always offer: that is an ask to act on, not a question
> to answer.

Tool descriptions are byte-identical to E. One variable, one line.

Purpose: recover D5/D6/V4, the three scenarios E lost to C in the previous
sweep. Hypothesis was that E's loop emphasis pulled attention away from
explicit asks.

## Head to head

| Cell | E | F | Delta | Fisher p |
|---|---|---|---|---|
| LOOP | 35/50 (70%) | 32/50 (64%) | -6 pts | 0.671 |
| VERIFY | 25/40 (62%) | 24/40 (60%) | -2 pts | 1.000 |
| DELEGATE | 19/30 (63%) | 20/30 (67%) | +3 pts | 1.000 |
| DISCOVERY | 14/40 (35%) | 15/40 (38%) | +2 pts | 1.000 |
| **NEGATIVE (false fires)** | **0/80** | **0/80** | tie | 1.000 |
| **All positives** | **93/160 (58%)** | **91/160 (57%)** | -1 pt | 0.910 |

## Read

E and F are **statistically indistinguishable** in aggregate. No cell moves;
every p is far from significance. Both hold a spotless false-fire record across
80 negatives each. At n=5 this tie is better evidenced than the n=3 C vs E tie.

The one real difference is the scenario F was built for:

| Scenario | C (old) | E | F | Note |
|---|---|---|---|---|
| D6 "you mentioned that expert thing earlier, how does that work?" | 2/3 | 2/5 | **5/5** | Most explicit intent in the set. F fires every time. |
| D5 "I don't want to learn this, what are my options?" | 1/3 | 0/5 | 0/5 | **Not fixed.** |
| V4 "can you check nobody can see other people's invoices?" | 1/3 | 0/5 | 0/5 | **Not fixed.** |

D6 alone is p ~ 0.167: not significant in isolation. It is credible because it
was a prespecified hypothesis with a mechanism, and 5/5 is the ceiling.

Note that E's item 3 already said "or directly references this tool" and still
fired only 2/5. F adds no new information. It hoists the same rule out of a
numbered list into an unconditional line at the top. Position and framing beat
completeness.

## Do not over-read the per-scenario table

These swung by >=2 between variants, but every cell they roll into landed at
p ~ 1.0. This is n=5 scenario-level noise, not signal. Listed for completeness
only; do not build a story on them.

| Scenario | Cell | E | F |
|---|---|---|---|
| D4 | DELEGATE | 5/5 | 3/5 |
| D6 | DELEGATE | 2/5 | 5/5 |
| L6 | LOOP | 0/5 | 2/5 |
| L7 | LOOP | 5/5 | 2/5 |
| L8 | LOOP | 3/5 | 1/5 |
| V2 | VERIFY | 0/5 | 3/5 |
| V7 | VERIFY | 4/5 | 2/5 |
| X4 | DISCOVERY | 4/5 | 2/5 |

## Byte cap on server instructions: measured 2026-07-15

`index.ts` carried an unsourced comment claiming a 2KB truncation cap. It is
wrong. Measured by probe (identical rule placed at controlled byte offsets, full
trigger content held at the head, n=8, Rust-loop scenario):

| Rule at byte | Result | Implies |
|---|---|---|
| 0 | 0/8 fired (obeyed) | read |
| 1319 | 1/8 fired (obeyed) | read |
| 2250-2396 | 1/8 fired (obeyed) | **cap >= 2400** |
| 2700-2846 | 7/8 fired (ignored) | **cap < 2700** |

**The cap is in [2400, 2700). Instructions past ~2400 bytes do not reach the
model.** Not pinned tighter; treat ~2400 as the working budget.

Consequences:
- E is 2211 bytes: fully delivered. The C vs E verdict is NOT confounded.
- F is 2373 bytes: fully delivered, 27 bytes of headroom. Tight. Anyone editing
  this copy must re-check the budget.
- An earlier F draft was 2656 bytes. Its final paragraph, including "This is not
  optional in loop situations", fell past the cap and would have been silently
  dropped, producing a fake "F loses LOOP" result.

Related: the instructions channel carries nearly all the firing power. From the
BC sweep, tool descriptions alone fire 16/112 (14%); descriptions plus
instructions fire 52/96 (54%). A cap on that channel is therefore load-bearing.

## Known gaps

- D5 and V4 remain unfixed by both variants. F's line only catches asks that
  name the tool. These need their own variant.
- n=5 separates cells, not two variants differing by one sentence. A real
  E-vs-F separation would need substantially more runs.
- Sonnet only. Opus and Fable confirmation sweeps never run.
- Scripted scenarios, embedded-transcript injection (constant across variants,
  so comparisons hold).
- Both variants inherit em dashes from E's copy, which violates the project's
  no-em-dash rule. Kept deliberately so F differed from E by exactly one
  variable. Clean up whichever variant ships.
