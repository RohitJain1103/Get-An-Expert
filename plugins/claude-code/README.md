# Get An Expert — Claude Code plugin

Adds deterministic stuck-detection to Claude Code, bundles the Get An Expert MCP
server, and relays your session to a human expert while a live expert chat you
consented to is open.

## What it does

- A **Stop hook** runs after each Claude turn and reads the session transcript
  (locally — nothing is transmitted). When it sees a genuinely stuck session
  (default: 10+ real user prompts AND 3+ recent failure signals) it nudges Claude to
  consider offering Get An Expert. At most 2 nudges per session, spaced out.
- The bundled **MCP server** (`get-an-expert-mcp` via npx) handles the actual offer,
  the consent notice, local secret redaction, the send, and opening the live expert
  chat — nothing is ever transmitted without your explicit yes.
- **Session relay hooks** (UserPromptSubmit / PostToolUse / Stop) forward your
  prompts, Claude's replies, agent-run commands with output, and file edits to
  the human expert — but ONLY while an expert chat you explicitly consented to is
  open. The hooks exit instantly (zero work, nothing sent) unless
  `~/.get-an-expert/relay.json` exists; that file is created at escalation and
  deleted the moment the chat ends, from either side. While relaying, a 🔴 RELAY ON
  line shows on every prompt; `/pause` in the chat terminal pauses relaying, `/end`
  stops everything. Every payload passes local secret redaction before leaving
  your machine.

## Install

```
/plugin marketplace add RohitJain1103/Get-An-Expert
/plugin install get-an-expert@get-an-expert
```

## Tuning

| Env var | Default | Meaning |
|---|---|---|
| `GAE_MIN_PROMPTS` | 10 | User prompts before a nudge is possible |
| `GAE_MIN_ERRORS` | 3 | Failure signals (recent transcript) required |
| `GAE_RENUDGE_AFTER` | 10 | Additional prompts before a second nudge |
| `GAE_MAX_NUDGES` | 2 | Max nudges per session |

Privacy: the stuck-detector reads only the local transcript file Claude Code hands to
hooks and writes a tiny nudge-state file under `~/.get-an-expert/nudges`. The relay
hooks send data only while your consented expert chat is open, always through the
local secret redactor. Data leaves your machine only through the MCP consent flow.
Policy: https://get-an-expert.vercel.app/privacy
