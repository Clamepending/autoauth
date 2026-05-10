// /api/auth/vibe-id/login — kicks off the vibe-id sign-in flow.
//
// Server-side redirect to api.accounts.vibe-research.net/auth/start with
// project=ottoauth + a fresh device_id. vibe-id bounces through Google,
// then redirects back to /api/auth/vibe-id/callback where we exchange
// the auth code for an install token.
//
// Query params:
//   return_to=/path   — where to send the user after sign-in (default /dashboard)
//   ref=<id|@handle>  — optional referral code; forwarded to vibe-id so the
//                       referral row is created if this is a brand-new signup

import { startSignInRedirect } from "@/lib/vibe-id-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.searchParams.get("return_to") ?? "/dashboard";
  const ref = requestUrl.searchParams.get("ref")?.trim() ?? null;
  return startSignInRedirect(returnTo, ref);
}
