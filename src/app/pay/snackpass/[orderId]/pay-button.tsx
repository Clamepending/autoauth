"use client";

import { useState } from "react";

export function PayButton({
  orderId,
  priceDisplay,
}: {
  orderId: number;
  priceDisplay: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pay/snackpass/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not start payment.");
        setLoading(false);
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError("No payment URL returned.");
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  }

  return (
    <div className="pay-actions">
      <button
        type="button"
        onClick={handlePay}
        disabled={loading}
        className="pay-button"
      >
        {loading ? "Redirecting…" : `Pay ${priceDisplay} with card or Google Pay`}
      </button>
      {error && <p className="pay-error">{error}</p>}
    </div>
  );
}
