"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useState } from "react";

type StoreId =
  | "snackpass"
  | "amazon"
  | "instacart"
  | "grubhub"
  | "uber"
  | "ebay"
  | "ubereats";

type FulfillmentPreference = "pickup" | "delivery";

const STORE_OPTIONS: Array<{ id: StoreId; label: string; url: string }> = [
  { id: "snackpass", label: "Snackpass", url: "https://www.snackpass.co/" },
  { id: "amazon", label: "Amazon", url: "https://www.amazon.com/" },
  { id: "instacart", label: "Instacart", url: "https://www.instacart.com/" },
  { id: "grubhub", label: "Grubhub", url: "https://www.grubhub.com/" },
  { id: "uber", label: "Uber", url: "https://www.uber.com/" },
  { id: "ebay", label: "eBay", url: "https://www.ebay.com/" },
  { id: "ubereats", label: "Uber Eats", url: "https://www.ubereats.com/" },
];

function parseUsdToCents(value: string) {
  const normalized = value.trim().replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function buildOrderPrompt(params: {
  storeLabel: string;
  merchantName: string;
  itemName: string;
  orderDetails: string;
  fulfillmentPreference: FulfillmentPreference;
  deliveryAddress: string;
  extraInstructions: string;
}) {
  const merchantName = params.merchantName.trim();
  const storeTarget = merchantName ? `${merchantName} on ${params.storeLabel}` : params.storeLabel;
  const parts = [
    `Platform: ${params.storeLabel}`,
    merchantName ? `Store or merchant name: ${merchantName}` : null,
    `Fulfillment method: ${params.fulfillmentPreference}`,
    `Item name: ${params.itemName.trim()}`,
    params.orderDetails.trim()
      ? `Order details, modifiers, and preferences: ${params.orderDetails.trim()}`
      : null,
    params.fulfillmentPreference === "delivery" && params.deliveryAddress.trim()
      ? "Delivery address is provided separately. Use it exactly as written if checkout asks for delivery or shipping details."
      : null,
    params.extraInstructions.trim()
      ? `Additional instructions: ${params.extraInstructions.trim()}`
      : null,
  ].filter((part): part is string => Boolean(part));

  return `Please place this ${params.fulfillmentPreference} order from ${storeTarget}.\n\n${parts.join("\n")}`;
}

export function NewOrderClient() {
  const [storeId, setStoreId] = useState<StoreId>("snackpass");
  const [merchantName, setMerchantName] = useState("");
  const [itemName, setItemName] = useState("");
  const [orderDetails, setOrderDetails] = useState("");
  const [fulfillmentPreference, setFulfillmentPreference] = useState<FulfillmentPreference>("pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [maxChargeUsd, setMaxChargeUsd] = useState("");
  const [fulfillmentMode, setFulfillmentMode] = useState<"auto" | "own_device" | "marketplace">("auto");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedStore = STORE_OPTIONS.find((store) => store.id === storeId) ?? STORE_OPTIONS[0];
    const merchant = merchantName.trim();
    const item = itemName.trim();
    const address = deliveryAddress.trim();

    if (!item) {
      setError("Please enter the item name before submitting.");
      return;
    }
    if (fulfillmentPreference === "delivery" && !address) {
      setError("Please enter a delivery address or switch the order to pickup.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const maxChargeCents = parseUsdToCents(maxChargeUsd);
      const taskPrompt = buildOrderPrompt({
        storeLabel: selectedStore.label,
        merchantName: merchant,
        itemName: item,
        orderDetails,
        fulfillmentPreference,
        deliveryAddress: address,
        extraInstructions,
      });
      const taskTitle = merchant ? `${merchant} (${selectedStore.label}): ${item}` : `${selectedStore.label}: ${item}`;
      const response = await fetch("/api/human/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website_url: selectedStore.url,
          shipping_address: fulfillmentPreference === "delivery" ? address : undefined,
          task_prompt: taskPrompt,
          task_title: taskTitle,
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
              Submit a structured purchase request, then watch fulfillment live once a device picks it up.
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
              <label className="stack-form">
                <span className="supported-accounts-title">Platform</span>
                <select
                  className="auth-input"
                  value={storeId}
                  onChange={(event) => setStoreId(event.target.value as StoreId)}
                >
                  {STORE_OPTIONS.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="stack-form">
                <span className="supported-accounts-title">Store name</span>
                <input
                  className="auth-input"
                  value={merchantName}
                  onChange={(event) => setMerchantName(event.target.value)}
                  placeholder="Example: Little Plearn, Safeway, Target, seller name, restaurant name"
                />
              </label>

              <label className="stack-form">
                <span className="supported-accounts-title">Item name</span>
                <input
                  className="auth-input"
                  value={itemName}
                  onChange={(event) => setItemName(event.target.value)}
                  placeholder="Example: pad see ew, AA batteries, oat milk, ride to SFO"
                  required
                />
              </label>

              <label className="stack-form">
                <span className="supported-accounts-title">Order details</span>
                <textarea
                  className="auth-input shipping-textarea"
                  value={orderDetails}
                  onChange={(event) => setOrderDetails(event.target.value)}
                  placeholder="Modifiers like iced, no ice, spice level, sugar level, size, quantity, substitutions, preferred brand, or tip."
                />
              </label>

              <label className="stack-form">
                <span className="supported-accounts-title">Pickup or delivery</span>
                <select
                  className="auth-input"
                  value={fulfillmentPreference}
                  onChange={(event) =>
                    setFulfillmentPreference(event.target.value as FulfillmentPreference)
                  }
                >
                  <option value="pickup">Pickup</option>
                  <option value="delivery">Delivery</option>
                </select>
              </label>

              {fulfillmentPreference === "delivery" && (
                <label className="stack-form">
                  <span className="supported-accounts-title">Delivery address</span>
                  <textarea
                    className="auth-input shipping-textarea"
                    value={deliveryAddress}
                    onChange={(event) => setDeliveryAddress(event.target.value)}
                    placeholder={"Jane Doe\n123 Main St Apt 4B\nSan Francisco, CA 94110"}
                    required
                  />
                </label>
              )}

              <label className="stack-form">
                <span className="supported-accounts-title">Extra instructions</span>
                <textarea
                  className="auth-input shipping-textarea"
                  value={extraInstructions}
                  onChange={(event) => setExtraInstructions(event.target.value)}
                  placeholder="Anything else the fulfiller should know, like call/text preferences, do-not-buy substitutions, or exact listing constraints."
                />
              </label>

              <label className="stack-form">
                <span className="supported-accounts-title">Spend cap</span>
                <input
                  className="auth-input"
                  value={maxChargeUsd}
                  onChange={(event) => setMaxChargeUsd(event.target.value)}
                  placeholder="Optional max charge in USD, e.g. 25.00"
                  inputMode="decimal"
                />
              </label>

              <label className="stack-form">
                <span className="supported-accounts-title">Fulfiller</span>
                <select
                  className="auth-input"
                  value={fulfillmentMode}
                  onChange={(event) =>
                    setFulfillmentMode(event.target.value as "auto" | "own_device" | "marketplace")
                  }
                >
                  <option value="auto">Auto: use my device first, then another enabled fulfiller</option>
                  <option value="own_device">Only my claimed device</option>
                  <option value="marketplace">Only another enabled fulfiller</option>
                </select>
              </label>

              <div className="dashboard-muted">
                OttoAuth turns these fields into a clear browser task for the fulfiller. Platform plus store name helps the browser agent find the right merchant quickly.
              </div>

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
                    Auto mode prefers your own enabled linked fulfillment agent and falls back to another enabled fulfiller.
                  </div>
                </div>
              </div>
              <div className="dashboard-row">
                <div>
                  <strong>2. The browser agent follows the structured request</strong>
                  <div className="dashboard-muted">
                    Platform, store name, item, modifiers, pickup/delivery, address, tip, and substitutions are included in the task prompt.
                  </div>
                </div>
              </div>
              <div className="dashboard-row">
                <div>
                  <strong>3. You get a live order page</strong>
                  <div className="dashboard-muted">
                    The order detail page polls for screenshots, pickup details, receipt info, and run events while fulfillment works.
                  </div>
                </div>
              </div>
              <div className="dashboard-row">
                <div>
                  <strong>4. Credits settle after completion</strong>
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
