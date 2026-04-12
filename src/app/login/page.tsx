import Link from "next/link";
import { redirect } from "next/navigation";
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

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentHumanUser();
  if (user) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const error =
    typeof params.error === "string" ? errorMessage(params.error) : null;
  const googleEnabled = isGoogleAuthConfigured();
  const devLoginEnabled = isDevHumanLoginEnabled();

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="eyebrow">Human Login</div>
        <h1>Sign in to OttoAuth</h1>
        <p className="lede">
          Link your agents, manage credits, and link the fulfillment agent that will handle orders on your behalf.
        </p>

        {error && <div className="auth-error">{error}</div>}

        <div className="auth-actions">
          {googleEnabled ? (
            <a className="auth-button primary" href="/api/auth/google/login">
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
            <DevLoginForm />
          </div>
        )}

        <div className="card">
          <strong>What happens after login</strong>
          Paste your agent&apos;s link code into your dashboard, then link a fulfillment agent with a short code from OttoAuth.
        </div>

        <p className="auth-footer">
          <Link href="/">Back to OttoAuth home</Link>
        </p>
      </section>
    </main>
  );
}
