"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/lib/client-ip";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/id";
import { checkLoginRateLimit } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";
import {
  DASHBOARD_COOKIE,
  hashPasscode,
  isDashboardAuthed,
} from "@/lib/dashboard-auth";
import {
  claimThread,
  markThreadSolved,
  postExpertMessage,
} from "@/lib/usecases";

export async function loginToDashboard(formData: FormData): Promise<void> {
  // Throttle first so this action can't be brute-forced (it's reachable over
  // HTTP directly, not only via the rendered form).
  const gate = await checkLoginRateLimit(getStore(), clientIp(await headers()));
  if (!gate.allowed) {
    redirect("/dashboard?error=throttled");
  }

  const configured = env.dashboardPasscode();
  const attempt = String(formData.get("passcode") ?? "");

  if (configured && attempt && safeEqual(attempt, configured)) {
    (await cookies()).set(DASHBOARD_COOKIE, hashPasscode(configured), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
  }
  redirect("/dashboard");
}

/** Extracts and validates the request id every thread action needs. */
function threadId(formData: FormData): string {
  const id = String(formData.get("id") ?? "");
  if (!/^req_[a-zA-Z0-9-]{1,60}$/.test(id)) redirect("/dashboard");
  return id;
}

export async function claimThreadAction(formData: FormData): Promise<void> {
  if (!(await isDashboardAuthed())) redirect("/dashboard");
  const id = threadId(formData);
  const name = String(formData.get("expertName") ?? "").trim().slice(0, 80);
  if (name) {
    await claimThread(getStore(), id, name);
  }
  redirect(`/dashboard/${id}`);
}

export async function replyToThreadAction(formData: FormData): Promise<void> {
  if (!(await isDashboardAuthed())) redirect("/dashboard");
  const id = threadId(formData);
  const text = String(formData.get("text") ?? "").trim().slice(0, 4000);
  if (text) {
    await postExpertMessage(getStore(), id, text);
  }
  redirect(`/dashboard/${id}`);
}

export async function solveThreadAction(formData: FormData): Promise<void> {
  if (!(await isDashboardAuthed())) redirect("/dashboard");
  const id = threadId(formData);
  await markThreadSolved(getStore(), id);
  redirect(`/dashboard/${id}`);
}
