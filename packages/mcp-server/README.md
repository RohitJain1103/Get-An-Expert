# Get An Expert (MCP server)

Stuck in an AI coding session? Get An Expert connects you with a real human expert.

This MCP server plugs into Claude Code, Codex, Cursor, Windsurf, VS Code, and other
MCP-capable coding tools. When a session goes in circles, your coding agent can offer
to bring in Get An Expert — and **only with your explicit yes**, it sends one redacted,
structured summary of where you're stuck. A human expert reviews it and responds with
a diagnosis plus the exact next steps.

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
4. **An expert takes it from there.** A human expert reviews your summary and responds
   with a diagnosis of why the session stalled plus the exact next steps. Every
   submission comes with a private deletion link.

## Tools

| Tool | Network | What it does |
|---|---|---|
| `offer_expert_help` | none | Returns the offer + consent notice for the user |
| `request_expert_help` | sends to Get An Expert API | After explicit consent, submits the summary for expert review |
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
- **Never collected:** your source files, full conversation transcripts, environment
  variables, or secrets. Client-side redaction runs before transmission, and a second
  pass runs server-side. Zero bytes are sent before you consent — there is no
  telemetry and no background transmission of any kind.
- **Usage & storage:** summaries are reviewed by Get An Expert's human experts to
  write your response, and stored with Upstash (Redis); hosting is on Vercel. No
  selling of data, no advertising use, no model training on your data.
- **Retention:** requests auto-delete after 30 days. Every response includes a private
  deletion link that removes it immediately.
- **Contact:** sweetcodeyrs@gmail.com

## License

MIT
