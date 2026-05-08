import { scrapeAmazonPrice } from "@/services/amazon/scraper";

export type NonBrowserPriceQuoteStatus = "priced" | "estimated" | "unavailable";

export type NonBrowserPriceQuoteConfidence =
  | "exact"
  | "high"
  | "medium"
  | "low"
  | "unavailable";

export type NonBrowserPriceQuoteBillingMode =
  | "known_before_fulfillment"
  | "estimated_then_reconciled"
  | "retroactive_after_fulfillment";

export type NonBrowserPriceQuote = {
  status: NonBrowserPriceQuoteStatus;
  source: string;
  source_label: string;
  confidence: NonBrowserPriceQuoteConfidence;
  billing_mode: NonBrowserPriceQuoteBillingMode;
  billed_retroactively: boolean;
  currency: string;
  goods_cents: number | null;
  shipping_cents: number | null;
  tax_cents: number | null;
  other_cents: number | null;
  total_cents: number | null;
  display_total: string | null;
  product_title: string | null;
  product_url: string | null;
  line_items: Array<{
    label: string;
    amount_cents: number;
    quantity?: number | null;
    unit_cents?: number | null;
  }>;
  included_components: string[];
  missing_components: string[];
  message: string;
  retrieved_at: string;
  expires_at: string | null;
};

export type NonBrowserPriceQuoteInput = {
  payload: Record<string, unknown>;
  rawTask?: string | null;
  taskPrompt?: string | null;
  websiteUrl?: string | null;
  merchantName?: string | null;
  platformHint?: string | null;
  requestJson?: Record<string, unknown> | null;
};

const AMAZON_PRICE_SOURCE = "amazon_product_page_scrape";

function fmt(cents: number | null, currency = "usd") {
  if (cents == null) return null;
  if (currency.toLowerCase() !== "usd") {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
  return `$${(cents / 100).toFixed(2)}`;
}

function normalizeCurrency(value: unknown) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z]{3}$/.test(raw) ? raw : "usd";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown, maxLength = 500) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function firstString(values: unknown[], maxLength = 500) {
  for (const value of values) {
    const extracted = stringValue(value, maxLength);
    if (extracted) return extracted;
  }
  return null;
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.replace(/[$,\s]/g, "");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function centsFromCentsField(value: unknown) {
  const parsed = finiteNumber(value);
  if (parsed == null) return null;
  return Math.max(0, Math.round(parsed));
}

function centsFromUsdField(value: unknown) {
  const parsed = finiteNumber(value);
  if (parsed == null) return null;
  return Math.max(0, Math.round(parsed * 100));
}

function firstCents(recordValue: Record<string, unknown> | null, keys: string[]) {
  if (!recordValue) return null;
  for (const key of keys) {
    const cents = centsFromCentsField(recordValue[key]);
    if (cents != null) return cents;
  }
  return null;
}

function firstUsd(recordValue: Record<string, unknown> | null, keys: string[]) {
  if (!recordValue) return null;
  for (const key of keys) {
    const cents = centsFromUsdField(recordValue[key]);
    if (cents != null) return cents;
  }
  return null;
}

function positiveInteger(value: unknown) {
  const parsed = finiteNumber(value);
  if (parsed == null) return null;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : null;
}

function nestedRecord(input: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const nested = record(input[key]);
    if (nested) return nested;
  }
  return null;
}

function productRecord(input: Record<string, unknown>) {
  return nestedRecord(input, "product", "item", "part", "component");
}

function merchantRecord(input: Record<string, unknown>) {
  return nestedRecord(input, "merchant", "supplier", "vendor");
}

function normalizeUrl(value: unknown) {
  const raw = stringValue(value, 2000);
  if (!raw) return null;
  const candidate = /^[a-z][a-z\d+\-.]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function quoteBase(args: {
  status: NonBrowserPriceQuoteStatus;
  source: string;
  sourceLabel: string;
  confidence: NonBrowserPriceQuoteConfidence;
  billingMode: NonBrowserPriceQuoteBillingMode;
  billedRetroactively: boolean;
  currency?: string | null;
  goodsCents?: number | null;
  shippingCents?: number | null;
  taxCents?: number | null;
  otherCents?: number | null;
  totalCents?: number | null;
  productTitle?: string | null;
  productUrl?: string | null;
  lineItems?: NonBrowserPriceQuote["line_items"];
  includedComponents?: string[];
  missingComponents?: string[];
  message: string;
  expiresAt?: string | null;
}): NonBrowserPriceQuote {
  const currency = normalizeCurrency(args.currency);
  const totalCents =
    args.totalCents ??
    (args.goodsCents == null &&
    args.shippingCents == null &&
    args.taxCents == null &&
    args.otherCents == null
      ? null
      : (args.goodsCents ?? 0) +
        (args.shippingCents ?? 0) +
        (args.taxCents ?? 0) +
        (args.otherCents ?? 0));

  return {
    status: args.status,
    source: args.source,
    source_label: args.sourceLabel,
    confidence: args.confidence,
    billing_mode: args.billingMode,
    billed_retroactively: args.billedRetroactively,
    currency,
    goods_cents: args.goodsCents ?? null,
    shipping_cents: args.shippingCents ?? null,
    tax_cents: args.taxCents ?? null,
    other_cents: args.otherCents ?? null,
    total_cents: totalCents,
    display_total: fmt(totalCents, currency),
    product_title: args.productTitle ?? null,
    product_url: args.productUrl ?? null,
    line_items: args.lineItems ?? [],
    included_components: args.includedComponents ?? [],
    missing_components: args.missingComponents ?? [],
    message: args.message,
    retrieved_at: new Date().toISOString(),
    expires_at: args.expiresAt ?? null,
  };
}

function unavailable(source = "no_non_browser_price_source", message?: string) {
  return quoteBase({
    status: "unavailable",
    source,
    sourceLabel: "No non-browser price source",
    confidence: "unavailable",
    billingMode: "retroactive_after_fulfillment",
    billedRetroactively: true,
    message:
      message ??
      "No API, scrape, or manual pricing model produced a price. The task can still run under the spend cap and bill the observed final charges after completion.",
    missingComponents: ["goods", "shipping", "tax", "fees"],
  });
}

function directOrNestedRecords(input: Record<string, unknown>) {
  return [
    input,
    nestedRecord(input, "quote", "price_quote", "estimated_quote", "manual_quote", "pricing"),
    productRecord(input),
  ].filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function quantityFromInput(input: Record<string, unknown>) {
  const product = productRecord(input);
  return (
    positiveInteger(input.quantity) ??
    positiveInteger(input.qty) ??
    positiveInteger(product?.quantity) ??
    positiveInteger(product?.qty) ??
    1
  );
}

function manualQuote(input: NonBrowserPriceQuoteInput) {
  const payload = input.payload;
  const records = directOrNestedRecords(payload);
  const quantity = quantityFromInput(payload);
  const product = productRecord(payload);

  for (const candidate of records) {
    const currency = normalizeCurrency(candidate.currency ?? payload.currency);
    const unitCents =
      firstCents(candidate, ["unit_price_cents", "unitPriceCents"]) ??
      firstUsd(candidate, ["unit_price", "unitPrice", "unit_price_usd"]);
    const goodsCents =
      firstCents(candidate, [
        "goods_cents",
        "item_cents",
        "price_cents",
        "estimated_price_cents",
        "subtotal_cents",
      ]) ??
      firstUsd(candidate, [
        "goods",
        "item_price",
        "price",
        "estimated_price",
        "subtotal",
        "price_usd",
      ]) ??
      (unitCents != null ? unitCents * quantity : null);
    const shippingCents =
      firstCents(candidate, ["shipping_cents", "ship_cents"]) ??
      firstUsd(candidate, ["shipping", "shipping_usd", "ship"]);
    const taxCents =
      firstCents(candidate, ["tax_cents", "estimated_tax_cents"]) ??
      firstUsd(candidate, ["tax", "estimated_tax", "tax_usd"]);
    const otherCents =
      firstCents(candidate, ["other_cents", "fees_cents", "fee_cents"]) ??
      firstUsd(candidate, ["other", "fees", "fee", "other_usd"]);
    const totalCents =
      firstCents(candidate, [
        "total_cents",
        "estimated_total_cents",
        "quote_total_cents",
        "manual_price_cents",
      ]) ??
      firstUsd(candidate, [
        "total",
        "estimated_total",
        "quote_total",
        "manual_price",
        "total_usd",
      ]);

    const computedTotal =
      totalCents ??
      (goodsCents == null &&
      shippingCents == null &&
      taxCents == null &&
      otherCents == null
        ? null
        : (goodsCents ?? 0) + (shippingCents ?? 0) + (taxCents ?? 0) + (otherCents ?? 0));
    if (computedTotal == null || computedTotal <= 0) continue;

    const label =
      firstString([
        candidate.source_label,
        candidate.label,
        candidate.name,
        product?.name,
        input.merchantName,
        input.platformHint,
      ]) ?? "Manual price";
    const rawConfidence = firstString([candidate.confidence]);
    const confidence: NonBrowserPriceQuoteConfidence =
      rawConfidence === "exact" ||
      rawConfidence === "high" ||
      rawConfidence === "medium" ||
      rawConfidence === "low"
        ? rawConfidence
        : "medium";
    const manualSource =
      firstString([candidate.source]) ??
      (candidate === payload ? "explicit_price_fields" : "manual_price_quote");

    return quoteBase({
      status: confidence === "exact" ? "priced" : "estimated",
      source: manualSource,
      sourceLabel: label,
      confidence,
      billingMode:
        confidence === "exact"
          ? "known_before_fulfillment"
          : "estimated_then_reconciled",
      billedRetroactively: confidence !== "exact",
      currency,
      goodsCents: goodsCents ?? computedTotal,
      shippingCents,
      taxCents,
      otherCents,
      totalCents: computedTotal,
      productTitle: firstString([candidate.product_title, candidate.title, product?.name]),
      productUrl: normalizeUrl(candidate.url ?? product?.url ?? input.websiteUrl),
      lineItems:
        unitCents != null
          ? [{ label, amount_cents: unitCents * quantity, unit_cents: unitCents, quantity }]
          : [{ label, amount_cents: computedTotal, quantity: null }],
      includedComponents: ["goods", "manual_quote"],
      missingComponents: ["final_checkout_total"],
      message:
        "Used price fields supplied by the caller or operator. Fulfillment still verifies the final checkout total before purchase.",
      expiresAt: stringValue(candidate.expires_at) ?? null,
    });
  }
  return null;
}

function contextText(input: NonBrowserPriceQuoteInput) {
  return [
    input.rawTask,
    input.taskPrompt,
    input.websiteUrl,
    input.merchantName,
    input.platformHint,
    input.requestJson ? JSON.stringify(input.requestJson) : null,
    input.payload ? JSON.stringify(input.payload) : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isAmazonHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  return normalized === "amazon.com" || normalized.endsWith(".amazon.com") || normalized === "a.co";
}

function shouldTryAmazonScrape(url: string | null) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    return (
      isAmazonHost(hostname) ||
      process.env.OTTOAUTH_ALLOW_NON_AMAZON_PRICE_SCRAPE === "1" ||
      (process.env.NODE_ENV !== "production" && isLocalhost(hostname))
    );
  } catch {
    return false;
  }
}

async function amazonQuote(input: NonBrowserPriceQuoteInput) {
  const url = normalizeUrl(input.websiteUrl);
  if (!shouldTryAmazonScrape(url)) return null;
  if (!url) return null;

  const scraped = await scrapeAmazonPrice(url);
  if (!scraped) {
    return unavailable(
      AMAZON_PRICE_SOURCE,
      "Amazon product-page scraping did not find a price. The order can be handled with retroactive billing or manual price input.",
    );
  }

  return quoteBase({
    status: "estimated",
    source: AMAZON_PRICE_SOURCE,
    sourceLabel: "Amazon product page scrape",
    confidence: "high",
    billingMode: "estimated_then_reconciled",
    billedRetroactively: true,
    currency: "usd",
    goodsCents: scraped.priceCents,
    totalCents: scraped.priceCents,
    productTitle: scraped.productTitle,
    productUrl: url,
    lineItems: [
      {
        label: scraped.productTitle || "Amazon item price",
        amount_cents: scraped.priceCents,
      },
    ],
    includedComponents: ["item_price"],
    missingComponents: ["tax", "shipping", "final_checkout_total"],
    message:
      "Scraped the direct Amazon product page without browser automation. This is the item price, not a guaranteed final checkout total.",
  });
}

function mouserApiKey() {
  return (
    process.env.OTTOAUTH_MOUSER_SEARCH_API_KEY?.trim() ||
    process.env.MOUSER_SEARCH_API_KEY?.trim() ||
    process.env.MOUSER_API_KEY?.trim() ||
    ""
  );
}

function explicitPartNumber(input: NonBrowserPriceQuoteInput) {
  const payload = input.payload;
  const product = productRecord(payload);
  const merchant = merchantRecord(payload);
  return firstString([
    payload.mouser_part_number,
    payload.mouserPartNumber,
    payload.part_number,
    payload.partNumber,
    payload.manufacturer_part_number,
    payload.manufacturerPartNumber,
    payload.mpn,
    product?.mouser_part_number,
    product?.part_number,
    product?.manufacturer_part_number,
    product?.mpn,
    merchant?.part_number,
  ]);
}

function isMouserContext(input: NonBrowserPriceQuoteInput) {
  const text = contextText(input);
  return text.includes("mouser") || text.includes("mouser.com");
}

function parseMouserPrice(value: unknown) {
  if (typeof value === "number") return centsFromUsdField(value);
  if (typeof value === "string") return centsFromUsdField(value);
  return null;
}

async function mouserQuote(input: NonBrowserPriceQuoteInput) {
  if (!isMouserContext(input)) return null;
  const apiKey = mouserApiKey();
  const partNumber = explicitPartNumber(input);
  if (!apiKey || !partNumber) {
    return unavailable(
      "mouser_search_api_unavailable",
      !apiKey
        ? "Mouser pricing requires OTTOAUTH_MOUSER_SEARCH_API_KEY or MOUSER_SEARCH_API_KEY."
        : "Mouser pricing requires an explicit part_number or manufacturer_part_number.",
    );
  }

  try {
    const response = await fetch(
      `https://api.mouser.com/api/v1/search/partnumber?apiKey=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          SearchByPartRequest: {
            mouserPartNumber: partNumber,
            partSearchOptions: "string",
          },
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok) {
      return unavailable(
        "mouser_search_api_error",
        `Mouser Search API returned HTTP ${response.status}.`,
      );
    }
    const data = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    const searchResults = record(data?.SearchResults);
    const parts = Array.isArray(searchResults?.Parts) ? searchResults.Parts : [];
    const part = record(parts[0]);
    if (!part) {
      return unavailable(
        "mouser_search_api_no_match",
        `Mouser Search API did not return a match for ${partNumber}.`,
      );
    }

    const quantity = quantityFromInput(input.payload);
    const breaks = Array.isArray(part.PriceBreaks) ? part.PriceBreaks : [];
    const priceBreaks = breaks
      .map((entry) => {
        const item = record(entry);
        if (!item) return null;
        const breakQuantity = positiveInteger(item.Quantity) ?? 1;
        const unitCents = parseMouserPrice(item.Price);
        return unitCents == null ? null : { quantity: breakQuantity, unitCents };
      })
      .filter((entry): entry is { quantity: number; unitCents: number } => entry != null)
      .sort((a, b) => b.quantity - a.quantity);
    const selectedBreak =
      priceBreaks.find((entry) => quantity >= entry.quantity) ??
      priceBreaks[priceBreaks.length - 1];
    if (!selectedBreak) {
      return unavailable(
        "mouser_search_api_no_price",
        `Mouser returned ${partNumber}, but no price break was available.`,
      );
    }

    const goodsCents = selectedBreak.unitCents * quantity;
    const title = firstString([
      part.ManufacturerPartNumber,
      part.MouserPartNumber,
      part.Description,
      part.PartDescription,
    ]);
    return quoteBase({
      status: "priced",
      source: "mouser_search_api",
      sourceLabel: "Mouser Search API",
      confidence: "high",
      billingMode: "estimated_then_reconciled",
      billedRetroactively: true,
      currency: "usd",
      goodsCents,
      totalCents: goodsCents,
      productTitle: title,
      productUrl: normalizeUrl(part.ProductDetailUrl),
      lineItems: [
        {
          label: title || partNumber,
          amount_cents: goodsCents,
          quantity,
          unit_cents: selectedBreak.unitCents,
        },
      ],
      includedComponents: ["item_price", "availability"],
      missingComponents: ["tax", "shipping", "final_checkout_total"],
      message:
        "Mouser returned product pricing and availability. Shipping, tax, and final checkout total are reconciled after fulfillment.",
    });
  } catch (error) {
    return unavailable(
      "mouser_search_api_error",
      error instanceof Error ? error.message : "Mouser Search API request failed.",
    );
  }
}

function ebayAccessToken() {
  return (
    process.env.OTTOAUTH_EBAY_ACCESS_TOKEN?.trim() ||
    process.env.EBAY_ACCESS_TOKEN?.trim() ||
    ""
  );
}

function isEbayContext(input: NonBrowserPriceQuoteInput) {
  const text = contextText(input);
  return text.includes("ebay") || text.includes("ebay.com");
}

function ebayLegacyItemId(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const pathMatch = parsed.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/i);
    if (pathMatch?.[1]) return pathMatch[1];
    return parsed.searchParams.get("item") || parsed.searchParams.get("hash") || null;
  } catch {
    return null;
  }
}

function amountValueCents(value: unknown) {
  const amount = record(value);
  const raw = amount?.value ?? amount?.convertedFromValue;
  return centsFromUsdField(raw);
}

async function ebayQuote(input: NonBrowserPriceQuoteInput) {
  if (!isEbayContext(input)) return null;
  const token = ebayAccessToken();
  const url = normalizeUrl(input.websiteUrl);
  const itemId =
    firstString([input.payload.ebay_item_id, input.payload.ebayItemId]) ??
    ebayLegacyItemId(url);
  if (!token || !itemId) {
    return unavailable(
      "ebay_browse_api_unavailable",
      !token
        ? "eBay pricing requires OTTOAUTH_EBAY_ACCESS_TOKEN or EBAY_ACCESS_TOKEN."
        : "eBay pricing requires an item URL or ebay_item_id.",
    );
  }

  try {
    const response = await fetch(
      `https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(itemId)}&fieldgroups=COMPACT`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          "x-ebay-c-marketplace-id": "EBAY_US",
        },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok) {
      return unavailable(
        "ebay_browse_api_error",
        `eBay Browse API returned HTTP ${response.status}.`,
      );
    }
    const data = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    const priceCents = amountValueCents(data?.price ?? data?.currentBidPrice);
    if (priceCents == null || priceCents <= 0) {
      return unavailable(
        "ebay_browse_api_no_price",
        "eBay Browse API did not return a usable item price.",
      );
    }
    const shippingOptions = Array.isArray(data?.shippingOptions)
      ? data.shippingOptions
      : [];
    const shippingCents =
      amountValueCents(record(shippingOptions[0])?.shippingCost) ?? null;
    const totalCents = priceCents + (shippingCents ?? 0);
    return quoteBase({
      status: "estimated",
      source: "ebay_browse_api",
      sourceLabel: "eBay Browse API",
      confidence: "high",
      billingMode: "estimated_then_reconciled",
      billedRetroactively: true,
      currency: normalizeCurrency(record(data?.price)?.currency),
      goodsCents: priceCents,
      shippingCents,
      totalCents,
      productTitle: firstString([data?.title]),
      productUrl: normalizeUrl(data?.itemWebUrl ?? url),
      lineItems: [{ label: firstString([data?.title]) ?? "eBay item", amount_cents: priceCents }],
      includedComponents: shippingCents != null ? ["item_price", "shipping"] : ["item_price"],
      missingComponents:
        shippingCents != null
          ? ["tax", "final_checkout_total"]
          : ["shipping", "tax", "final_checkout_total"],
      message:
        "eBay returned listing pricing. Taxes and any checkout-specific fees are reconciled after fulfillment.",
    });
  } catch (error) {
    return unavailable(
      "ebay_browse_api_error",
      error instanceof Error ? error.message : "eBay Browse API request failed.",
    );
  }
}

function isJlcContext(input: NonBrowserPriceQuoteInput) {
  const text = contextText(input);
  return text.includes("jlcpcb") || text.includes("jlc pcb") || text.includes("jlcpcb.com");
}

function detectJlcService(input: NonBrowserPriceQuoteInput) {
  const text = contextText(input);
  if (
    text.includes("3d print") ||
    text.includes("stl") ||
    text.includes("3mf") ||
    text.includes("tdp") ||
    text.includes("sla") ||
    text.includes("sls") ||
    text.includes("fdm")
  ) {
    return "three_d_printing";
  }
  if (text.includes("pcba") || text.includes("assembly") || text.includes("bom")) {
    return "pcba";
  }
  return "pcb";
}

function jlcPricingModel() {
  const raw = process.env.OTTOAUTH_JLCPCB_PRICE_MODEL_JSON?.trim();
  if (!raw) return null;
  try {
    return record(JSON.parse(raw));
  } catch {
    return null;
  }
}

function centsConfig(config: Record<string, unknown> | null, key: string) {
  return centsFromCentsField(config?.[key]) ?? 0;
}

function numberConfig(config: Record<string, unknown> | null, key: string) {
  return finiteNumber(config?.[key]) ?? 0;
}

function payloadNumber(input: NonBrowserPriceQuoteInput, keys: string[]) {
  const product = productRecord(input.payload);
  for (const key of keys) {
    const value = finiteNumber(input.payload[key] ?? product?.[key]);
    if (value != null) return value;
  }
  return null;
}

function jlcManualModelQuote(input: NonBrowserPriceQuoteInput) {
  if (!isJlcContext(input)) return null;
  const model = jlcPricingModel();
  if (!model) {
    return unavailable(
      "jlcpcb_manual_model_missing",
      "JLCPCB API access is unavailable. Provide manual quote fields or configure OTTOAUTH_JLCPCB_PRICE_MODEL_JSON to estimate JLC prices without browser use.",
    );
  }

  const service = detectJlcService(input);
  const serviceConfig = record(model[service]) ?? record(model.default);
  if (!serviceConfig) {
    return unavailable(
      "jlcpcb_manual_model_missing_service",
      `The JLC pricing model does not include a ${service} or default section.`,
    );
  }

  const quantity = quantityFromInput(input.payload);
  const layers = payloadNumber(input, ["layers", "layer_count", "layerCount"]) ?? 2;
  const areaCm2 = payloadNumber(input, ["board_area_cm2", "area_cm2", "areaCm2"]) ?? 0;
  const volumeCm3 = payloadNumber(input, ["volume_cm3", "volumeCm3"]) ?? 0;
  const componentCount =
    payloadNumber(input, ["component_count", "componentCount", "bom_line_count"]) ?? 0;

  const base =
    centsConfig(serviceConfig, "base_cents") +
    centsConfig(serviceConfig, "setup_cents") +
    centsConfig(serviceConfig, "per_board_cents") * quantity +
    Math.round(centsConfig(serviceConfig, "per_cm2_cents") * areaCm2 * quantity) +
    Math.round(centsConfig(serviceConfig, "per_cm3_cents") * volumeCm3 * quantity) +
    Math.round(centsConfig(serviceConfig, "per_layer_cents") * Math.max(0, layers - 2)) +
    Math.round(centsConfig(serviceConfig, "per_component_cents") * componentCount);
  const multiplier = numberConfig(serviceConfig, "multiplier") || 1;
  const goodsCents = Math.max(0, Math.round(base * multiplier));
  const shippingCents = centsConfig(serviceConfig, "shipping_cents");
  const totalCents = goodsCents + shippingCents;

  if (totalCents <= 0) {
    return unavailable(
      "jlcpcb_manual_model_incomplete",
      "The configured JLC pricing model did not produce a positive estimate. Add base_cents, setup_cents, per_board_cents, per_cm2_cents, per_cm3_cents, or shipping_cents.",
    );
  }

  return quoteBase({
    status: "estimated",
    source: "jlcpcb_manual_pricing_model",
    sourceLabel: "JLCPCB manual pricing model",
    confidence: "low",
    billingMode: "estimated_then_reconciled",
    billedRetroactively: true,
    currency: "usd",
    goodsCents,
    shippingCents: shippingCents || null,
    totalCents,
    productTitle: `JLCPCB ${service.replace(/_/g, " ")}`,
    lineItems: [
      {
        label: `JLCPCB ${service.replace(/_/g, " ")} estimate`,
        amount_cents: goodsCents,
        quantity,
      },
    ],
    includedComponents: shippingCents > 0 ? ["goods_estimate", "shipping_estimate"] : ["goods_estimate"],
    missingComponents: ["tax", "final_checkout_total", "vendor_api_quote"],
    message:
      "Estimated from the locally configured JLC pricing model because JLC API access is unavailable.",
  });
}

export async function resolveNonBrowserPriceQuote(
  input: NonBrowserPriceQuoteInput,
): Promise<NonBrowserPriceQuote> {
  const manual = manualQuote(input);
  if (manual) return manual;

  const amazon = await amazonQuote(input);
  if (amazon) return amazon;

  const mouser = await mouserQuote(input);
  if (mouser) return mouser;

  const ebay = await ebayQuote(input);
  if (ebay) return ebay;

  const jlc = jlcManualModelQuote(input);
  if (jlc) return jlc;

  return unavailable();
}
