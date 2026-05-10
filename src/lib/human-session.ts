import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createHumanSession,
  deleteHumanSession,
  ensureHumanForVibeIdUser,
  findHumanByVibeIdUserId,
  type HumanUserRecord,
} from "@/lib/human-accounts";
import { getCurrentVibeUser } from "@/lib/vibe-id-client";

const SESSION_COOKIE_NAME = "ottoauth_human_session";

function cookieSecure() {
  return process.env.NODE_ENV === "production";
}

export function isDevHumanLoginEnabled() {
  if ((process.env.OTTOAUTH_ENABLE_DEV_HUMAN_LOGIN ?? "").trim() === "1") return true;
  return process.env.NODE_ENV !== "production";
}

/// Returns the signed-in human (or null). The vibe-id install token in the
/// `vibe_id_session` cookie is the only supported web-session auth path.
/// `setHumanSessionCookie` (used by /api/auth/dev-login) writes a separate
/// cookie that is intentionally NOT honored here — dev-login is for
/// scripted smoke tests, not for replacing the production sign-in path.
export async function getCurrentHumanUser(): Promise<HumanUserRecord | null> {
  const vibeIdMe = await getCurrentVibeUser();
  if (!vibeIdMe) return null;

  const linkedHumanUser = await findHumanByVibeIdUserId(vibeIdMe.user.id);
  if (linkedHumanUser) return linkedHumanUser;

  // First time this vibe-id user has signed in to autoauth — create or
  // claim the local row. ensureHumanForVibeIdUser handles the "user
  // existed locally with the same email but wasn't yet linked" case too.
  return ensureHumanForVibeIdUser({
    vibeIdUserId: vibeIdMe.user.id,
    email: vibeIdMe.user.email,
    displayName: vibeIdMe.user.display_name,
    pictureUrl: vibeIdMe.user.picture_url,
  });
}

export async function requireCurrentHumanUser() {
  const user = await getCurrentHumanUser();
  if (!user) {
    throw new Error("Human authentication required.");
  }
  return user;
}

/// Used by /api/auth/dev-login (scripted smoke tests only). Writes the
/// legacy `ottoauth_human_session` cookie. NOT read by getCurrentHumanUser
/// in production — verify scripts that use this also send the cookie back
/// on subsequent requests, but the production read path goes through
/// vibe-id only.
export async function setHumanSessionCookie(response: NextResponse, humanUserId: number) {
  const { sessionToken, expiresAt } = await createHumanSession({ humanUserId });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionToken,
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearHumanSessionCookie(response: NextResponse) {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value?.trim() ?? "";
  if (sessionToken) {
    await deleteHumanSession(sessionToken).catch(() => {});
  }
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: new Date(0),
  });
}

export function getHumanAuthDisplayName(user: HumanUserRecord) {
  return user.display_name?.trim() || user.email;
}
