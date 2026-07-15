# Security

## Reporting a vulnerability

Please report security issues privately via GitHub's **Report a vulnerability**
button (Security → Advisories) on this repository, rather than opening a public
issue. We aim to respond within a few days.

## What `get-an-expert-agent` does, plainly

The agent lets a remote human expert act on your machine to help you fix a bug.
Because that is powerful, the whole design is built around your consent and
control:

- **Nothing runs without your approval.** Access is requested inline in your own
  AI coding tool via MCP elicitation. You approve individual scopes — Files,
  Terminal, Browser — before anyone connects. If your client can't prompt you,
  nothing is granted (fail-closed).
- **Scoped.** Files and terminal are confined to the project directory; paths
  that escape it are refused. Browser access is pinned to the one localhost port
  you approved.
- **Revocable.** Revoking a scope makes the next matching action fail
  immediately; revoking Terminal kills any live shell at once.
- **Per-session.** Ending the session revokes everything.
- **Visible.** You get a live log of every action the expert takes (action +
  target — never the file contents or command output themselves).
- **Peer-to-peer.** Session data flows directly between the two machines over
  encrypted WebRTC. The relay only handles the connection handshake and session
  metadata; it never sees your files, terminal output, or browser data.

## Operating safely

- **Run the relay on loopback** (the default). Only expose it to a network
  (`GET_AN_EXPERT_HOST=0.0.0.0`) behind your own authentication and firewall —
  it coordinates terminal/file access and must not be openly reachable.
- **Treat expert tokens as secrets.** Anyone with a valid token can appear in the
  expert queue.
- **Only grant the scopes you need**, and end the session when you're done.

## Scope of this document

This covers `get-an-expert-agent`, `get-an-expert-relay`, and the expert
dashboard. It is not a warranty; review the code (it's MIT-licensed and open)
before granting access on sensitive machines.
