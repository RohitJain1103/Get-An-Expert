# Registry and directory listings (drafts for approval)

All copy below is directory-safe: factual function statements, no agent-directed
manipulation, no growth-hack phrasing. Consistent one-liner everywhere so the
product is recognizable across directories. No em dashes anywhere.

## The one-liner (use verbatim everywhere)

> Stuck in your AI coding session? Get An Expert brings a real human expert into it, with your consent, in minutes.

## Short description (under 160 chars, for cards and search results)

> A real human expert joins your stuck coding session. Consent-first: nothing is sent until you say yes. Live chat, session relay, secrets redacted locally.

## Long description (MCP Registry, Smithery, PulseMCP, mcp.so, Glama)

Get An Expert is an MCP server that connects you with a live human expert when your AI coding session is stuck: the same error keeps coming back, you need someone to verify your app is safe to launch, or you just want a person to take over.

How it works:

1. Your agent notices you might be stuck and shows you an offer with a full consent notice. Nothing has been sent at this point.
2. Only if you say yes, one structured summary goes out: your goal, what was tried, error messages, tech stack. Secrets are redacted on your machine before anything leaves it.
3. A live human-to-human chat opens. While it is open, your session relays to the expert so they watch real attempts instead of your retelling. A RELAY ON indicator shows at all times; /pause pauses, /end stops it for good.

What is never sent: your source files, environment variables, or secrets. Requests auto-delete after 30 days, and every response includes a private deletion link that removes everything immediately. No AI reads the chat, no model trains on your data, no data is sold.

Works in Claude Code, Codex, Cursor, Windsurf, and VS Code.

Tools: `offer_expert_help` (shows the offer and consent notice, sends nothing), `request_expert_help` (sends the summary after your explicit yes), `check_expert_replies`, `get_privacy_info`.

## Install snippets (verify against current README before publishing)

Claude Code (MCP):
```
claude mcp add get-an-expert -- npx -y get-an-expert-mcp
```

Claude Code (plugin, adds stuck-detection nudges):
```
/plugin marketplace add RohitJain1103/Get-An-Expert
/plugin install get-an-expert
```

Codex / Cursor / Windsurf: add to the client's MCP config:
```json
{ "mcpServers": { "get-an-expert": { "command": "npx", "args": ["-y", "get-an-expert-mcp"] } } }
```

## Tags / categories per directory

| Directory | Category | Tags |
|---|---|---|
| MCP Registry (official) | developer-tools | expert-help, human-in-the-loop, debugging, code-review, consent |
| Smithery | Developer Tools | stuck, debugging, human expert, pair programming, live help |
| PulseMCP | Productivity / Dev | human-in-the-loop, escalation, mentorship, debugging |
| mcp.so | Development | expert, human help, debugging, security review |
| Glama | Coding Assistants | human escalation, live chat, session relay |
| npm keywords (append) | n/a | human-in-the-loop, escalation, stuck, live-help, pair-programming |

## Claude Code plugin marketplace entry

Name: Get An Expert
Tagline: A human expert for the moments AI keeps saying "fixed" and it is not.
Description: Adds gentle stuck-session detection to Claude Code plus the Get An Expert MCP server. When the same failure keeps recurring, Claude can offer to bring in a live human expert. Consent-first: the offer sends nothing; data moves only after you explicitly agree, with local secret redaction, a visible relay indicator, and 30-day auto-deletion.

## Positioning guardrails (why the copy reads this way)

- Trust is the whole purchase decision. Privacy mechanics live in the first screen of every listing, never in a footnote.
- Never promise response times or expert credentials we cannot yet guarantee. "In minutes" appears only in the one-liner and should be cut if the SLA cannot back it.
- The uninstall risk is an over-eager tool. Every listing states plainly that the offer transmits nothing; that is our differentiation from "AI tool that phones home".
