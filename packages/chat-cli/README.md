# get-an-expert

Live terminal chat with a human expert, from [Get An Expert](https://get-an-expert.vercel.app).

When a Get An Expert session is escalated to a human, this opens the chat:

```
npx get-an-expert chat <requestId>
```

It's a plain, private, human-to-human conversation — like texting:

- Type to talk. `[you]` is you, `[<expert name>]` is the expert.
- **No AI reads this chat.** The only automation that touches your messages
  is a local secret redactor (keys/tokens are scrubbed on your machine
  before anything is sent, and again server-side).
- `/end` — end the session for good, from your side. The server refuses
  anything further the instant either side ends.
- `/pause [minutes]` — pause session relaying (once relay ships) without
  ending the chat; `/pause off` resumes.
- Closing the window does NOT end the session — rejoin with the same
  command, or use `/end` to end it.

The chat token comes from the escalation flow (`~/.get-an-expert/relay.json`),
or pass `--token <chatToken>` / set `GET_AN_EXPERT_CHAT_TOKEN` yourself.
Point at a different backend with `GET_AN_EXPERT_API_URL`.

## Session relay

While your chat is open, your working session (prompts, your agent's replies,
agent-run commands with their output, file edits) relays live to the expert so
they can watch
real attempts instead of retellings — that's what you consented to at
escalation. Wiring per editor:

```
npx get-an-expert init claude-code   # relay script only; hooks ship with the plugin
npx get-an-expert init cursor        # + wires ~/.cursor/hooks.json
npx get-an-expert init windsurf      # + wires ~/.codeium/windsurf/hooks.json
```

`init` copies a standalone relay script to `~/.get-an-expert/relay.mjs` and
adds observe-only hook entries (your existing hooks are preserved; a
`.gae-backup` copy is kept). The hooks are inert unless
`~/.get-an-expert/relay.json` exists — that file appears when you consent to
an expert chat and disappears the moment it ends, from either side. Every
relayed payload passes local secret redaction before leaving your machine.

Terminal A shows a subtle `⟢ your last run is visible to <expert>` line as
events land. Known limitation: Windsurf's hooks don't expose command output,
so the expert sees the command line only there.

Everything auto-deletes after 30 days and is covered by the request's
private deletion link. Privacy: https://get-an-expert.vercel.app/privacy
