# Get An Expert (MCP server)

Stuck in an AI coding session? Get An Expert connects you with a real human expert.

This MCP server plugs into Claude Code, Codex, Cursor, Windsurf, VS Code, and other
MCP-capable coding tools. When a session goes in circles, your coding agent can offer
to bring in Get An Expert — and **only with your explicit yes**, it sends one redacted,
structured summary of where you're stuck. That opens a **live chat terminal** where a human
expert joins you — a direct, human-to-human conversation, like texting; no AI reads
it. While the chat is open your session (prompts, agent replies, agent-run commands
with output, file edits) relays live to the expert so they can watch real attempts —
with a RELAY ON indicator, /pause, and /end always under your control.

**Real humans:** every response comes from a human expert — all types of experts,
matched to the problem you're stuck on. No AI-generated answers.

## Install

### Claude Code

```bash
claude mcp add get-an-expert -- npx -y get-an-expert-mcp
```

Or add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "get-an-expert": {
      "command": "npx",
      "args": ["-y", "get-an-expert-mcp"]
    }
  }
}
```

There's also a companion Claude Code plugin that adds deterministic stuck-detection
(a Stop hook that counts repeated failed attempts) on top of this server.

### Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.get-an-expert]
command = "npx"
args = ["-y", "get-an-expert-mcp"]
startup_timeout_sec = 30  # first npx run downloads the package
```

### Cursor (`~/.cursor/mcp.json`) / Windsurf (`~/.codeium/windsurf/mcp_config.json`)

```json
{
  "mcpServers": {
    "get-an-expert": {
      "command": "npx",
      "args": ["-y", "get-an-expert-mcp"]
    }
  }
}
```

### VS Code (`.vscode/mcp.json` — note the `servers` key)

```json
{
  "servers": {
    "get-an-expert": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "get-an-expert-mcp"]
    }
  }
}
```

### Replit

Replit supports remote MCP servers only; a hosted endpoint is on the roadmap.

## How it works

1. **You get stuck.** Ten messages deep, same error, going in circles.
2. **Your agent offers help.** The `offer_expert_help` tool shows you exactly what
   would be sent, what is never sent, and asks for your yes/no. It transmits nothing.
3. **You decide.** Only after you agree does `request_expert_help` send one structured
   summary (goal, attempts, errors, short session summary, tech stack). Secret
   redaction runs on your machine first. In hosts that support MCP elicitation
   (Claude Code, Cursor, VS Code) you also get a native confirmation dialog.
4. **A chat terminal opens and the relay arms.** A window running
   `npx get-an-expert chat <id>` opens (or the command is printed for you). A human
   expert joins you there; while the chat is open, your session relays live to them
   so they see real attempts, not retellings. Every submission comes with a private
   deletion link.
5. **Back-and-forth until unblocked.** You try the fix in your normal session, the
   expert watches it land and advises in the chat. Either side can end it anytime —
   the instant it ends, nothing relays anymore. Afterwards, ask your agent to "apply
   what the expert suggested" and `check_expert_replies` pulls the advice back in.

## Tools

| Tool | Network | What it does |
|---|---|---|
| `offer_expert_help` | none | Returns the offer + consent notice for the user |
| `request_expert_help` | sends to Get An Expert API | After explicit consent, submits the summary, opens the live expert chat, and arms the session relay |
| `check_expert_replies` | reads from Get An Expert API | Fetches the expert's new chat messages for this machine's most recent chat |
| `get_privacy_info` | none | Returns the plain-words data-handling summary |

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `GET_AN_EXPERT_API_URL` | `https://get-an-expert.vercel.app` | API base URL override |

## Privacy Policy

Full policy: https://get-an-expert.vercel.app/privacy · Terms: https://get-an-expert.vercel.app/terms

- **Collected (only when you explicitly agree, per request):** your stated goal, what
  was tried, error messages, a short session summary, tech stack, and a random install
  ID (a UUID stored at `~/.get-an-expert/install-id`, not linked to any account).
  Once you proceed, your chat messages and — only while the chat is open — relayed
  session activity (prompts, agent replies, agent-run commands with output, file
  edits) are collected under that same one-time consent; ending the chat is a hard
  stop the server enforces.
- **Never collected:** your source files, environment variables, or secrets.
  Client-side redaction runs before transmission (the summary, every chat message,
  every relayed event), and a second pass runs server-side. Zero bytes are sent
  before you consent, and nothing relays outside an open chat — no telemetry, no
  background transmission of any kind.
- **Usage & storage:** summaries, chat messages, and relayed events are seen by Get
  An Expert's human experts to help you, and stored with Upstash (Redis); hosting is
  on Vercel. No selling of data, no advertising use, no model training on your data.
- **Retention:** requests, their chat, and their relayed events auto-delete 30 days
  after submission. Every request includes a private deletion link that removes
  everything immediately.

## License

MIT
