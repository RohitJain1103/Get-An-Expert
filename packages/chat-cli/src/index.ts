#!/usr/bin/env node
import * as readline from "node:readline";
import { ChatClient } from "./client";
import { formatIncoming, parseInput } from "./format";
import { clearRelayFlag, readRelayFlag, writeRelayFlag } from "./relay-file";

const POLL_MS = 2000;
const DEFAULT_API_URL = "https://get-an-expert.vercel.app";

interface CliArgs {
  requestId: string;
  tokenFlag?: string;
}

function parseArgs(argv: string[]): CliArgs | null {
  const [command, requestId, ...rest] = argv;
  if (command !== "chat" || !requestId) return null;
  const tokenIndex = rest.indexOf("--token");
  return {
    requestId,
    tokenFlag: tokenIndex >= 0 ? rest[tokenIndex + 1] : undefined,
  };
}

/** Token: explicit flag > env > relay flag written at escalation. */
function resolveToken(args: CliArgs): string | null {
  if (args.tokenFlag) return args.tokenFlag;
  if (process.env.GET_AN_EXPERT_CHAT_TOKEN) {
    return process.env.GET_AN_EXPERT_CHAT_TOKEN;
  }
  const flag = readRelayFlag();
  return flag && flag.requestId === args.requestId ? flag.chatToken : null;
}

function resolveBaseUrl(args: CliArgs): string {
  if (process.env.GET_AN_EXPERT_API_URL) {
    return process.env.GET_AN_EXPERT_API_URL.replace(/\/$/, "");
  }
  const flag = readRelayFlag();
  if (flag && flag.requestId === args.requestId && flag.apiBaseUrl) {
    return flag.apiBaseUrl.replace(/\/$/, "");
  }
  return DEFAULT_API_URL;
}

/** Clear the in-progress input line, print, restore prompt + typed text. */
function printAbove(rl: readline.Interface, line: string): void {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  console.log(line);
  rl.prompt(true);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.log(
      "Usage: npx get-an-expert chat <requestId> [--token <chatToken>]",
    );
    process.exit(1);
  }
  const token = resolveToken(args);
  if (!token) {
    console.log(
      "No chat token found for this request.\n" +
        "Pass --token <chatToken>, or set GET_AN_EXPERT_CHAT_TOKEN.",
    );
    process.exit(1);
  }

  const { requestId } = args;
  const client = new ChatClient({
    baseUrl: resolveBaseUrl(args),
    requestId,
    token,
  });

  console.log(`Get An Expert — live chat for ${requestId}`);
  console.log(
    "Type to talk — this is a private line to a human; no AI reads it.",
  );
  console.log("/end ends the session for good · /pause pauses relaying\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  let lastSeq = 0;
  let pollInFlight = false;
  let historyReplayed = false;
  let closing = false;

  function shutdown(reason: string): never {
    closing = true;
    clearInterval(timer);
    rl.close();
    console.log(`\n${reason}`);
    process.exit(0);
  }

  function clearOwnRelayFlag(): void {
    const flag = readRelayFlag();
    if (flag?.requestId === requestId) clearRelayFlag();
  }

  async function poll(): Promise<void> {
    if (closing || pollInFlight) return;
    pollInFlight = true;
    try {
      const result = await client.fetchMessages(lastSeq);
      if (!result.ok) return; // transient; next tick retries
      for (const message of result.messages) {
        lastSeq = Math.max(lastSeq, message.seq);
        // Own lines are echoed locally at send time — skip them here, EXCEPT
        // during the initial history replay (rejoins must show both sides).
        if (
          historyReplayed &&
          message.from === "user" &&
          message.kind === "message"
        ) {
          continue;
        }
        printAbove(rl, formatIncoming(message));
      }
      historyReplayed = true;
      if (result.chatStatus === "ended") {
        clearOwnRelayFlag();
        shutdown(
          "— chat ended. Nothing is shared anymore. Your data auto-deletes in 30 days. —",
        );
      }
    } finally {
      pollInFlight = false;
    }
  }

  const timer = setInterval(() => void poll(), POLL_MS);
  await poll();

  rl.prompt();
  rl.on("line", (raw) => {
    void (async () => {
      const input = parseInput(raw);
      switch (input.type) {
        case "empty":
          break;
        case "message": {
          const sent = await client.postMessage(input.text);
          if (sent.ok) {
            printAbove(rl, `[you] ${input.text}`);
          } else if (sent.ended) {
            clearOwnRelayFlag();
            shutdown("— chat ended. Nothing is shared anymore. —");
          } else {
            printAbove(rl, `! ${sent.error}`);
          }
          break;
        }
        case "end": {
          const ended = await client.endChat();
          if (!ended.ok) {
            // Never claim the session is over when the server didn't confirm.
            printAbove(
              rl,
              `! Could not end the chat: ${ended.error ?? "unknown error"} — still open; try /end again.`,
            );
            break;
          }
          clearOwnRelayFlag();
          shutdown(
            "— you ended the chat. Nothing is shared anymore. Your data auto-deletes in 30 days. —",
          );
          break;
        }
        case "pause": {
          const flag = readRelayFlag();
          if (flag?.requestId !== requestId) {
            printAbove(
              rl,
              "· nothing is relaying in this session yet — /pause matters once session relay is on.",
            );
            break;
          }
          const until = new Date(Date.now() + input.minutes * 60_000);
          writeRelayFlag({ ...flag, pausedUntil: until.toISOString() });
          printAbove(
            rl,
            `· relay paused for ${input.minutes} min — the chat stays open.`,
          );
          break;
        }
        case "pause-off": {
          const flag = readRelayFlag();
          if (flag?.requestId === requestId && flag.pausedUntil) {
            const { pausedUntil: _paused, ...rest } = flag;
            writeRelayFlag(rest);
            printAbove(rl, "· relay resumed.");
          } else {
            printAbove(rl, "· relay was not paused.");
          }
          break;
        }
        case "unknown-command":
          printAbove(
            rl,
            `· ${input.command} isn't a command here — only /end and /pause. Anything else you type goes to the expert.`,
          );
          break;
      }
      if (!closing) rl.prompt(true);
    })();
  });

  rl.on("close", () => {
    if (closing) return;
    console.log(
      "\nChat window closed — the session is still open. Run the same command to rejoin, or /end next time to end it.",
    );
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  console.error(
    "get-an-expert:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
