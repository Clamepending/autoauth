import { NextResponse } from "next/server";
import { signOutCurrentUser } from "@/lib/vibe-id-client";

// Clears the vibe-id session cookie and best-effort revokes the install
// token on the server side, then redirects home.
export async function POST(request: Request) {
  const requestUrl = new URL(request.url);

  // signOutCurrentUser returns its own response with the vibe-id cookie
  // cleared; copy its Set-Cookie headers onto our redirect response.
  const vibeIdSignOutResponse = await signOutCurrentUser();

  const finalResponse = NextResponse.redirect(new URL("/", requestUrl.origin));
  for (const setCookieHeader of vibeIdSignOutResponse.headers.getSetCookie()) {
    finalResponse.headers.append("set-cookie", setCookieHeader);
  }
  return finalResponse;
}
