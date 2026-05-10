// /api/auth/vibe-id/callback — vibe-id redirects here with ?code=... after
// the user finishes Google sign-in. We exchange the code for an install
// token, store it in the HttpOnly session cookie, and send the user back
// to wherever they came from (default /dashboard).

import { completeSignInFromCallback } from "@/lib/vibe-id-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return completeSignInFromCallback(request);
}
