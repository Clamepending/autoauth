"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

type CatalogOffer = {
  id: string;
  merchant: string;
  platform: string;
  title: string;
  description: string;
  url: string | null;
  display_price: string | null;
  display_total: string | null;
  availability: {
    label: string;
    detail: string;
  };
  source_label: string;
  confidence: string;
  quote: Record<string, unknown> | null;
  order_payload: Record<string, unknown>;
};

function confidenceLabel(value: string) {
  if (value === "exact") return "Exact";
  if (value === "high") return "High confidence";
  if (value === "medium") return "Estimate";
  if (value === "low") return "Low estimate";
  if (value === "unavailable") return "Retroactive";
  return "Agent assisted";
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="m21 21-4.35-4.35m1.1-5.4a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

export function NewOrderClient() {
  const [query, setQuery] = useState("");
  const [offers, setOffers] = useState<CatalogOffer[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedOffer = useMemo(
    () => offers.find((offer) => offer.id === selectedOfferId) ?? null,
    [offers, selectedOfferId],
  );

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setError("Search for something to buy.");
      return;
    }

    setSearching(true);
    setError(null);
    setSelectedOfferId(null);
    try {
      const response = await fetch("/api/human/catalog/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Could not search.");
        return;
      }
      setOffers(Array.isArray(payload?.offers) ? payload.offers : []);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  }

  async function submitSelectedOffer() {
    if (!selectedOffer) return;

    const orderPayload = selectedOffer.order_payload || {};
    const task =
      typeof orderPayload.task === "string" && orderPayload.task.trim()
        ? orderPayload.task
        : `Order ${selectedOffer.title} from ${selectedOffer.merchant}.`;
    const preferences = selectedOffer.display_total
      ? `Selected catalog quote: ${selectedOffer.display_total} from ${selectedOffer.source_label}. Revalidate final checkout total before purchase.`
      : `Selected catalog offer has no upfront price. Confirm final checkout total before purchase.`;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/human/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...orderPayload,
          task,
          task_title:
            typeof orderPayload.task_title === "string"
              ? orderPayload.task_title
              : selectedOffer.title,
          merchant_name:
            typeof orderPayload.merchant_name === "string"
              ? orderPayload.merchant_name
              : selectedOffer.merchant,
          platform_hint:
            typeof orderPayload.platform_hint === "string"
              ? orderPayload.platform_hint
              : selectedOffer.platform,
          url: selectedOffer.url ?? orderPayload.url,
          url_policy: selectedOffer.url ? "preferred" : orderPayload.url_policy ?? "discover",
          fulfillment: "shipping",
          preferences,
          quantity: 1,
          offer_id: selectedOffer.id,
          selected_offer: selectedOffer,
          quote: selectedOffer.quote ?? undefined,
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
    <main className="catalog-page catalog-minimal-page">
      <section className="catalog-shell catalog-minimal-shell">
        <nav className="catalog-minimal-nav" aria-label="Catalog navigation">
          <Link href="/dashboard">Back</Link>
          <Link href="/orders">Orders</Link>
        </nav>

        <section className="catalog-minimal-search">
          <h1>Browse catalog</h1>
          <form className="catalog-minimal-form" onSubmit={handleSearch}>
            <SearchIcon />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search products or paste a URL"
              autoFocus
            />
            <button type="submit" disabled={searching} aria-label="Search">
              {searching ? "Searching" : "Search"}
            </button>
          </form>
        </section>

        {error && <div className="catalog-minimal-error">{error}</div>}

        {searched ? (
          <section className="catalog-minimal-results" aria-label="Search results">
            {offers.length === 0 ? (
              <div className="catalog-minimal-empty">No results</div>
            ) : (
              offers.map((offer) => {
                const selected = selectedOffer?.id === offer.id;
                return (
                  <article
                    key={offer.id}
                    className={`catalog-minimal-offer ${selected ? "selected" : ""}`}
                  >
                    <button type="button" onClick={() => setSelectedOfferId(offer.id)}>
                      <span>
                        <strong>{offer.title}</strong>
                        <span>{offer.merchant}</span>
                      </span>
                      <span>
                        <strong>{offer.display_total || offer.display_price || "Quote later"}</strong>
                        <span>{confidenceLabel(offer.confidence)}</span>
                      </span>
                    </button>
                    {selected ? (
                      <div className="catalog-minimal-order">
                        <div>
                          {offer.source_label} · {offer.availability.label}
                        </div>
                        <button
                          type="button"
                          onClick={submitSelectedOffer}
                          disabled={submitting}
                        >
                          {submitting ? "Placing" : "Place order"}
                          <ArrowIcon />
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </section>
        ) : null}
      </section>
    </main>
  );
}
