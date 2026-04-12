import Link from "next/link";
import { redirect } from "next/navigation";
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
  if (!user) {
    redirect("/login");
  }

  const balanceCents = await getHumanCreditBalance(user.id);
  const params = (await searchParams) ?? {};
  const amountCents = Number(params.amount_cents ?? "");
  const amountDisplay =
    Number.isInteger(amountCents) && amountCents > 0 ? fmtUsd(amountCents) : null;

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <div className="dashboard-header">
          <div>
            <div className="eyebrow">Credits</div>
            <h1>Refill received</h1>
            <p className="lede">
              {amountDisplay
                ? `${amountDisplay} was submitted to Stripe. Your OttoAuth balance is shown below.`
                : "Your Stripe checkout finished. Your OttoAuth balance is shown below."}
            </p>
          </div>
          <div className="dashboard-actions">
            <Link className="auth-button primary" href="/dashboard">
              Back to dashboard
            </Link>
            <Link className="auth-button" href="/credits/refill">
              Refill again
            </Link>
          </div>
        </div>

        <section className="dashboard-grid wide">
          <article className="dashboard-card highlight">
            <div className="supported-accounts-title">Current Balance</div>
            <div className="dashboard-balance">{fmtUsd(balanceCents)}</div>
            <div className="dashboard-muted">
              If Stripe finished only a moment ago and this number has not refreshed yet, go back to the dashboard and reload once.
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
