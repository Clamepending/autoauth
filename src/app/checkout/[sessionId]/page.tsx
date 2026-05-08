import Link from "next/link";
import { notFound } from "next/navigation";

import {
  checkoutSessionDisplay,
  getFreshCheckoutSessionById,
  orderSummaryFromPayload,
} from "@/lib/ottoauth-checkout-sessions";

type Props = {
  params: {
    sessionId: string;
  };
  searchParams?: {
    error?: string;
  };
};

export const dynamic = "force-dynamic";

function money(cents: number | null | undefined) {
  if (cents == null || !Number.isFinite(cents)) return "Unknown";
  return `$${(cents / 100).toFixed(2)}`;
}

function dollars(cents: number | null | undefined) {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

function displayStatus(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.replace(/_/g, " ")
    : "unknown";
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export default async function CheckoutSessionPage({ params, searchParams }: Props) {
  const session = await getFreshCheckoutSessionById(params.sessionId);
  if (!session) notFound();

  const display = await checkoutSessionDisplay(session);
  const order = display.rawOrder;
  const summary = orderSummaryFromPayload(order);
  const quote = display.priceQuote ?? {};
  const quoteTotal =
    typeof quote.display_total === "string" && quote.display_total
      ? quote.display_total
      : money(typeof quote.total_cents === "number" ? quote.total_cents : null);
  const quoteMode =
    typeof quote.billing_mode === "string" && quote.billing_mode
      ? quote.billing_mode.replace(/_/g, " ")
      : "reconciled after fulfillment";
  const confirmDisabled = session.status !== "open";
  const errorMessage =
    firstString(searchParams?.error) || firstString(session.last_error) || "";
  const statusLabel = displayStatus(session.status);
  const quoteStatus = displayStatus(quote.status);
  const quoteConfidence = displayStatus(quote.confidence);

  return (
    <main className="checkout-page">
      <section className="checkout-shell">
        <div className="checkout-header">
          <div>
            <p className="eyebrow">OttoAuth Checkout</p>
            <h1>Confirm Order</h1>
          </div>
          {session.status !== "open" ? (
            <p className={`checkout-status-text checkout-status-${session.status}`}>
              {statusLabel}
            </p>
          ) : null}
        </div>

        {errorMessage ? <div className="auth-error">{errorMessage}</div> : null}

        <div className="checkout-grid">
          <section className="dashboard-card checkout-primary-card">
            <div className="dashboard-section-header">
              <div>
                <p className="dashboard-muted">From {session.app_name}</p>
                <h2 className="dashboard-card-title">{summary.title}</h2>
              </div>
              <div className="checkout-price">{quoteTotal}</div>
            </div>

            <div className="quick-facts-grid">
              <div className="quick-fact-card">
                <div className="quick-fact-label">Quote</div>
                <div className="quick-fact-value">{quoteTotal}</div>
                <div className="dashboard-muted">{quoteMode}</div>
              </div>
              <div className="quick-fact-card">
                <div className="quick-fact-label">Merchant</div>
                <div className="quick-fact-value">{summary.merchant}</div>
              </div>
            </div>

            <div className="checkout-section">
              <h3>Order Description</h3>
              <p className="checkout-prewrap">{summary.task}</p>
            </div>

            {summary.shippingAddress ? (
              <div className="checkout-section">
                <h3>Shipping</h3>
                <p className="checkout-prewrap">{summary.shippingAddress}</p>
              </div>
            ) : null}

            {summary.files.length > 0 ? (
              <div className="checkout-section">
                <h3>Files</h3>
                <div className="checkout-file-list">
                  {summary.files.map((file) => (
                    <div className="checkout-file-row" key={`${file.index}-${file.name}`}>
                      <div>
                        <strong>{file.name}</strong>
                        <span>
                          {[file.purpose, file.contentType].filter(Boolean).join(" - ") ||
                            "Attached file"}
                        </span>
                      </div>
                      {file.url ? (
                        <a href={file.url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <aside className="dashboard-card checkout-side-card">
            <div>
              <h2>Account</h2>
              {display.linkedHuman ? (
                <div className="checkout-account">
                  <strong>
                    {display.linkedHuman.display_name || display.linkedHuman.email}
                  </strong>
                  <span>{display.linkedHuman.email}</span>
                  <span>Credit balance {money(display.linkedHuman.balance_cents)}</span>
                </div>
              ) : (
                <p className="dashboard-muted">
                  No linked human account was found for this agent. OttoAuth will use
                  the configured guest funding path if available.
                </p>
              )}
            </div>

            {session.status === "confirmed" && session.order_task_id ? (
              <Link
                className="auth-button primary"
                href={`/admindash/fulfillment/${session.order_public_id ?? session.order_task_id}`}
              >
                View fulfillment
              </Link>
            ) : (
              <form
                className="checkout-actions"
                method="post"
                action={`/checkout/${encodeURIComponent(session.id)}/confirm`}
              >
                <label className="checkout-field">
                  <span>Spend cap</span>
                  <span className="checkout-money-input">
                    <span>$</span>
                    <input
                      name="max_charge_usd"
                      type="number"
                      aria-label="Spend cap"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      defaultValue={dollars(summary.maxChargeCents)}
                      required
                      disabled={confirmDisabled}
                    />
                  </span>
                  <small>
                    Fulfillment may only complete if the final merchant total is
                    at or below this amount.
                  </small>
                </label>
                <p className="checkout-note">
                  Estimated quote: {quoteTotal}
                  {quoteStatus !== "unknown" ? ` (${quoteStatus}` : ""}
                  {quoteStatus !== "unknown" && quoteConfidence !== "unknown"
                    ? `, ${quoteConfidence} confidence`
                    : ""}
                  {quoteStatus !== "unknown" ? ")" : ""}.
                </p>
                <button
                  className="auth-button primary"
                  type="submit"
                  disabled={confirmDisabled}
                >
                  Confirm under cap
                </button>
              </form>
            )}

            <form
              className="checkout-actions"
              method="post"
              action={`/checkout/${encodeURIComponent(session.id)}/cancel`}
            >
              <button
                className="auth-button"
                type="submit"
                disabled={session.status !== "open"}
              >
                Cancel
              </button>
            </form>

            <p className="dashboard-muted">
              Session expires {new Date(session.expires_at).toLocaleString()}.
            </p>
          </aside>
        </div>
      </section>
    </main>
  );
}
