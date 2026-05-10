// /api/auth/vibe-id/login — kicks off the vibe-id sign-in flow.
//
// Server-side redirect to api.accounts.vibe-research.net/auth/start with
// project=ottoauth + a fresh device_id. vibe-id bounces through Google,
// then redirects back to /api/auth/vibe-id/callback where we exchange
// the auth code for an install token.
//
// The user can pass ?return_to=/some/path to be sent there after sign-in.

import { startSignInRedirect } from "@/lib/vibe-id-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.searchParams.get("return_to") ?? "/dashboard";
  return startSignInRedirect(returnTo);
}
