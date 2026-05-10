import { NextResponse } from "next/server";
import { clearHumanSessionCookie } from "@/lib/human-session";
import { signOutCurrentUser } from "@/lib/vibe-id-client";

// Clears both the new vibe-id session cookie AND the legacy
// ottoauth_human_session cookie so users are signed out cleanly during the
// migration window. Best-effort calls vibe-id /auth/signout to revoke the
// install token on the server side.
export async function POST(request: Request) {
  const requestUrl = new URL(request.url);

  // signOutCurrentUser returns its own response with the vibe-id cookie
  // cleared; we copy its Set-Cookie headers onto our redirect response.
  const vibeIdSignOutResponse = await signOutCurrentUser();

  const finalResponse = NextResponse.redirect(new URL("/", requestUrl.origin));
  for (const setCookieHeader of vibeIdSignOutResponse.headers.getSetCookie()) {
    finalResponse.headers.append("set-cookie", setCookieHeader);
  }
  await clearHumanSessionCookie(finalResponse);
  return finalResponse;
}
