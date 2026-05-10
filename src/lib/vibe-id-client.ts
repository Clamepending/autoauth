/**
 * vibe-id-client — the single abstraction for everything autoauth uses
 * from the central vibe-id service.
 *
 * All callers in autoauth go through this module. There should be ZERO
 * direct fetch() calls to api.accounts.vibe-research.net anywhere else
 * in the codebase. If a new vibe-id capability is needed, add it here.
 *
 * Convention:
 *   - Functions that read/charge for the calling user take the request
 *     (or cookie store) so they can extract the install token.
 *   - Functions that act on behalf of the system (grants from referrals,
 *     migration helpers) authenticate with VIBE_ID_INTERNAL_KEY.
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const VIBE_ID_PROJECT_ID = "ottoauth";
const VIBE_ID_SESSION_COOKIE_NAME = "vibe_id_session";
const VIBE_ID_DEVICE_ID_COOKIE_NAME = "vibe_id_device_id";
const VIBE_ID_RETURN_TO_COOKIE_NAME = "vibe_id_return_to";

const SESSION_COOKIE_LIFETIME_SECONDS = 60 * 60 * 24 * 365; // 1 year — install tokens are long-lived
const HANDOFF_COOKIE_LIFETIME_SECONDS = 60 * 10;            // 10 min — covers the OAuth round trip

function vibeIdBaseUrl(): string {
  const url = process.env.VIBE_ID_BASE_URL?.trim() || "https://api.accounts.vibe-research.net";
  return url.replace(/\/+$/, "");
}

function vibeIdInternalKey(): string {
  const key = process.env.VIBE_ID_INTERNAL_KEY?.trim();
  if (!key) throw new Error("VIBE_ID_INTERNAL_KEY env var is required for vibe-id internal calls");
  return key;
}

function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === "production";
}

// ---------------------------------------------------------------------------
// Types — what callers see
// ---------------------------------------------------------------------------

export type VibeIdUser = {
  id: number;
  email: string;
  display_name: string | null;
  picture_url: string | null;
  handle_lower: string | null;
  handle_display: string | null;
};

export type VibeIdMeResponse = {
  user: VibeIdUser;
  credits_balance: number;        // integer cents
  daily_cap_cents: number | null;
  spent_today_cents: number | null;
};

export type ChargeResult =
  | { ok: true; charged: number; balance: number; alreadyCharged: boolean; ledgerEntryId: number | null }
  | { ok: false; status: number; error: string; balance?: number };

// ---------------------------------------------------------------------------
// Sign-in flow (server-side, via the vibe-id device_id+web_callback_url path)
// ---------------------------------------------------------------------------

/// Builds the sign-in URL the browser should be redirected to. Generates a
/// fresh device_id and stashes it (plus return_to) in short-lived cookies
/// the callback route reads after OAuth round-trips back to us. The
/// optional `referralCode` is forwarded to vibe-id as ?ref=… so vibe-id
/// can attribute the signup if this turns out to be a brand-new user.
export async function startSignInRedirect(
  returnTo: string = "/dashboard",
  referralCode?: string | number | null,
): Promise<NextResponse> {
  const deviceId = generateRandomHex(16);

  const startUrl = new URL(`${vibeIdBaseUrl()}/auth/start`);
  startUrl.searchParams.set("project", VIBE_ID_PROJECT_ID);
  startUrl.searchParams.set("device_id", deviceId);
  if (referralCode != null && String(referralCode).trim() !== "") {
    startUrl.searchParams.set("ref", String(referralCode).trim());
  }

  const redirect = NextResponse.redirect(startUrl.toString(), { status: 302 });
  setShortLivedHandoffCookie(redirect, VIBE_ID_DEVICE_ID_COOKIE_NAME, deviceId);
  setShortLivedHandoffCookie(redirect, VIBE_ID_RETURN_TO_COOKIE_NAME, sanitizeReturnTo(returnTo));
  return redirect;
}

/// Server-side handler for the vibe-id callback. Reads the device_id +
/// return_to from the short-lived cookies, exchanges the code for an
/// install token, sets the session cookie, redirects the user back.
export async function completeSignInFromCallback(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const authCode = requestUrl.searchParams.get("code") ?? "";
  if (!authCode) return failureRedirect("missing_code");

  const cookieStore = await cookies();
  const deviceId = cookieStore.get(VIBE_ID_DEVICE_ID_COOKIE_NAME)?.value ?? "";
  const returnTo = cookieStore.get(VIBE_ID_RETURN_TO_COOKIE_NAME)?.value ?? "/dashboard";
  if (!deviceId) return failureRedirect("device_id_cookie_missing");

  // Exchange the single-use code for a long-lived install token.
  const exchangeResponse = await fetch(`${vibeIdBaseUrl()}/auth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: authCode,
      device_id: deviceId,
      device_label: "ottoauth-web",
    }),
  });

  if (!exchangeResponse.ok) {
    const errorBody = await exchangeResponse.text();
    console.error(`[vibe-id-client] /auth/exchange failed ${exchangeResponse.status}: ${errorBody}`);
    return failureRedirect(`exchange_failed_${exchangeResponse.status}`);
  }

  const exchangeBody = (await exchangeResponse.json()) as {
    install_token?: string;
    user?: VibeIdUser;
  };
  const installToken = exchangeBody.install_token;
  if (!installToken) return failureRedirect("no_install_token_in_response");

  const finalRedirect = NextResponse.redirect(buildAbsoluteUrl(request, sanitizeReturnTo(returnTo)).toString(), {
    status: 302,
  });
  setSessionCookie(finalRedirect, installToken);
  clearShortLivedHandoffCookie(finalRedirect, VIBE_ID_DEVICE_ID_COOKIE_NAME);
  clearShortLivedHandoffCookie(finalRedirect, VIBE_ID_RETURN_TO_COOKIE_NAME);
  return finalRedirect;
}

/// Read the session cookie + call vibe-id /auth/me to get the current
/// user's identity + balance. Returns null if not signed in or if vibe-id
/// rejected the token (which can happen if a user signed out from another
/// device, or admin revoked them).
export async function getCurrentVibeUser(): Promise<VibeIdMeResponse | null> {
  const cookieStore = await cookies();
  const installToken = cookieStore.get(VIBE_ID_SESSION_COOKIE_NAME)?.value;
  if (!installToken) return null;

  const meResponse = await fetch(`${vibeIdBaseUrl()}/auth/me`, {
    method: "GET",
    headers: { authorization: `Bearer ${installToken}` },
    // Disable Next's fetch cache: a stale /auth/me would silently show
    // the wrong balance after a charge or topup.
    cache: "no-store",
  });

  if (meResponse.status === 401) return null;
  if (!meResponse.ok) {
    console.error(`[vibe-id-client] /auth/me failed ${meResponse.status}`);
    return null;
  }
  return (await meResponse.json()) as VibeIdMeResponse;
}

/// Returns the install token for the current request, or null. Internal
/// callers (chargeCreditsForCurrentUser etc.) need to forward this.
export async function getCurrentInstallToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(VIBE_ID_SESSION_COOKIE_NAME)?.value ?? null;
}

/// Clears the local session cookie AND tells vibe-id to revoke the token.
/// Best-effort on the revoke (the cookie clear is the user-visible part).
export async function signOutCurrentUser(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const installToken = cookieStore.get(VIBE_ID_SESSION_COOKIE_NAME)?.value;
  if (installToken) {
    fetch(`${vibeIdBaseUrl()}/auth/signout`, {
      method: "POST",
      headers: { authorization: `Bearer ${installToken}` },
    }).catch(error => console.error(`[vibe-id-client] /auth/signout failed`, error));
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(VIBE_ID_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: isProductionEnvironment(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

// ---------------------------------------------------------------------------
// Credits — all flow through vibe-id
// ---------------------------------------------------------------------------

/// Charge the currently signed-in user's credit balance. Idempotency key
/// is required — generate a stable one per logical purchase so retries
/// don't double-charge. Returns the new balance on success or the error
/// (typically `insufficient_credits` with status 402).
export async function chargeCreditsForCurrentUser(params: {
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}): Promise<ChargeResult> {
  const installToken = await getCurrentInstallToken();
  if (!installToken) return { ok: false, status: 401, error: "not_signed_in" };

  const response = await fetch(`${vibeIdBaseUrl()}/credits/charge`, {
    method: "POST",
    headers: { authorization: `Bearer ${installToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      amount: params.amountCents,
      reason: params.reason,
      idempotency_key: params.idempotencyKey,
    }),
  });

  const body = await response.json() as Record<string, unknown>;
  if (response.ok) {
    return {
      ok: true,
      charged: typeof body.charged_amount === "number" ? body.charged_amount : params.amountCents,
      balance: typeof body.balance === "number" ? body.balance : 0,
      alreadyCharged: Boolean(body.already_charged),
      ledgerEntryId: typeof body.ledger_entry_id === "number" ? body.ledger_entry_id : null,
    };
  }
  return {
    ok: false,
    status: response.status,
    error: typeof body.error === "string" ? body.error : `status_${response.status}`,
    balance: typeof body.balance === "number" ? body.balance : undefined,
  };
}

/// Creates a Stripe Checkout session via vibe-id for the calling user.
/// Returns the URL to send the user to. autoauth's /credits/refill page
/// calls this and then redirects.
export async function createTopupSession(params: {
  amountDollars: number;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ ok: true; checkoutUrl: string } | { ok: false; status: number; error: string }> {
  const installToken = await getCurrentInstallToken();
  if (!installToken) return { ok: false, status: 401, error: "not_signed_in" };

  const response = await fetch(`${vibeIdBaseUrl()}/credits/topup`, {
    method: "POST",
    headers: { authorization: `Bearer ${installToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      amount_dollars: params.amountDollars,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    }),
  });

  const body = await response.json() as Record<string, unknown>;
  if (response.ok && typeof body.checkout_url === "string") {
    return { ok: true, checkoutUrl: body.checkout_url };
  }
  return {
    ok: false,
    status: response.status,
    error: typeof body.error === "string" ? body.error : `status_${response.status}`,
  };
}

// ---------------------------------------------------------------------------
// Server-only operations (X-Internal-Key authenticated, never called from
// browser code paths). Used for referral grants, migration scripts, etc.
// ---------------------------------------------------------------------------

/// Grants credits to a user. Use for referral bonuses, signup credit,
/// promotional credit. Idempotency key required.
export async function grantCreditsToUser(params: {
  vibeIdUserId: number;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}): Promise<{ ok: true; balance: number } | { ok: false; status: number; error: string }> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/grant`, {
    method: "POST",
    headers: { "x-internal-key": vibeIdInternalKey(), "content-type": "application/json" },
    body: JSON.stringify({
      user_id: params.vibeIdUserId,
      amount: params.amountCents,
      reason: params.reason,
      idempotency_key: params.idempotencyKey,
    }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (response.ok) {
    return { ok: true, balance: typeof body.balance === "number" ? body.balance : 0 };
  }
  return { ok: false, status: response.status, error: typeof body.error === "string" ? body.error : "unknown" };
}

/// Internal charge — debit a specific user's credits without their bearer
/// token. Used when autoauth charges a user for a server-side action
/// (e.g. enqueueing a task) where the request might come from a webhook
/// or a background job rather than the user's own browser.
export async function chargeCreditsForUserId(params: {
  vibeIdUserId: number;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
  project?: string;
}): Promise<{ ok: true; balance: number; alreadyCharged: boolean } | { ok: false; status: number; error: string; balance?: number }> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/charge`, {
    method: "POST",
    headers: { "x-internal-key": vibeIdInternalKey(), "content-type": "application/json" },
    body: JSON.stringify({
      user_id: params.vibeIdUserId,
      amount: params.amountCents,
      reason: params.reason,
      idempotency_key: params.idempotencyKey,
      project: params.project,
    }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (response.ok) {
    return {
      ok: true,
      balance: typeof body.balance === "number" ? body.balance : 0,
      alreadyCharged: Boolean(body.already_charged),
    };
  }
  return {
    ok: false,
    status: response.status,
    error: typeof body.error === "string" ? body.error : `status_${response.status}`,
    balance: typeof body.balance === "number" ? body.balance : undefined,
  };
}

/// Read a specific user's balance by vibe-id user_id (server-side only —
/// uses the internal key, not the user's bearer token). For "show me
/// some other user's balance" callers like dashboards.
export async function getCreditsBalanceForVibeUser(vibeIdUserId: number): Promise<{ ok: true; balanceCents: number } | { ok: false; status: number; error: string }> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/users/${vibeIdUserId}/credits`, {
    method: "GET",
    headers: { "x-internal-key": vibeIdInternalKey() },
  });
  const body = await response.json() as Record<string, unknown>;
  if (response.ok) {
    return { ok: true, balanceCents: typeof body.balance === "number" ? body.balance : 0 };
  }
  return { ok: false, status: response.status, error: typeof body.error === "string" ? body.error : "unknown" };
}

/// List ledger entries for a specific user. Returns the raw entries from
/// vibe-id; callers can map to their preferred shape.
export async function listCreditsLedgerForVibeUser(vibeIdUserId: number, limit = 50): Promise<{ ok: true; entries: unknown[] } | { ok: false; status: number; error: string }> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/users/${vibeIdUserId}/ledger?limit=${limit}`, {
    method: "GET",
    headers: { "x-internal-key": vibeIdInternalKey() },
  });
  const body = await response.json() as Record<string, unknown>;
  if (response.ok) {
    return { ok: true, entries: Array.isArray(body.entries) ? body.entries : [] };
  }
  return { ok: false, status: response.status, error: typeof body.error === "string" ? body.error : "unknown" };
}

/// Atomic P2P credit transfer. Used by autoauth's "send credits" feature.
export async function transferCreditsBetweenUsers(params: {
  fromVibeIdUserId: number;
  toVibeIdUserId: number;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}): Promise<{ ok: true; fromBalance: number; toBalance: number } | { ok: false; status: number; error: string }> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/transfer`, {
    method: "POST",
    headers: { "x-internal-key": vibeIdInternalKey(), "content-type": "application/json" },
    body: JSON.stringify({
      from_user_id: params.fromVibeIdUserId,
      to_user_id: params.toVibeIdUserId,
      amount: params.amountCents,
      reason: params.reason,
      idempotency_key: params.idempotencyKey,
    }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (response.ok) {
    return {
      ok: true,
      fromBalance: typeof body.from_balance === "number" ? body.from_balance : 0,
      toBalance: typeof body.to_balance === "number" ? body.to_balance : 0,
    };
  }
  return { ok: false, status: response.status, error: typeof body.error === "string" ? body.error : "unknown" };
}

/// Migration helper: get-or-create a vibe-id user from a Google subject.
/// Used by the one-shot migration script that links every existing
/// human_users row to a vibe-id user.
export async function upsertVibeUserByGoogleSubject(params: {
  googleSubject: string;
  email: string;
  displayName?: string | null;
  pictureUrl?: string | null;
}): Promise<{ ok: true; user: VibeIdUser } | { ok: false; status: number; error: string }> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/users/upsert-by-google-subject`, {
    method: "POST",
    headers: { "x-internal-key": vibeIdInternalKey(), "content-type": "application/json" },
    body: JSON.stringify({
      google_subject: params.googleSubject,
      email: params.email,
      display_name: params.displayName ?? null,
      picture_url: params.pictureUrl ?? null,
    }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (response.ok && body.user) {
    return { ok: true, user: body.user as VibeIdUser };
  }
  return { ok: false, status: response.status, error: typeof body.error === "string" ? body.error : "unknown" };
}

/// Migration helper: preserve an existing Stripe customer id on a vibe-id
/// user so post-migration top-ups don't make the user re-enter their card.
export async function setStripeCustomerIdOnVibeUser(params: {
  vibeIdUserId: number;
  stripeCustomerId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/users/set-stripe-customer-id`, {
    method: "POST",
    headers: { "x-internal-key": vibeIdInternalKey(), "content-type": "application/json" },
    body: JSON.stringify({
      user_id: params.vibeIdUserId,
      stripe_customer_id: params.stripeCustomerId,
    }),
  });
  if (response.ok) return { ok: true };
  const body = await response.json() as Record<string, unknown>;
  return { ok: false, status: response.status, error: typeof body.error === "string" ? body.error : "unknown" };
}

// ---------------------------------------------------------------------------
// Phase 4: handles, referrals, email-claims — all live in vibe-id now.
// ---------------------------------------------------------------------------

/// Look up a vibe-id user by their @handle. Returns null on 404.
export async function findVibeUserByHandle(handle: string): Promise<VibeIdUser | null> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/users/by-handle/${encodeURIComponent(handle)}`, {
    headers: { "x-internal-key": vibeIdInternalKey() },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    console.error(`[vibe-id-client] findVibeUserByHandle failed ${response.status}`);
    return null;
  }
  const body = await response.json() as { user?: VibeIdUser };
  return body.user ?? null;
}

/// Set a user's @handle. Returns ok=false with status=409 if taken.
export async function setHandleForVibeUser(params: {
  vibeIdUserId: number;
  handle: string;
}): Promise<{ ok: true; handle_lower: string; handle_display: string } | { ok: false; status: number; error: string }> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/users/${params.vibeIdUserId}/handle`, {
    method: "PUT",
    headers: { "x-internal-key": vibeIdInternalKey(), "content-type": "application/json" },
    body: JSON.stringify({ handle: params.handle }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (response.ok) {
    return {
      ok: true,
      handle_lower: typeof body.handle_lower === "string" ? body.handle_lower : params.handle,
      handle_display: typeof body.handle_display === "string" ? body.handle_display : params.handle,
    };
  }
  return { ok: false, status: response.status, error: typeof body.error === "string" ? body.error : "unknown" };
}

/// Read referral stats for a user (count, qualified count, total bonus cents).
export async function getReferralStatsForVibeUser(
  vibeIdUserId: number,
): Promise<{ ok: true; total_referrals: number; qualified_referrals: number; total_bonus_cents: number } | { ok: false; status: number; error: string }> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/users/${vibeIdUserId}/referrals`, {
    headers: { "x-internal-key": vibeIdInternalKey() },
  });
  const body = await response.json() as Record<string, unknown>;
  if (response.ok) {
    return {
      ok: true,
      total_referrals: typeof body.total_referrals === "number" ? body.total_referrals : 0,
      qualified_referrals: typeof body.qualified_referrals === "number" ? body.qualified_referrals : 0,
      total_bonus_cents: typeof body.total_bonus_cents === "number" ? body.total_bonus_cents : 0,
    };
  }
  return { ok: false, status: response.status, error: typeof body.error === "string" ? body.error : "unknown" };
}

/// Pending email-claim record returned by vibe-id.
export type VibeIdClaim = {
  claim_public_id: string;
  sender_user_id: number;
  recipient_email: string;
  amount_cents: number;
  note: string;
  status: "pending" | "claimed" | "expired";
  claimed_user_id: number | null;
  claimed_at: number | null;
  expires_at: number;
  created_at: number;
};

/// Create a pending email-claim. Sender is debited via vibe-id /v1/charge.
/// Returns 402 insufficient_credits if the sender doesn't have enough.
export async function createPendingClaim(params: {
  senderVibeIdUserId: number;
  recipientEmail: string;
  amountCents: number;
  note?: string;
}): Promise<{ ok: true; claim: VibeIdClaim; sender_balance: number } | { ok: false; status: number; error: string }> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/claims`, {
    method: "POST",
    headers: { "x-internal-key": vibeIdInternalKey(), "content-type": "application/json" },
    body: JSON.stringify({
      sender_user_id: params.senderVibeIdUserId,
      recipient_email: params.recipientEmail,
      amount_cents: params.amountCents,
      note: params.note ?? "",
    }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (response.ok) {
    return {
      ok: true,
      claim: body.claim as VibeIdClaim,
      sender_balance: typeof body.sender_balance === "number" ? body.sender_balance : 0,
    };
  }
  return { ok: false, status: response.status, error: typeof body.error === "string" ? body.error : "unknown" };
}

/// Run the expiry sweep (refunds senders for unclaimed expired claims).
/// Safe to call frequently — idempotent on per-claim refund grants.
export async function expireDueClaims(): Promise<{ ok: true; expired: Array<{ claim_public_id: string; refunded_cents: number }> } | { ok: false; status: number; error: string }> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/claims/expire-due`, {
    method: "POST",
    headers: { "x-internal-key": vibeIdInternalKey() },
  });
  const body = await response.json() as Record<string, unknown>;
  if (response.ok) {
    return { ok: true, expired: Array.isArray(body.expired) ? (body.expired as Array<{ claim_public_id: string; refunded_cents: number }>) : [] };
  }
  return { ok: false, status: response.status, error: typeof body.error === "string" ? body.error : "unknown" };
}

/// List the pending claims a user has SENT. Returned newest-first.
export async function listSentClaimsForVibeUser(
  vibeIdUserId: number,
): Promise<{ ok: true; claims: VibeIdClaim[] } | { ok: false; status: number; error: string }> {
  const response = await fetch(`${vibeIdBaseUrl()}/v1/users/${vibeIdUserId}/claims-pending`, {
    headers: { "x-internal-key": vibeIdInternalKey() },
  });
  const body = await response.json() as Record<string, unknown>;
  if (response.ok) {
    return { ok: true, claims: Array.isArray(body.claims) ? (body.claims as VibeIdClaim[]) : [] };
  }
  return { ok: false, status: response.status, error: typeof body.error === "string" ? body.error : "unknown" };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function setSessionCookie(response: NextResponse, installToken: string): void {
  response.cookies.set(VIBE_ID_SESSION_COOKIE_NAME, installToken, {
    httpOnly: true,
    secure: isProductionEnvironment(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_LIFETIME_SECONDS,
  });
}

function setShortLivedHandoffCookie(response: NextResponse, name: string, value: string): void {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure: isProductionEnvironment(),
    sameSite: "lax",
    path: "/",
    maxAge: HANDOFF_COOKIE_LIFETIME_SECONDS,
  });
}

function clearShortLivedHandoffCookie(response: NextResponse, name: string): void {
  response.cookies.set(name, "", {
    httpOnly: true,
    secure: isProductionEnvironment(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function failureRedirect(reasonCode: string): NextResponse {
  const loginUrl = new URL("/login", "http://placeholder");
  loginUrl.searchParams.set("vibe_id_error", reasonCode);
  return NextResponse.redirect(loginUrl.pathname + loginUrl.search, { status: 302 });
}

function buildAbsoluteUrl(request: Request, pathOrUrl: string): URL {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return new URL(pathOrUrl);
  }
  const requestUrl = new URL(request.url);
  return new URL(pathOrUrl, requestUrl.origin);
}

function sanitizeReturnTo(returnTo: string): string {
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return "/dashboard";
  return returnTo;
}

function generateRandomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
