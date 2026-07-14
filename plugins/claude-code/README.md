# Get An Expert — Claude Code plugin

Adds deterministic stuck-detection to Claude Code and bundles the Get An Expert MCP
server.

## What it does

- A **Stop hook** runs after each Claude turn and reads the session transcript
  (locally — nothing is transmitted). When it sees a genuinely stuck session
  (default: 10+ real user prompts AND 3+ recent failure signals) it nudges Claude to
  consider offering Get An Expert. At most 2 nudges per session, spaced out.
- A second **reply-ping hook** watches your open expert thread (at most one poll
  per 45s, using only the thread credentials the MCP server stored after your
  consent) and tells Claude when the expert has replied, so the reply is relayed
  to you without asking.
- The bundled **MCP server** (`get-an-expert-mcp` via npx) handles the actual offer,
  the consent notice, local secret redaction, the send, and the expert thread —
  nothing is ever transmitted without your explicit yes.

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
| `GAE_REPLY_POLL_SECONDS` | 45 | Minimum seconds between expert-reply polls |

Privacy: the stuck-detector reads only the local transcript file Claude Code hands to
hooks; the reply-ping polls only your own thread using credentials created after your
explicit consent. Both keep tiny state files under `~/.get-an-expert/nudges`. Data
leaves your machine only through the MCP consent flow.
Policy: https://get-an-expert.vercel.app/privacy
