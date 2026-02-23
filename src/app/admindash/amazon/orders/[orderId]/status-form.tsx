"use client";

import { useState } from "react";

export function FulfillmentActions({
  orderId,
  initialTrackingNumber,
  initialNote,
}: {
  orderId: number;
  initialTrackingNumber: string;
  initialNote: string;
}) {
  const [trackingNumber, setTrackingNumber] = useState(initialTrackingNumber);
  const [note, setNote] = useState(initialNote);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(action: "fulfilled" | "failed") {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/amazon/orders/${orderId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          tracking_number: trackingNumber,
          note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not update order.");
        return;
      }
      setMessage(`Order marked ${action}.`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      style={{
        border: "1px solid var(--line)",
        background: "var(--paper)",
        padding: 20,
      }}
    >
      <h2 style={{ fontSize: 18, marginTop: 0 }}>Manual fulfillment</h2>
      <p style={{ color: "var(--muted)", marginTop: 0 }}>
        Add tracking or comment, then update the order status.
      </p>
      <label style={{ display: "block", fontSize: 14, marginBottom: 6 }}>
        Tracking number
      </label>
      <input
        type="text"
        value={trackingNumber}
        onChange={(e) => setTrackingNumber(e.target.value)}
        placeholder="e.g. 1Z999AA10123456784"
        style={{
          width: "100%",
          padding: "10px 12px",
          border: "1px solid var(--line)",
          marginBottom: 14,
          boxSizing: "border-box",
        }}
      />

      <label style={{ display: "block", fontSize: 14, marginBottom: 6 }}>
        Comment
      </label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
        placeholder="Optional note or failure reason"
        style={{
          width: "100%",
          padding: "10px 12px",
          border: "1px solid var(--line)",
          marginBottom: 14,
          boxSizing: "border-box",
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={() => submit("fulfilled")}
          disabled={submitting}
          style={{ padding: "8px 14px", cursor: submitting ? "not-allowed" : "pointer" }}
        >
          {submitting ? "Saving..." : "Mark fulfilled"}
        </button>
        <button
          type="button"
          onClick={() => submit("failed")}
          disabled={submitting}
          style={{ padding: "8px 14px", cursor: submitting ? "not-allowed" : "pointer" }}
        >
          {submitting ? "Saving..." : "Mark failed"}
        </button>
      </div>

      {error && <p style={{ color: "#b42318", marginTop: 12 }}>{error}</p>}
      {message && <p style={{ color: "#067647", marginTop: 12 }}>{message}</p>}
    </section>
  );
}
