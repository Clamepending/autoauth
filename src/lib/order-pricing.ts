import type {
  NormalizedOrderItem,
  NormalizedOrderRequest,
  OrderKind,
  ProviderDefinition,
} from "@/lib/order-orchestration";
import type { NonBrowserPriceQuote } from "@/lib/non-browser-price-quotes";

export type PricingConfidence = "none" | "low" | "medium" | "high";

export type OrderPricingState =
  | "final"
  | "quoted"
  | "estimated"
  | "spend_limit_only";

export type OrderPricingSummary = {
  state: OrderPricingState;
  currency: string;
  display_total_cents: number | null;
  estimated_total_cents: number | null;
  estimate_low_cents: number | null;
  estimate_high_cents: number | null;
  quoted_total_cents: number | null;
  captured_cents: number;
  max_charge_cents: number | null;
  confidence: PricingConfidence;
  source:
    | "explicit_request"
    | "ottoauth_heuristic"
    | "non_browser_quote"
    | "quote"
    | "final_charge"
    | "spend_limit";
  explanation: string;
  spend_limit: {
    required: true;
    provided: boolean;
    covers_estimate: boolean | null;
    covers_high_estimate: boolean | null;
    requires_approval_above_limit: true;
  };
  pending_final_price: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cents(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
  }
  return null;
}

function quantity(value: string | null) {
  if (!value) return 1;
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(500, parsed) : 1;
}

function totalQuantity(items: NormalizedOrderItem[]) {
  return Math.max(1, items.reduce((sum, item) => sum + quantity(item.quantity), 0));
}

function explicitPricing(payload: Record<string, unknown>) {
  const nested = isRecord(payload.pricing) ? payload.pricing : {};
  const total =
    cents(payload.estimated_total_cents) ??
    cents(payload.estimate_total_cents) ??
    cents(payload.estimated_price_cents) ??
    cents(payload.price_estimate_cents) ??
    cents(nested.estimated_total_cents) ??
    cents(nested.estimate_total_cents);
  if (total == null || total <= 0) return null;
  const low =
    cents(payload.estimate_low_cents) ??
    cents(payload.estimated_low_cents) ??
    cents(nested.estimate_low_cents) ??
    Math.max(1, Math.round(total * 0.8));
  const high =
    cents(payload.estimate_high_cents) ??
    cents(payload.estimated_high_cents) ??
    cents(nested.estimate_high_cents) ??
    Math.max(total, Math.round(total * 1.25));
  const confidenceRaw =
    typeof payload.estimate_confidence === "string"
      ? payload.estimate_confidence
      : typeof nested.confidence === "string"
        ? nested.confidence
        : "medium";
  const confidence = ["low", "medium", "high"].includes(confidenceRaw)
    ? (confidenceRaw as PricingConfidence)
    : "medium";
  return {
    total,
    low: Math.min(low, total),
    high: Math.max(high, total),
    confidence,
    source: "explicit_request" as const,
    explanation: "Estimated price supplied by the integrating app.",
  };
}

function heuristicForKind(kind: OrderKind, request: NormalizedOrderRequest) {
  const fileCount = Math.max(0, request.files.length);
  const itemCount = Math.max(0, request.items.length);
  const qty = totalQuantity(request.items);

  if (kind === "manufacturing_3d_print") {
    const total = 2200 + fileCount * 1800 + Math.max(0, qty - 1) * 900 + itemCount * 400;
    return {
      total,
      low: Math.round(total * 0.65),
      high: Math.round(total * 1.85),
      confidence: "low" as const,
      explanation:
        "Rough manufacturing estimate from order kind, attached CAD files, item count, and quantity. Final price depends on geometry, material, finish, shipping, and vendor quote.",
    };
  }

  if (kind === "manufacturing_pcb") {
    const total = 3200 + fileCount * 1000 + Math.max(0, itemCount - 1) * 550;
    return {
      total,
      low: Math.round(total * 0.7),
      high: Math.round(total * 2.1),
      confidence: "low" as const,
      explanation:
        "Rough PCB/electronics estimate from fabrication files and BOM-like item count. Final price depends on board specs, assembly, component availability, quantity, and shipping.",
    };
  }

  if (kind === "restaurant_delivery") {
    const total = 800 + Math.max(1, qty) * 1400;
    return {
      total,
      low: Math.round(total * 0.75),
      high: Math.round(total * 1.45),
      confidence: "medium" as const,
      explanation:
        "Estimated from food item count plus typical tax, tip, and service-fee overhead. Final price depends on menu prices and provider fees.",
    };
  }

  if (kind === "grocery_delivery") {
    const total = 1200 + Math.max(1, qty || itemCount) * 900;
    return {
      total,
      low: Math.round(total * 0.7),
      high: Math.round(total * 1.65),
      confidence: "low" as const,
      explanation:
        "Estimated from grocery item count plus delivery and fee overhead. Final price depends on exact products, substitutions, taxes, tips, and delivery fees.",
    };
  }

  if (kind === "ride" && request.pickupLocation && request.shippingAddress) {
    const total = 2400;
    return {
      total,
      low: 1200,
      high: 6500,
      confidence: "low" as const,
      explanation:
        "Very rough ride estimate because distance and surge pricing are not known to OttoAuth at request time.",
    };
  }

  return null;
}

function spendLimit(maxChargeCents: number | null, estimate: { total: number; high: number } | null) {
  return {
    required: true as const,
    provided: maxChargeCents != null && maxChargeCents > 0,
    covers_estimate: estimate && maxChargeCents != null ? maxChargeCents >= estimate.total : null,
    covers_high_estimate: estimate && maxChargeCents != null ? maxChargeCents >= estimate.high : null,
    requires_approval_above_limit: true as const,
  };
}

export function estimateOrderPricing(params: {
  request: NormalizedOrderRequest;
  provider: ProviderDefinition;
  maxChargeCents: number | null;
  priceQuote?: NonBrowserPriceQuote | null;
  quotedTotalCents?: number | null;
  capturedCents?: number | null;
  currency: string;
}): OrderPricingSummary {
  const capturedCents = Math.max(0, Math.trunc(params.capturedCents ?? 0));
  const quotedTotalCents =
    params.quotedTotalCents == null ? null : Math.max(0, Math.trunc(params.quotedTotalCents));
  const maxChargeCents =
    params.maxChargeCents == null ? null : Math.max(0, Math.trunc(params.maxChargeCents));
  const priceQuote = params.priceQuote ?? null;
  const priceQuoteTotal =
    priceQuote?.status !== "unavailable" && priceQuote?.total_cents != null
      ? Math.max(0, Math.trunc(priceQuote.total_cents))
      : null;
  const explicit = explicitPricing(params.request.raw);
  const heuristic = explicit ?? heuristicForKind(params.request.kind, params.request);
  const estimate = heuristic
    ? {
        total: Math.max(1, Math.trunc(heuristic.total)),
        low: Math.max(1, Math.trunc(heuristic.low)),
        high: Math.max(1, Math.trunc(heuristic.high)),
        confidence: heuristic.confidence,
        source: explicit ? "explicit_request" as const : "ottoauth_heuristic" as const,
        explanation: heuristic.explanation,
      }
    : null;

  if (capturedCents > 0) {
    return {
      state: "final",
      currency: params.currency,
      display_total_cents: capturedCents,
      estimated_total_cents: estimate?.total ?? null,
      estimate_low_cents: estimate?.low ?? null,
      estimate_high_cents: estimate?.high ?? null,
      quoted_total_cents: quotedTotalCents,
      captured_cents: capturedCents,
      max_charge_cents: maxChargeCents,
      confidence: "high",
      source: "final_charge",
      explanation: "Final captured total recorded by OttoAuth fulfillment.",
      spend_limit: spendLimit(maxChargeCents, estimate),
      pending_final_price: false,
    };
  }

  if (priceQuote && priceQuoteTotal != null && priceQuoteTotal > 0) {
    const quoteIsFirm = priceQuote?.status === "priced";
    const quoteConfidence =
      priceQuote.confidence === "exact" || priceQuote.confidence === "high"
        ? "high"
        : priceQuote.confidence === "medium"
          ? "medium"
          : "low";
    return {
      state: quoteIsFirm ? "quoted" : "estimated",
      currency: priceQuote.currency || params.currency,
      display_total_cents: priceQuoteTotal,
      estimated_total_cents: quoteIsFirm ? estimate?.total ?? null : priceQuoteTotal,
      estimate_low_cents: estimate?.low ?? null,
      estimate_high_cents: estimate?.high ?? null,
      quoted_total_cents: quoteIsFirm ? priceQuoteTotal : null,
      captured_cents: capturedCents,
      max_charge_cents: maxChargeCents,
      confidence: quoteConfidence,
      source: "non_browser_quote",
      explanation: priceQuote.message || "Non-browser price quote resolved by OttoAuth.",
      spend_limit: spendLimit(
        maxChargeCents,
        quoteIsFirm ? estimate : { total: priceQuoteTotal, high: priceQuoteTotal },
      ),
      pending_final_price: true,
    };
  }

  if (quotedTotalCents != null && quotedTotalCents > 0) {
    return {
      state: "quoted",
      currency: params.currency,
      display_total_cents: quotedTotalCents,
      estimated_total_cents: estimate?.total ?? null,
      estimate_low_cents: estimate?.low ?? null,
      estimate_high_cents: estimate?.high ?? null,
      quoted_total_cents: quotedTotalCents,
      captured_cents: capturedCents,
      max_charge_cents: maxChargeCents,
      confidence: "high",
      source: "quote",
      explanation: "Provider or operator quote is available; final captured total may still differ below the spend limit.",
      spend_limit: spendLimit(maxChargeCents, estimate),
      pending_final_price: true,
    };
  }

  if (estimate) {
    return {
      state: "estimated",
      currency: params.currency,
      display_total_cents: estimate.total,
      estimated_total_cents: estimate.total,
      estimate_low_cents: estimate.low,
      estimate_high_cents: estimate.high,
      quoted_total_cents: null,
      captured_cents: capturedCents,
      max_charge_cents: maxChargeCents,
      confidence: estimate.confidence,
      source: estimate.source,
      explanation: estimate.explanation,
      spend_limit: spendLimit(maxChargeCents, estimate),
      pending_final_price: true,
    };
  }

  return {
    state: "spend_limit_only",
    currency: params.currency,
    display_total_cents: null,
    estimated_total_cents: null,
    estimate_low_cents: null,
    estimate_high_cents: null,
    quoted_total_cents: null,
    captured_cents: capturedCents,
    max_charge_cents: maxChargeCents,
    confidence: "none",
    source: "spend_limit",
    explanation:
      "OttoAuth cannot estimate this order from the submitted fields. The spend limit is the hard fulfillment boundary.",
    spend_limit: spendLimit(maxChargeCents, null),
    pending_final_price: true,
  };
}
