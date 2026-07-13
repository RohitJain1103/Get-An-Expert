"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/id";
import { DASHBOARD_COOKIE, hashPasscode } from "@/lib/dashboard-auth";

export async function loginToDashboard(formData: FormData): Promise<void> {
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
