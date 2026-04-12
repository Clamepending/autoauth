import { createGoogleLoginRedirect, isGoogleAuthConfigured } from "@/lib/human-session";

export async function GET(request: Request) {
  if (!isGoogleAuthConfigured()) {
    return Response.json(
      { error: "Google sign-in is not configured." },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const returnTo = url.searchParams.get("returnTo")?.trim() || "/dashboard";
  const referralCode = url.searchParams.get("ref")?.trim() || null;
  return createGoogleLoginRedirect(returnTo, referralCode);
}
