import { NextResponse } from "next/server";
import {
  clearGoogleLoginCookies,
  consumeGoogleLoginState,
  exchangeGoogleCodeForProfile,
  setHumanSessionCookie,
} from "@/lib/human-session";
import { upsertHumanUserFromGoogle } from "@/lib/human-accounts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state")?.trim() ?? "";
  const code = url.searchParams.get("code")?.trim() ?? "";
  const error = url.searchParams.get("error")?.trim() ?? "";

  const finalize = (response: NextResponse) => {
    clearGoogleLoginCookies(response);
    return response;
  };

  if (error) {
    return finalize(
      NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error)}`, url.origin),
      ),
    );
  }

  if (!state || !code) {
    return finalize(
      NextResponse.redirect(
        new URL("/login?error=missing_google_code", url.origin),
      ),
    );
  }

  const stateResult = await consumeGoogleLoginState({ state });
  if (!stateResult) {
    return finalize(
      NextResponse.redirect(
        new URL("/login?error=invalid_google_state", url.origin),
      ),
    );
  }

  try {
    const profile = await exchangeGoogleCodeForProfile(code);
    const { user } = await upsertHumanUserFromGoogle({
      email: profile.email,
      googleSub: profile.sub,
      emailVerified: Boolean(profile.email_verified),
      displayName: profile.name,
      pictureUrl: profile.picture,
      referralCode: stateResult.referralCode,
    });

    const response = NextResponse.redirect(
      new URL(stateResult.returnTo || "/dashboard", url.origin),
    );
    await setHumanSessionCookie(response, user.id);
    return finalize(response);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "google_auth_failed";
    return finalize(
      NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(message)}`, url.origin),
      ),
    );
  }
}
