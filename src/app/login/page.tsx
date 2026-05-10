import Link from "next/link";
import { redirect } from "next/navigation";
import { parseHumanReferralCode } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";

export const dynamic = "force-dynamic";

function errorMessage(error: string) {
  switch (error) {
    case "missing_code":
      return "Vibe Research sign-in didn't return a valid code. Please try again.";
    case "device_id_cookie_missing":
      return "Sign-in session expired. Please try again.";
    default:
      return error?.startsWith("exchange_failed_")
        ? "Vibe Research sign-in failed during the token exchange. Please try again."
        : (error ? decodeURIComponent(error) : null);
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

  const errorParam = typeof params.vibe_id_error === "string"
    ? params.vibe_id_error
    : (typeof params.error === "string" ? params.error : null);
  const error = errorParam ? errorMessage(errorParam) : null;
  const referralCode =
    typeof params.ref === "string"
      ? parseHumanReferralCode(params.ref)
      : null;
  const isConnectLogin = returnTo.startsWith("/connect/");
  const isCheckoutLogin = returnTo.startsWith("/checkout/");
  const vibeIdLoginParams = new URLSearchParams({ return_to: returnTo });
  if (referralCode) vibeIdLoginParams.set("ref", String(referralCode));
  const vibeIdLoginHref = `/api/auth/vibe-id/login?${vibeIdLoginParams.toString()}`;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="eyebrow">Human Login</div>
        <h1>Sign in to OttoAuth</h1>
        <p className="lede">
          {isCheckoutLogin
            ? "Sign in to review and confirm this order."
            : isConnectLogin
            ? "Sign in to approve this app and continue to checkout."
            : "Manage credits, connected apps, and fulfillment devices that can handle orders on your behalf."}
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
          <a className="auth-button primary" href={vibeIdLoginHref}>
            Sign in with Vibe Research
          </a>
        </div>

        <p className="dashboard-muted" style={{ marginTop: 12 }}>
          Vibe Research is the shared identity for ottoauth, dot, and other Vibe
          Research projects. Your credit balance is global — top up once, spend
          across everything.
        </p>

        <p className="auth-footer">
          <Link href="/">Back to OttoAuth home</Link>
        </p>
      </section>
    </main>
  );
}
