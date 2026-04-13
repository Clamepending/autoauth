"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";

function parseUsdToCents(value: string) {
  const normalized = value.trim().replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

export function NewOrderClient() {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [maxChargeUsd, setMaxChargeUsd] = useState("");
  const [fulfillmentMode, setFulfillmentMode] = useState<"auto" | "own_device" | "marketplace">("auto");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskPrompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const maxChargeCents = parseUsdToCents(maxChargeUsd);
      const response = await fetch("/api/human/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website_url: websiteUrl.trim() || undefined,
          shipping_address: shippingAddress.trim() || undefined,
          task_prompt: taskPrompt.trim(),
          max_charge_cents: maxChargeCents ?? undefined,
          fulfillment_mode: fulfillmentMode,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Could not create order.");
        return;
      }
      window.location.href = `/orders/${payload?.task?.id}`;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="dashboard-page">
      <section className="dashboard-shell">
        <div className="dashboard-header">
          <div>
            <div className="eyebrow">Human Order Page</div>
            <h1>Create an order</h1>
            <p className="lede">
              Submit a purchase or browser order yourself, then watch fulfillment live once a device picks it up.
            </p>
          </div>
          <div className="dashboard-actions">
            <Link className="auth-button" href="/dashboard">
              Back to dashboard
            </Link>
          </div>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <section className="dashboard-grid wide">
          <article className="dashboard-card">
            <div className="supported-accounts-title">Order Request</div>
            <form className="stack-form" onSubmit={handleSubmit}>
              <input
                className="auth-input"
                value={websiteUrl}
                onChange={(event) => setWebsiteUrl(event.target.value)}
                placeholder="Optional website URL, e.g. amazon.com or https://www.amazon.com"
                inputMode="url"
              />
              <textarea
                className="auth-input shipping-textarea"
                value={shippingAddress}
                onChange={(event) => setShippingAddress(event.target.value)}
                placeholder={"Optional shipping address\nJane Doe\n123 Main St Apt 4B\nSan Francisco, CA 94110"}
              />
              <textarea
                className="auth-input task-textarea"
                value={taskPrompt}
                onChange={(event) => setTaskPrompt(event.target.value)}
                placeholder="Describe exactly what should be ordered or what browser work should be completed. Include size, flavor, quantity, options, substitutions, or any other details that matter."
              />
              <div className="dashboard-muted">
                This description is what the browser fulfiller follows. If it is vague or incomplete, OttoAuth may order the wrong item or hit errors during checkout.
              </div>
              <input
                className="auth-input"
                value={maxChargeUsd}
                onChange={(event) => setMaxChargeUsd(event.target.value)}
                placeholder="Optional max charge in USD, e.g. 25.00"
                inputMode="decimal"
              />
              <select
                className="auth-input"
                value={fulfillmentMode}
                onChange={(event) =>
                  setFulfillmentMode(event.target.value as "auto" | "own_device" | "marketplace")
                }
              >
                <option value="auto">Auto: use my device first, then marketplace</option>
                <option value="own_device">Only my claimed device</option>
                <option value="marketplace">Only marketplace devices</option>
              </select>
              <button className="auth-button primary" type="submit" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit order"}
              </button>
            </form>
          </article>

          <article className="dashboard-card">
            <div className="supported-accounts-title">What Happens Next</div>
            <div className="dashboard-list">
              <div className="dashboard-row">
                <div>
                  <strong>1. OttoAuth assigns a fulfiller</strong>
                  <div className="dashboard-muted">
                    Auto mode prefers your own enabled linked fulfillment agent and falls back to an enabled marketplace fulfiller.
                  </div>
                </div>
              </div>
              <div className="dashboard-row">
                <div>
                  <strong>2. You get a live order page</strong>
                  <div className="dashboard-muted">
                    The order detail page polls for fresh screenshots and run events while the browser fulfiller works.
                  </div>
                </div>
              </div>
              <div className="dashboard-row">
                <div>
                  <strong>3. Credits settle after completion</strong>
                  <div className="dashboard-muted">
                    OttoAuth calculates the total after the order finishes and credits the fulfiller if another human completed it for you.
                  </div>
                </div>
              </div>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
