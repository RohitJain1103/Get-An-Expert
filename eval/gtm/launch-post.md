# Launch content skeleton (fill numbers from the sweeps before publishing)

Angle: the eval IS the launch story. Nobody else publishes measurements of when
an AI agent should call in a human. Numbers make this credible where "we built
a thing" posts are noise.

## Blog post: "We measured when an AI coding agent should ask for human help"

**Publish on:** get-an-expert site + cross-post dev.to / HN (Show HN)
**Length target:** 1,200 to 1,600 words. Charts over prose where possible.

### Skeleton

1. **The moment everyone knows** (150 words)
   The third "Fixed. Try again." The error that is not fixed. Open with a real
   transcript excerpt (scenario L1 works verbatim). No product mention yet.

2. **The design problem** (200 words)
   An AI agent offering human help is walking a line: miss the moment and the
   user churns out of the session; fire on a first error and they uninstall you.
   State our guiding rule: a false offer is worse than a missed one.

3. **How we measured it** (300 words)
   48 scripted conversations across five situations: stuck loops, "is this safe
   to launch" verification, "just get me a person" delegation, open-ended
   judgment calls, and 16 negatives where offering is wrong. Each run through
   the real Claude Code context assembly, n=5, three copy variants.
   Plainly state the fidelity compromise (embedded transcript) and why
   comparisons remain valid.

4. **What we found** (400 words, the meat)
   - [NUMBER] Baseline offer rate on stuck loops: X%
   - [NUMBER] False-fire rate on negatives: X% (the metric we optimize)
   - [NUMBER] Delegation asks ("can I talk to a real person?"): X%
   - [NUMBER] The verification gap: when users ask "is my app secure enough to
     launch?", the model offers only X% of the time. Models are trained to
     answer, so they answer, even when honest assurance needs a human. [confirm
     H1 held before writing this]
   - [NUMBER] Copy variant C (simpler instructions, fewer guardrails, open to
     unlisted use cases) moved recall from X% to Y% while negatives went from
     X% to Y%. [frame per actual result]
   - The misses file: quote 2 or 3 verbatim model narrations explaining why it
     chose not to offer. This is the part readers screenshot.

5. **The detector nobody sees** (200 words)
   Separate deterministic layer: a Stop hook that counts stuck signals. Replay
   findings: counting "error" mentions false-fires on "add error handling";
   recurrence counting + recovery awareness took precision from 0.50 to 1.00 on
   our labeled set. Small set, honest caveat, link to the harness.

6. **What we shipped** (100 words)
   The winning copy, the v2 detector, and the rule we hold: nothing fires twice
   after a no. Install one-liner. Link to the eval repo folder; the harness is
   public and rerunnable.

### Title alternatives
- We measured when an AI coding agent should ask for human help
- Your AI said "fixed" three times. We measured what should happen next.
- Teaching Claude to say "you need a human"

## X thread (8 posts)

1. Your AI says "Fixed!" for the third time. Same error. We measured exactly
   when a coding agent should offer to call in a human, 48 scenarios, [N] runs.
   What we found:
2. The design problem: offer too late and the user rage-quits the session.
   Offer on a first error and they uninstall you. False offers are worse than
   missed ones. Everything follows from that rule.
3. [CHART: offer rate by situation type] Stuck loops: X%. "Is this safe to
   launch": X%. "Get me a human": X%. Negatives (should NOT offer): X% false
   fires.
4. The verification gap is the finding that matters: ask "is my auth actually
   secure?" and the model answers instead of escalating, X% of the time. Models
   are trained to be helpful, not to know their limits. [confirm H1]
5. Copy matters more than we expected: rewriting the tool's instructions
   (simpler, fewer guardrails, open to cases we didn't list) moved [metric]
   from X% to Y% without raising false fires. [confirm H3]
6. Favorite miss, verbatim from the model: "[quote from misses.md]"
7. The background detector had its own bugs: counting the word "error" false
   fires on "add error handling". Counting recurring failures across turns
   instead: precision 0.50 to 1.00 on our labeled set.
8. Everything is open: the harness, the 48 scenarios, the replay tool. If your
   AI session is stuck right now: [install one-liner] [link]

## Reddit (r/ClaudeAI, r/cursor, r/vibecoding)

Not a launch post. Answer stuck-session threads with genuinely useful debugging
help; mention the tool only where the thread is literally the use case ("I've
been going in circles for an hour"). One karma-building week before any
top-level post. Top-level post later = the eval writeup, framed as research,
with the repo link.

## Distribution checklist

- [ ] Blog post live with real numbers
- [ ] Show HN morning US time, first comment = honest limitations note
- [ ] X thread same day, quote-tweet from personal accounts
- [ ] Registry listings live BEFORE any post (people will search)
- [ ] README GIF recorded
- [ ] Reddit warm-up started a week prior
