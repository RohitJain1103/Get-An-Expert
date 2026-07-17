import { spawn } from "node:child_process";

type SpawnFn = typeof spawn;

/**
 * Best-effort: open the customer chat page in the default browser. Security
 * posture (this package grants an outsider machine access, so the spawn
 * surface stays minimal: approved by Rohit 2026-07-17):
 *   - fixed argv per platform, never a shell string, shell: false
 *   - only http(s) URLs on the configured relay origin
 *   - opt-out via GET_AN_EXPERT_NO_AUTO_OPEN; skipped over SSH / headless
 * Returns whether a spawn was attempted successfully; the chat URL is ALWAYS
 * also printed by the caller, so failure here costs one click, never access.
 */
export function openUrl(
  url: string,
  opts: {
    relayOrigin: string;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    spawner?: SpawnFn;
  },
): boolean {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const spawner = opts.spawner ?? spawn;

  if (env.GET_AN_EXPERT_NO_AUTO_OPEN) return false;
  if (env.SSH_CONNECTION && !process.stdout.isTTY) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.origin !== opts.relayOrigin) return false;

  let cmd: string;
  let args: string[];
  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
    cmd = "xdg-open";
    args = [url];
  }

  try {
    const child = spawner(cmd, args, { detached: true, stdio: "ignore", shell: false });
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
