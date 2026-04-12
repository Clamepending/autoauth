import Link from "next/link";
import { getHumanCreditBalance } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";

export const dynamic = "force-dynamic";

function fmtUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

type Props = {
  searchParams?: Promise<{
    amount_cents?: string;
  }>;
};

export default async function CreditsRefillSuccessPage({ searchParams }: Props) {
  const user = await getCurrentHumanUser();
  const params = (await searchParams) ?? {};
  const amountCents = Number(params.amount_cents ?? "");
  const amountDisplay =
    Number.isInteger(amountCents) && amountCents > 0 ? fmtUsd(amountCents) : null;
  const balanceCents = user ? await getHumanCreditBalance(user.id) : null;

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <div className="dashboard-header">
          <div>
            <div className="eyebrow">Credits</div>
            <h1>Refill received</h1>
            <p className="lede">
              {user
                ? amountDisplay
                  ? `${amountDisplay} was submitted to Stripe. Your OttoAuth balance is shown below.`
                  : "Your Stripe checkout finished. Your OttoAuth balance is shown below."
                : amountDisplay
                  ? `${amountDisplay} was submitted to Stripe. Sign in to OttoAuth to see the updated balance.`
                  : "Your Stripe checkout finished. Sign in to OttoAuth to see the updated balance."}
            </p>
          </div>
          <div className="dashboard-actions">
            {user ? (
              <>
                <Link className="auth-button primary" href="/dashboard">
                  Back to dashboard
                </Link>
                <Link className="auth-button" href="/credits/refill">
                  Refill again
                </Link>
              </>
            ) : (
              <>
                <Link className="auth-button primary" href="/login">
                  Sign in
                </Link>
                <Link className="auth-button" href="/credits/refill">
                  Back to refill
                </Link>
              </>
            )}
          </div>
        </div>

        <section className="dashboard-grid wide">
          <article className="dashboard-card highlight">
            <div className="supported-accounts-title">
              {user ? "Current Balance" : "Next Step"}
            </div>
            {user ? (
              <>
                <div className="dashboard-balance">{fmtUsd(balanceCents ?? 0)}</div>
                <div className="dashboard-muted">
                  If Stripe finished only a moment ago and this number has not refreshed yet, go back to the dashboard and reload once.
                </div>
              </>
            ) : (
              <>
                <div className="dashboard-balance">
                  {amountDisplay ? `${amountDisplay} submitted` : "Checkout submitted"}
                </div>
                <div className="dashboard-muted">
                  This browser was not signed into OttoAuth, so the success page cannot show your balance yet. Sign in and open the dashboard or refill page to confirm the new credit entry.
                </div>
              </>
            )}
          </article>
        </section>
      </section>
    </main>
  );
}
