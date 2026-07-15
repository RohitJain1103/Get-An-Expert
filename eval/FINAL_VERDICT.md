# Final verdict: Variant E ships

Date: 2026-07-15 · Decider run: `eval/results/2026-07-15-FINAL-E/` (Sonnet, 48 scenarios, n=3, 144 runs, 0 errors)
Compared against: Variant C in `eval/results/2026-07-14-variants-BC/` (same model, same scenarios, same n=3)

## Head to head

| Cell | Variant C | Variant E | Delta | Fisher p |
|---|---|---|---|---|
| LOOP | 14/30 (47%) | 18/30 (60%) | +13 pts | 0.438 |
| VERIFY | 21/24 (88%) | 15/24 (62%) | -25 pts | 0.093 |
| DELEGATE | 15/18 (83%) | 12/18 (67%) | -17 pts | 0.443 |
| DISCOVERY | 2/24 (8%) | 7/24 (29%) | +21 pts | 0.137 |
| **NEGATIVE (false fires)** | **0/48 (0%)** | **0/48 (0%)** | tie | 1.000 |
| **All positives** | **52/96 (54%)** | **52/96 (54%)** | **tie** | 1.000 |

Baseline for scale: Variant A (shipped copy) fired LOOP 10%, VERIFY 0%, DELEGATE 50%, DISCOVERY 0%. Both C and E are large wins over what ships today.

## Read

On this eval, C and E are **statistically indistinguishable**: identical aggregate recall, identical spotless false-fire record, and no per-cell difference reaches significance (all p > 0.05; VERIFY at p=0.093 is the closest to real). They are not better or worse than each other, they spend their firing differently:

- **E is stronger where volume and growth live:** LOOP (the most common real situation) and DISCOVERY, where E fixed two scenarios C never fired on at all (X3 onboarding drop-off 0/3 -> 3/3, X4 evaluating a freelancer 0/3 -> 2/3).
- **C is stronger where intent is highest:** VERIFY and DELEGATE.

## Why E ships anyway

Pulkit's stated goal from the outset: "We do want more and more discovery of what use cases people might use the MCP for. Leave the exploration use cases open so that if there are some cases we would have not thought of, we still get those escalations, including design and other stuff."

E is the only variant that delivers that. C's open clause is nearly inert (8%); E's concrete judgment examples make it fire 3.6x more often, on exactly the unlisted cases the product wants to discover. E also wins the highest-volume cell. Recall is a tie and the uninstall-risk metric is a tie, so the strategic goal is the correct tiebreaker.

## Known cost of choosing E (fix in the next variant, do not paper over)

E introduced three total misses that C at least sometimes caught:

| Scenario | C | E | Why it matters |
|---|---|---|---|
| D6 "you mentioned an expert thing earlier, how does that work?" | 2/3 | **0/3** | The single most explicit intent in the whole set. A user asking about the tool by name should fire ~100%. This is the most alarming regression. |
| D5 "I don't want to learn this, what are my options?" | 1/3 | 0/3 | Indirect delegation ask. |
| V4 "can you check nobody can see other people's invoices?" | 1/3 | 0/3 | IDOR verification. |

Hypothesis for the next iteration: E's heavy loop emphasis ("This is not optional in loop situations") pulls attention toward loops and away from explicit asks. A variant F that keeps E's judgment clause and loop language while restoring an explicit "if the user asks about this tool or asks for a human, always offer" line should recover D5/D6 without giving back LOOP or DISCOVERY.

## Caveats

- n=3 per scenario. Enough to rank cells, not enough to separate two close variants; that is exactly what happened.
- Sonnet only. Opus and Fable confirmation sweeps were never run.
- Scripted scenarios, embedded-transcript injection (constant across all variants, so comparisons hold).
