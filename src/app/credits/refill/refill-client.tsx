"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const PRESET_AMOUNTS = [1000, 2000, 5000, 10000];

function fmtUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function parseUsdToCents(value: string) {
  const normalized = value.trim().replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

export function RefillClient(props: {
  currentBalanceCents: number;
  stripeConfigured: boolean;
  simulationEnabled: boolean;
}) {
  const [selectedAmountCents, setSelectedAmountCents] = useState<number>(2000);
  const [customAmount, setCustomAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const effectiveAmountCents = useMemo(() => {
    if (customAmount.trim()) {
      return parseUsdToCents(customAmount);
    }
    return selectedAmountCents;
  }, [customAmount, selectedAmountCents]);

  async function handleCheckout() {
    if (!props.stripeConfigured) {
      setError("Stripe checkout is not configured yet.");
      return;
    }
    if (!effectiveAmountCents) {
      setError("Enter a valid refill amount.");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch("/api/human/credits/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_cents: effectiveAmountCents }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Could not start checkout.");
        setLoading(false);
        return;
      }
      if (payload?.url) {
        window.location.href = payload.url;
        return;
      }
      setError("No checkout URL returned.");
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  }

  async function handleSimulate() {
    if (!props.simulationEnabled) {
      setError("Test refills are not enabled here.");
      return;
    }
    if (!effectiveAmountCents) {
      setError("Enter a valid refill amount.");
      return;
    }
    setSimulating(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch("/api/human/credits/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_cents: effectiveAmountCents }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Could not run test refill.");
        return;
      }
      const balanceDisplay =
        typeof payload?.balance_cents === "number"
          ? fmtUsd(payload.balance_cents)
          : null;
      setSuccessMessage(
        balanceDisplay
          ? `Test refill succeeded. New balance: ${balanceDisplay}.`
          : "Test refill succeeded.",
      );
      window.setTimeout(() => window.location.assign("/dashboard"), 700);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSimulating(false);
    }
  }

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <div className="dashboard-header">
          <div>
            <div className="eyebrow">Credits</div>
            <h1>Refill your balance</h1>
            <p className="lede">
              Add OttoAuth credits with a quick Stripe checkout. Card, Apple Pay, and Google Pay should appear when Stripe supports them on your device.
            </p>
          </div>
          <div className="dashboard-actions">
            <Link className="auth-button" href="/dashboard">
              Dashboard
            </Link>
            <Link className="auth-button" href="/orders">
              Orders
            </Link>
          </div>
        </div>

        <section className="dashboard-grid wide">
          <article className="dashboard-card highlight">
            <div className="supported-accounts-title">Current Balance</div>
            <div className="dashboard-balance">{fmtUsd(props.currentBalanceCents)}</div>
            <div className="dashboard-muted">
              Refilled credits land in your OttoAuth balance and show up in credit activity after Stripe confirms payment.
            </div>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">Choose amount</div>
            <div className="quick-links-row">
              {PRESET_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={`auth-button ${!customAmount && selectedAmountCents === amount ? "primary" : ""}`}
                  onClick={() => {
                    setSelectedAmountCents(amount);
                    setCustomAmount("");
                    setError(null);
                  }}
                >
                  {fmtUsd(amount)}
                </button>
              ))}
            </div>
            <label className="supported-accounts-title" htmlFor="custom-refill-amount">
              Custom amount
            </label>
            <input
              id="custom-refill-amount"
              className="auth-input"
              value={customAmount}
              onChange={(event) => {
                setCustomAmount(event.target.value);
                setError(null);
              }}
              inputMode="decimal"
              placeholder="Enter amount in USD, e.g. 35.00"
            />
            <div className="dashboard-muted">
              Minimum refill is $5.00. Maximum refill per checkout is $500.00.
            </div>
            <div className="quick-fact-card quick-fact-card-prominent">
              <div className="quick-fact-label">You will add</div>
              <div className="quick-fact-value quick-fact-value-prominent">
                {effectiveAmountCents ? fmtUsd(effectiveAmountCents) : "Enter amount"}
              </div>
              <div className="dashboard-muted">
                The Stripe checkout total matches the credit amount you are adding.
              </div>
            </div>
            <div className="pay-actions">
              <button
                type="button"
                onClick={handleCheckout}
                disabled={loading || !props.stripeConfigured}
                className="pay-button"
              >
                {loading
                  ? "Redirecting…"
                  : effectiveAmountCents
                    ? `Refill ${fmtUsd(effectiveAmountCents)}`
                    : "Refill credits"}
              </button>
            </div>
            {props.simulationEnabled && (
              <div className="pay-actions">
                <button
                  type="button"
                  onClick={handleSimulate}
                  disabled={simulating}
                  className="auth-button"
                >
                  {simulating
                    ? "Simulating…"
                    : effectiveAmountCents
                      ? `Test refill ${fmtUsd(effectiveAmountCents)} without Stripe`
                      : "Test refill without Stripe"}
                </button>
                <div className="dashboard-muted">
                  This adds a temporary test refill entry to your OttoAuth balance without charging a card. Use it to verify the crediting flow before a real payment.
                </div>
              </div>
            )}
            {!props.stripeConfigured && (
              <div className="auth-error">
                Stripe checkout is not configured yet on this deployment.
              </div>
            )}
            {successMessage && <div className="auth-success">{successMessage}</div>}
            {error && <div className="auth-error">{error}</div>}
          </article>
        </section>
      </section>
    </main>
  );
}
