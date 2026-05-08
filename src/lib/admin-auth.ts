import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import type { HumanUserRecord } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";

function normalizeEmail(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function configuredAdminEmails() {
  return new Set(
    (process.env.OTTOAUTH_ADMIN_EMAILS || "")
      .split(",")
      .map(normalizeEmail)
      .filter(Boolean),
  );
}

export function isAdminUser(user: HumanUserRecord | null | undefined) {
  if (!user) return false;
  const email = normalizeEmail(user.email);
  if (!email) return false;
  const allowed = configuredAdminEmails();
  if (allowed.size > 0) return allowed.has(email);
  return process.env.NODE_ENV !== "production";
}

export function adminAuditEmail(user: HumanUserRecord) {
  return normalizeEmail(user.email) || user.handle_display || `human_${user.id}`;
}

export async function getCurrentAdminUser() {
  const user = await getCurrentHumanUser();
  return isAdminUser(user) ? user : null;
}

export async function requireAdminPageAccess(returnTo = "/admindash") {
  const user = await getCurrentHumanUser();
  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (!isAdminUser(user)) {
    redirect("/dashboard?admin=denied");
  }
  return user;
}

export async function requireAdminApiAccess() {
  const user = await getCurrentHumanUser();
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Admin authentication required." },
        { status: 401 },
      ),
    };
  }
  if (!isAdminUser(user)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Admin access denied." }, { status: 403 }),
    };
  }
  return { ok: true as const, user, email: adminAuditEmail(user) };
}
