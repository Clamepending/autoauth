import Link from "next/link";
import { redirect } from "next/navigation";
import { parseHumanReferralCode } from "@/lib/human-accounts";
import {
  getCurrentHumanUser,
  isDevHumanLoginEnabled,
  isGoogleAuthConfigured,
} from "@/lib/human-session";
import { DevLoginForm } from "./login-client";

export const dynamic = "force-dynamic";

function errorMessage(error: string) {
  switch (error) {
    case "invalid_google_state":
      return "Your Google sign-in session expired. Please try again.";
    case "missing_google_code":
      return "Google did not return a valid authorization code.";
    case "access_denied":
      return "Google sign-in was cancelled.";
    default:
      return error ? decodeURIComponent(error) : null;
  }
}

function sanitizeReturnTo(returnTo: string) {
  if (!returnTo.startsWith("/")) return "/dashboard";
  if (returnTo.startsWith("//")) return "/dashboard";
  return returnTo;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo =
    typeof params.returnTo === "string"
      ? sanitizeReturnTo(params.returnTo)
      : "/dashboard";
  const user = await getCurrentHumanUser();
  if (user) {
    redirect(returnTo);
  }

  const error =
    typeof params.error === "string" ? errorMessage(params.error) : null;
  const referralCode =
    typeof params.ref === "string"
      ? parseHumanReferralCode(params.ref)
      : null;
  const googleEnabled = isGoogleAuthConfigured();
  const devLoginEnabled = isDevHumanLoginEnabled();
  const googleLoginParams = new URLSearchParams({ returnTo });
  if (referralCode) googleLoginParams.set("ref", String(referralCode));
  const googleLoginHref = `/api/auth/google/login?${googleLoginParams.toString()}`;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="eyebrow">Human Login</div>
        <h1>Sign in to OttoAuth</h1>
        <p className="lede">
          Generate agent API keys, manage credits, and configure fulfillment devices that can handle orders on your behalf.
        </p>

        {referralCode && (
          <div className="referral-login-card">
            <div className="supported-accounts-title">Referral Offer</div>
            <strong>Sign up, make your first deposit, and you both get $5.</strong>
            <p className="dashboard-muted">
              Referral credits only apply to a brand-new human account after its first paid credit refill.
            </p>
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}

        <div className="auth-actions">
          {googleEnabled ? (
            <a className="auth-button primary" href={googleLoginHref}>
              Continue with Google
            </a>
          ) : (
            <div className="auth-disabled">
              Google sign-in is not configured yet. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
            </div>
          )}
        </div>

        {devLoginEnabled && (
          <div className="dev-login-block">
            <div className="supported-accounts-title">Developer Login</div>
            <DevLoginForm
              referralCode={referralCode ? String(referralCode) : null}
              returnTo={returnTo}
            />
          </div>
        )}

        <div className="card">
          <strong>What happens after login</strong>
          Generate OttoAuth credentials in your dashboard, send them to your agent, then configure a fulfillment device when you are ready.
        </div>

        <p className="auth-footer">
          <Link href="/">Back to OttoAuth home</Link>
        </p>
      </section>
    </main>
  );
}
