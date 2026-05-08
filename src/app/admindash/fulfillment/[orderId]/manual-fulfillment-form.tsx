"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

type Props = {
  orderId: string;
  defaultMerchant: string;
  final: boolean;
};

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function dollars(form: FormData, name: string) {
  const value = field(form, name);
  return value ? value : "0";
}

export function ManualFulfillmentForm({ orderId, defaultMerchant, final }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/fulfillment/orders/${orderId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not claim order.");
        return;
      }
      setMessage("Order claimed.");
      router.refresh();
    } catch {
      setError("Network error while claiming order.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (final) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/fulfillment/orders/${orderId}/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: field(form, "status"),
          merchant: field(form, "merchant"),
          summary: field(form, "summary"),
          error: field(form, "error"),
          currency: field(form, "currency") || "usd",
          goods_dollars: dollars(form, "goods_dollars"),
          shipping_dollars: dollars(form, "shipping_dollars"),
          tax_dollars: dollars(form, "tax_dollars"),
          other_dollars: dollars(form, "other_dollars"),
          receipt_url: field(form, "receipt_url"),
          receipt_text: field(form, "receipt_text"),
          order_number: field(form, "order_number"),
          confirmation_code: field(form, "confirmation_code"),
          pickup_code: field(form, "pickup_code"),
          tracking_number: field(form, "tracking_number"),
          tracking_url: field(form, "tracking_url"),
          provider_status: field(form, "provider_status"),
          delivery_eta: field(form, "delivery_eta"),
          note: field(form, "note"),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not save manual fulfillment.");
        return;
      }
      setMessage("Manual fulfillment saved.");
      router.refresh();
    } catch {
      setError("Network error while saving fulfillment.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (final) return;
    const form = new FormData(event.currentTarget);
    const reason = field(form, "cancel_reason");
    setCanceling(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/fulfillment/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not cancel order.");
        return;
      }
      setMessage("Order canceled.");
      router.refresh();
    } catch {
      setError("Network error while canceling order.");
    } finally {
      setCanceling(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (final) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/fulfillment/orders/${orderId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: field(form, "message_channel"),
          message: field(form, "message_body"),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not record message.");
        return;
      }
      event.currentTarget.reset();
      setMessage("Message recorded.");
      router.refresh();
    } catch {
      setError("Network error while recording message.");
    } finally {
      setSubmitting(false);
    }
  }

  async function askClarification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (final) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/fulfillment/orders/${orderId}/clarification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: field(form, "clarification_question"),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not request clarification.");
        return;
      }
      event.currentTarget.reset();
      setMessage("Clarification requested; order is blocked.");
      router.refresh();
    } catch {
      setError("Network error while requesting clarification.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-control-stack admin-manual-form">
      <form className="admin-control-stack" onSubmit={submit}>
        <div className="admin-fact-grid compact">
          <label className="admin-fact">
            <span>Result</span>
            <select name="status" defaultValue="completed">
              <option value="completed">Success</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="admin-fact">
            <span>Merchant</span>
            <input name="merchant" type="text" defaultValue={defaultMerchant} />
          </label>
        </div>

        <label className="admin-fact">
          <span>Summary</span>
          <textarea
            name="summary"
            rows={3}
            placeholder="What was ordered, where, and what the requester should know."
          />
        </label>

        <div className="admin-fact-grid compact">
          <label className="admin-fact">
            <span>Order number</span>
            <input name="order_number" type="text" placeholder="Merchant order ID" />
          </label>
          <label className="admin-fact">
            <span>Tracking number</span>
            <input name="tracking_number" type="text" placeholder="Carrier tracking" />
          </label>
          <label className="admin-fact">
            <span>Confirmation code</span>
            <input name="confirmation_code" type="text" placeholder="Confirmation or pickup code" />
          </label>
          <label className="admin-fact">
            <span>Delivery ETA</span>
            <input name="delivery_eta" type="text" placeholder="Today, May 9, 2-5 PM" />
          </label>
        </div>

        <div className="admin-fact-grid compact">
          <label className="admin-fact">
            <span>Provider status</span>
            <input name="provider_status" type="text" placeholder="Ordered, shipped, ready, etc." />
          </label>
          <label className="admin-fact">
            <span>Tracking URL</span>
            <input name="tracking_url" type="url" placeholder="https://..." />
          </label>
          <label className="admin-fact">
            <span>Receipt URL</span>
            <input name="receipt_url" type="url" placeholder="https://..." />
          </label>
          <label className="admin-fact">
            <span>Pickup code</span>
            <input name="pickup_code" type="text" />
          </label>
        </div>

        <div className="admin-fact-grid compact">
          <label className="admin-fact">
            <span>Goods dollars</span>
            <input name="goods_dollars" type="number" min="0" step="0.01" inputMode="decimal" />
          </label>
          <label className="admin-fact">
            <span>Shipping dollars</span>
            <input name="shipping_dollars" type="number" min="0" step="0.01" inputMode="decimal" />
          </label>
          <label className="admin-fact">
            <span>Tax dollars</span>
            <input name="tax_dollars" type="number" min="0" step="0.01" inputMode="decimal" />
          </label>
          <label className="admin-fact">
            <span>Other dollars</span>
            <input name="other_dollars" type="number" min="0" step="0.01" inputMode="decimal" />
          </label>
        </div>

        <label className="admin-fact">
          <span>Failure reason</span>
          <textarea name="error" rows={2} placeholder="Use this when marking the order failed." />
        </label>

        <details className="admin-compact-details">
          <summary>Receipt text and internal notes</summary>
          <div className="admin-control-stack">
            <label className="admin-fact">
              <span>Receipt text</span>
              <textarea name="receipt_text" rows={4} placeholder="Paste receipt details when no receipt URL exists." />
            </label>
            <label className="admin-fact">
              <span>Internal note</span>
              <textarea name="note" rows={3} placeholder="Operator note, not necessarily requester-facing." />
            </label>
          </div>
        </details>
        <input name="currency" type="hidden" value="usd" />

        <div className="admin-action-row">
          <button
            className="admin-button"
            type="button"
            disabled={submitting || final}
            onClick={() => {
              void claim();
            }}
          >
            Claim
          </button>
          <button className="admin-button primary" type="submit" disabled={submitting || final}>
            {submitting ? "Updating..." : "Update / complete"}
          </button>
        </div>

        {error ? <p className="danger-text">{error}</p> : null}
        {message ? <p className="admin-subtle">{message}</p> : null}
        {final ? <p className="admin-empty">This order is final.</p> : null}
      </form>

      <form className="admin-control-stack admin-cancel-box" onSubmit={cancel}>
        <label className="admin-fact">
          <span>Cancel reason</span>
          <textarea name="cancel_reason" rows={2} placeholder="Why this order should be canceled." />
        </label>
        <button className="admin-button danger" type="submit" disabled={canceling || final}>
          {canceling ? "Canceling..." : "Cancel order"}
        </button>
      </form>

      <details className="admin-compact-details">
        <summary>Record a message</summary>
        <form className="admin-control-stack" onSubmit={sendMessage}>
          <div className="admin-fact-grid compact">
            <label className="admin-fact">
              <span>Message channel</span>
              <select name="message_channel" defaultValue="requester">
                <option value="requester">requester</option>
                <option value="human_operator">operator note</option>
                <option value="provider_vendor">vendor/provider</option>
                <option value="driver">driver</option>
                <option value="shopper">shopper</option>
                <option value="support">support</option>
              </select>
            </label>
          </div>
          <label className="admin-fact">
            <span>Record or deliver message</span>
            <textarea name="message_body" rows={3} placeholder="What needs to be sent or recorded for this order." />
          </label>
          <button className="admin-button" type="submit" disabled={submitting || final}>
            Record message
          </button>
        </form>
      </details>

      <details className="admin-compact-details">
        <summary>Block and ask clarification</summary>
        <form className="admin-control-stack" onSubmit={askClarification}>
          <label className="admin-fact">
            <span>Ask clarification</span>
            <textarea name="clarification_question" rows={3} placeholder="What exact answer is needed before fulfillment can continue." />
          </label>
          <button className="admin-button" type="submit" disabled={submitting || final}>
            Block and ask
          </button>
        </form>
      </details>
    </div>
  );
}
