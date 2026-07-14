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

Everything auto-deletes after 30 days and is covered by the request's
private deletion link. Privacy: https://get-an-expert.vercel.app/privacy
