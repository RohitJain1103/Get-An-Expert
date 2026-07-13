# Get An Expert — Claude Code plugin

Adds deterministic stuck-detection to Claude Code and bundles the Get An Expert MCP
server.

## What it does

- A **Stop hook** runs after each Claude turn and reads the session transcript
  (locally — nothing is transmitted). When it sees a genuinely stuck session
  (default: 10+ real user prompts AND 3+ recent failure signals) it nudges Claude to
  consider offering Get An Expert. At most 2 nudges per session, spaced out.
- The bundled **MCP server** (`get-an-expert-mcp` via npx) handles the actual offer,
  the consent notice, local secret redaction, and the send — nothing is ever
  transmitted without your explicit yes.

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

Privacy: the hook reads only the local transcript file Claude Code hands to hooks and
writes a tiny nudge-state file under `~/.get-an-expert/nudges`. Data leaves your
machine only through the MCP consent flow. Policy: https://get-an-expert.vercel.app/privacy
