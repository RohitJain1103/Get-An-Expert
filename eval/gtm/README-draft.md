# Proposed root README rewrite (draft, do not merge blind)

Replace the hero section of the repo/npm README with the below. Body sections
follow. Compare against the current README before merging; keep any existing
technical accuracy fixes.

---

# Get An Expert

**A real human expert for your stuck AI coding session.**

Your AI said "fixed" three times. The error is still there. It is 11pm and the demo is tomorrow.

Get An Expert lets your coding agent do the one thing it cannot do alone: bring in a person. With your explicit consent it sends one structured summary of where the session is stuck, and a live human expert joins you in a chat while your session relays to them, so they watch real attempts instead of retellings.

## Install

Claude Code:
```
claude mcp add get-an-expert -- npx -y get-an-expert-mcp
```

Want automatic stuck detection too? Install the plugin instead:
```
/plugin marketplace add RohitJain1103/Get-An-Expert
/plugin install get-an-expert
```

Codex, Cursor, Windsurf, VS Code: add the standard MCP config block (see below).

## What happens, step by step

1. **You get stuck.** The same error keeps recurring, or you ask "is this actually safe to launch?", or you say "can a human just do this?"
2. **Your agent shows an offer.** The offer includes the full consent notice: exactly what would be sent, what is never sent, retention, deletion. At this point, nothing has left your machine.
3. **You say yes (or no).** No means no; the agent will not re-offer in that session. Yes sends one summary: goal, attempts, errors, tech stack. Secret redaction runs locally first.
4. **A human joins.** Live chat opens. While it is open, your session relays live (prompts, replies, commands, edits) with a visible RELAY ON indicator. /pause pauses. /end stops it, enforced server-side.
5. **You get unstuck.** Ask your agent to apply what the expert suggested. Everything auto-deletes in 30 days, or immediately via your private deletion link.

## What is never sent

Your source files. Your environment variables. Your secrets. Redaction runs on your machine before transmission and again server-side, in both directions. No AI reads the chat. No training on your data. No selling of data.

## Privacy, in one paragraph

Nothing is transmitted until you explicitly agree to a specific request. If you agree, exactly one structured summary is sent, plus the live chat and relay you can pause or kill at any moment. Every request auto-deletes after 30 days and carries a private deletion link that removes everything immediately. Full policy: [privacy] · Terms: [terms]

## FAQ

**Is this AI answering me?** No. The whole point is a human. Your summary is reviewed by a person and the chat is human-to-human.

**What does it cost?** [pricing placeholder: fill before launch]

**Who are the experts?** [expert vetting story placeholder: fill before launch; this is the second question every user asks]

**Can I use it without the automatic detection?** Yes. The MCP server alone never detects anything in the background; offers only appear when the conversation itself warrants one, and detection nudges come only from the optional plugin.

---

## Notes for Rohit (not part of the README)

- The two placeholders (pricing, expert vetting) are load-bearing for conversion; the README should not ship with them empty.
- Add a 30 to 45 second GIF right under the hero: offer appears, user consents, expert joins, RELAY ON indicator visible. That one image does more than every paragraph below it.
- npm description currently says "watches your real attempts": keep that phrase, it tested as the most concrete differentiator in the copy.
