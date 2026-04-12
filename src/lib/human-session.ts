import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createHumanSession,
  deleteHumanSession,
  getHumanUserBySessionToken,
  parseHumanReferralCode,
  type HumanUserRecord,
} from "@/lib/human-accounts";

const SESSION_COOKIE_NAME = "ottoauth_human_session";
const GOOGLE_STATE_COOKIE_NAME = "ottoauth_google_state";
const GOOGLE_RETURN_TO_COOKIE_NAME = "ottoauth_google_return_to";
const GOOGLE_REFERRAL_COOKIE_NAME = "ottoauth_google_ref";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

type GoogleProfile = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

function cookieSecure() {
  return process.env.NODE_ENV === "production";
}

function baseUrlFromEnv() {
  return (
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

function sanitizeReturnTo(returnTo: string) {
  if (!returnTo.startsWith("/")) return "/dashboard";
  if (returnTo.startsWith("//")) return "/dashboard";
  return returnTo;
}

function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
}

function getGoogleClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
}

export function isGoogleAuthConfigured() {
  return Boolean(getGoogleClientId() && getGoogleClientSecret());
}

export function isDevHumanLoginEnabled() {
  if ((process.env.OTTOAUTH_ENABLE_DEV_HUMAN_LOGIN ?? "").trim() === "1") return true;
  return process.env.NODE_ENV !== "production";
}

export function getGoogleRedirectUri() {
  return `${baseUrlFromEnv()}/api/auth/google/callback`;
}

export async function getCurrentHumanUser() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value?.trim() ?? "";
  if (!sessionToken) return null;
  return getHumanUserBySessionToken(sessionToken);
}

export async function requireCurrentHumanUser() {
  const user = await getCurrentHumanUser();
  if (!user) {
    throw new Error("Human authentication required.");
  }
  return user;
}

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

export async function createGoogleLoginRedirect(
  returnTo = "/dashboard",
  referralCode?: string | null,
) {
  if (!isGoogleAuthConfigured()) {
    throw new Error("Google auth is not configured.");
  }

  const state = randomBytes(20).toString("hex");
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", getGoogleClientId());
  url.searchParams.set("redirect_uri", getGoogleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("access_type", "offline");

  const response = NextResponse.redirect(url);
  response.cookies.set({
    name: GOOGLE_STATE_COOKIE_NAME,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 10 * 60,
  });
  response.cookies.set({
    name: GOOGLE_RETURN_TO_COOKIE_NAME,
    value: sanitizeReturnTo(returnTo || "/dashboard"),
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 10 * 60,
  });
  const normalizedReferralCode = parseHumanReferralCode(referralCode);
  if (normalizedReferralCode) {
    response.cookies.set({
      name: GOOGLE_REFERRAL_COOKIE_NAME,
      value: String(normalizedReferralCode),
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure(),
      path: "/",
      maxAge: 10 * 60,
    });
  } else {
    response.cookies.set({
      name: GOOGLE_REFERRAL_COOKIE_NAME,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure(),
      path: "/",
      expires: new Date(0),
    });
  }
  return response;
}

export async function consumeGoogleLoginState(params: {
  state: string;
}) {
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GOOGLE_STATE_COOKIE_NAME)?.value?.trim() ?? "";
  const returnTo = sanitizeReturnTo(
    cookieStore.get(GOOGLE_RETURN_TO_COOKIE_NAME)?.value?.trim() || "/dashboard",
  );
  const referralCode = parseHumanReferralCode(
    cookieStore.get(GOOGLE_REFERRAL_COOKIE_NAME)?.value,
  );

  if (!expectedState || expectedState !== params.state.trim()) {
    return null;
  }

  return {
    returnTo,
    referralCode: referralCode ? String(referralCode) : null,
  };
}

export function clearGoogleLoginCookies(response: NextResponse) {
  response.cookies.set({
    name: GOOGLE_STATE_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: new Date(0),
  });
  response.cookies.set({
    name: GOOGLE_RETURN_TO_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: new Date(0),
  });
  response.cookies.set({
    name: GOOGLE_REFERRAL_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    expires: new Date(0),
  });
}

export async function exchangeGoogleCodeForProfile(code: string): Promise<GoogleProfile> {
  if (!isGoogleAuthConfigured()) {
    throw new Error("Google auth is not configured.");
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code: code.trim(),
      client_id: getGoogleClientId(),
      client_secret: getGoogleClientSecret(),
      redirect_uri: getGoogleRedirectUri(),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });

  const tokenPayload = (await tokenResponse.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!tokenResponse.ok || !tokenPayload) {
    const message =
      typeof tokenPayload?.error_description === "string"
        ? tokenPayload.error_description
        : typeof tokenPayload?.error === "string"
          ? tokenPayload.error
          : `Google token exchange failed (${tokenResponse.status}).`;
    throw new Error(message);
  }

  const accessToken =
    typeof tokenPayload.access_token === "string" ? tokenPayload.access_token.trim() : "";
  if (!accessToken) {
    throw new Error("Google token response did not include an access token.");
  }

  const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  const profilePayload = (await profileResponse.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!profileResponse.ok || !profilePayload) {
    throw new Error(`Google userinfo lookup failed (${profileResponse.status}).`);
  }

  const profile: GoogleProfile = {
    sub: typeof profilePayload.sub === "string" ? profilePayload.sub : "",
    email: typeof profilePayload.email === "string" ? profilePayload.email : "",
    email_verified: Boolean(profilePayload.email_verified),
    name: typeof profilePayload.name === "string" ? profilePayload.name : undefined,
    picture: typeof profilePayload.picture === "string" ? profilePayload.picture : undefined,
  };

  if (!profile.sub || !profile.email) {
    throw new Error("Google userinfo response was missing required identity fields.");
  }

  return profile;
}

export function getHumanAuthDisplayName(user: HumanUserRecord) {
  return user.display_name?.trim() || user.email;
}
