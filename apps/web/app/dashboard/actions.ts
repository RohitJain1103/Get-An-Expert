"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/lib/client-ip";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/id";
import { checkLoginRateLimit } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";
import { DASHBOARD_COOKIE, hashPasscode } from "@/lib/dashboard-auth";

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
