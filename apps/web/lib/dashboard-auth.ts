import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { env } from "./env";

export const DASHBOARD_COOKIE = "gae_dash";

export const hashPasscode = (value: string): string =>
  createHash("sha256").update(`gae:${value}`).digest("hex");

/** True when the request carries a cookie matching the configured passcode. */
export async function isDashboardAuthed(): Promise<boolean> {
  const passcode = env.dashboardPasscode();
  if (!passcode) return false;
  const cookie = (await cookies()).get(DASHBOARD_COOKIE)?.value;
  return cookie === hashPasscode(passcode);
}
