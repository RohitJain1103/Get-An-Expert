/**
 * Post-submit escalation side effects: arm the session relay, remember the
 * chat locally, best-effort install the relay script and open Terminal A.
 * Everything here is fail-open EXCEPT armRelay — a failed submit message
 * must never be replaced by a failed side effect.
 */
import { spawn } from "node:child_process";
import {
  writeLastChat,
  writeRelayFlag,
} from "@get-an-expert/core/relay";

/**
 * Arms the relay (hooks start relaying on their next firing) and records the
 * chat for post-session retrieval by check_expert_replies.
 */
export function armRelay(
  requestId: string,
  chatToken: string,
  apiBaseUrl: string,
): void {
  writeRelayFlag({ requestId, chatToken, apiBaseUrl });
  writeLastChat({ requestId, chatToken, apiBaseUrl, lastReadSeq: 0 });
}

/**
 * Fire-and-forget install of ~/.get-an-expert/relay.mjs via the published
 * CLI. Also pre-warms the npx cache that Terminal A's join command uses.
 */
export function spawnRelayInstall(host: string): void {
  try {
    spawn("npx", ["-y", "get-an-expert", "init", host, "--quiet"], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch {
    // npx missing or spawn refused — relay hooks stay inert; chat still works.
  }
}

/**
 * Best-effort: open a terminal window running the join command. Returns
 * whether a launcher was spawned — the join command is ALWAYS also printed
 * in the tool message, which is the guaranteed fallback path.
 */
export function openTerminalA(
  joinCommand: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  try {
    if (platform === "darwin") {
      spawn(
        "osascript",
        [
          "-e",
          `tell application "Terminal" to do script ${JSON.stringify(joinCommand)}`,
          "-e",
          'tell application "Terminal" to activate',
        ],
        { detached: true, stdio: "ignore" },
      ).unref();
      return true;
    }
    if (platform === "win32") {
      spawn("cmd", ["/c", "start", "cmd", "/k", joinCommand], {
        detached: true,
        stdio: "ignore",
        shell: false,
      }).unref();
      return true;
    }
    // Linux: try the common launchers; first spawn that doesn't throw wins.
    const candidates: [string, string[]][] = [
      ["x-terminal-emulator", ["-e", `sh -c ${JSON.stringify(joinCommand)}`]],
      ["gnome-terminal", ["--", "sh", "-c", joinCommand]],
      ["konsole", ["-e", "sh", "-c", joinCommand]],
    ];
    for (const [bin, args] of candidates) {
      try {
        spawn(bin, args, { detached: true, stdio: "ignore" }).unref();
        return true;
      } catch {
        // try the next launcher
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Appended to the submit message so the user always has the join path. */
export function buildChatFooter(
  joinCommand: string,
  terminalOpened: boolean,
): string {
  const opener = terminalOpened
    ? "**A live chat terminal is opening now** — a human expert will meet you there. " +
      `If it didn't appear, run \`${joinCommand}\` in any terminal.`
    : `**Join the live expert chat:** run \`${joinCommand}\` in any terminal ` +
      "(split panes work great) — a human expert will meet you there.";
  return [
    "---",
    "",
    opener,
    "",
    "From now until that chat ends, this session (your prompts, agent-run " +
      "commands and their output, file edits) is relayed live to the expert — " +
      "you'll see a RELAY ON indicator while it's active. Type /end in the " +
      "chat to stop everything, /pause to pause relaying.",
  ].join("\n");
}
