"use client";

import { useState } from "react";

export function FulfillmentActions({
  orderId,
  initialNote,
}: {
  orderId: number;
  initialNote: string;
}) {
  const [note, setNote] = useState(initialNote);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(action: "fulfilled" | "failed") {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/snackpass/orders/${orderId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
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
        padding: 24,
        boxShadow: "6px 6px 0 var(--shadow)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 6 }}>Manual fulfillment</h2>
          <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 0 }}>
            Add a note, then update the order status.
          </p>
        </div>
        <div
          style={{
            fontSize: 12,
            padding: "6px 10px",
            border: "1px solid var(--line)",
            background: "#fff",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Required for Fulfilled
        </div>
      </div>
      <label style={{ display: "block", fontSize: 14, marginBottom: 6 }}>
        Fulfillment note
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
          background: "#fff",
        }}
      />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => submit("fulfilled")}
          disabled={submitting}
          style={{
            padding: "10px 16px",
            cursor: submitting ? "not-allowed" : "pointer",
            border: "1px solid var(--line)",
            background: "var(--ink)",
            color: "#fff",
          }}
        >
          {submitting ? "Saving..." : "Mark fulfilled"}
        </button>
        <button
          type="button"
          onClick={() => submit("failed")}
          disabled={submitting}
          style={{
            padding: "10px 16px",
            cursor: submitting ? "not-allowed" : "pointer",
            border: "1px solid var(--line)",
            background: "#fff",
            color: "var(--ink)",
          }}
        >
          {submitting ? "Saving..." : "Mark failed"}
        </button>
      </div>

      {error && <p style={{ color: "#b42318", marginTop: 12 }}>{error}</p>}
      {message && <p style={{ color: "#067647", marginTop: 12 }}>{message}</p>}
    </section>
  );
}
