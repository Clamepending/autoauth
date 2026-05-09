import {
  resolveNonBrowserPriceQuote,
  type NonBrowserPriceQuote,
} from "@/lib/non-browser-price-quotes";
import { searchDigiKeyCatalog } from "@/lib/digikey-catalog";
import { searchMcMasterCatalog } from "@/lib/mcmaster-catalog";

export type SupportedOfferPlatform =
  | "amazon"
  | "digikey"
  | "mouser"
  | "mcmaster"
  | "ebay"
  | "jlcpcb"
  | "ottoauth";

export type SupportedOfferAvailabilityStatus =
  | "in_stock"
  | "limited"
  | "unknown"
  | "needs_revalidation";

export type SupportedOffer = {
  id: string;
  merchant: string;
  platform: SupportedOfferPlatform;
  title: string;
  description: string;
  url: string | null;
  image_url: string | null;
  price_cents: number | null;
  display_price: string | null;
  estimated_total_cents: number | null;
  display_total: string | null;
  availability: {
    status: SupportedOfferAvailabilityStatus;
    label: string;
    detail: string;
  };
  source: string;
  source_label: string;
  confidence: NonBrowserPriceQuote["confidence"] | "agent_assisted";
  retrieved_at: string;
  expires_at: string | null;
  ttl_seconds: number | null;
  fulfillment_mode: "direct_offer" | "quote_revalidated" | "browser_agent";
  tags: string[];
  quote: NonBrowserPriceQuote | Record<string, unknown> | null;
  order_payload: Record<string, unknown>;
};

export type SupportedOfferSearchInput = {
  query: string;
  platform?: SupportedOfferPlatform | "all" | null;
  merchantName?: string | null;
  quantity?: number | null;
  url?: string | null;
  location?: string | null;
  limit?: number | null;
};

export type SupportedOfferSearchResult = {
  query: string;
  normalized_query: string;
  offers: SupportedOffer[];
  searched_at: string;
  supported_sources: Array<{
    platform: SupportedOfferPlatform;
    label: string;
    status: "live" | "configured" | "fallback";
  }>;
  note: string;
};

function stringValue(value: unknown, maxLength = 500) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function positiveInteger(value: unknown) {
  const parsed = finiteNumber(value);
  if (parsed == null) return null;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : null;
}

function normalizePlatform(value: unknown): SupportedOfferPlatform | "all" | null {
  const raw = stringValue(value, 80)?.toLowerCase();
  if (!raw || raw === "all") return raw === "all" ? "all" : null;
  if (
    raw === "amazon" ||
    raw === "digikey" ||
    raw === "mouser" ||
    raw === "mcmaster" ||
    raw === "ebay" ||
    raw === "jlcpcb"
  ) {
    return raw;
  }
  if (raw === "digi-key" || raw === "digi key") return "digikey";
  if (raw === "mcmaster-carr" || raw === "mcmaster carr" || raw === "mcmaster_carr") {
    return "mcmaster";
  }
  if (raw === "jlc" || raw === "jlc pcb") return "jlcpcb";
  if (raw === "ottoauth" || raw === "agent" || raw === "manual") return "ottoauth";
  return null;
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

function firstUrlFromText(text: string) {
  const match = text.match(
    /\b((?:https?:\/\/|www\.)[^\s<>"']+|(?:amazon|ebay|mouser|digikey|mcmaster|jlcpcb)\.com\/[^\s<>"']+)/i,
  );
  return normalizeUrl(match?.[1]);
}

function platformFromUrl(url: string | null): SupportedOfferPlatform | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (host === "amazon.com" || host.endsWith(".amazon.com") || host === "a.co") {
      return "amazon";
    }
    if (host === "ebay.com" || host.endsWith(".ebay.com")) return "ebay";
    if (host === "digikey.com" || host.endsWith(".digikey.com")) return "digikey";
    if (host === "mouser.com" || host.endsWith(".mouser.com")) return "mouser";
    if (host === "mcmaster.com" || host.endsWith(".mcmaster.com")) return "mcmaster";
    if (host === "jlcpcb.com" || host.endsWith(".jlcpcb.com")) return "jlcpcb";
  } catch {
    return null;
  }
  return null;
}

function includesPlatform(platform: SupportedOfferPlatform | "all" | null, candidate: SupportedOfferPlatform) {
  return !platform || platform === "all" || platform === candidate;
}

function merchantForPlatform(platform: SupportedOfferPlatform) {
  if (platform === "jlcpcb") return "JLCPCB";
  if (platform === "digikey") return "DigiKey";
  if (platform === "mcmaster") return "McMaster-Carr";
  if (platform === "mouser") return "Mouser";
  if (platform === "ebay") return "eBay";
  if (platform === "amazon") return "Amazon";
  return "OttoAuth";
}

function stableOfferId(parts: Array<string | number | null | undefined>) {
  const text = parts.filter((part) => part != null && part !== "").join("|");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `offer_${(hash >>> 0).toString(36)}`;
}

function fmt(cents: number | null, currency = "usd") {
  if (cents == null) return null;
  return currency.toLowerCase() === "usd"
    ? `$${(cents / 100).toFixed(2)}`
    : `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

function ttlSeconds(expiresAt: string | null) {
  if (!expiresAt) return null;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return null;
  return Math.max(0, Math.round((expiry - Date.now()) / 1000));
}

function availabilityForQuote(quote: NonBrowserPriceQuote): SupportedOffer["availability"] {
  if (quote.status === "priced" || quote.status === "estimated") {
    return {
      status: "needs_revalidation",
      label: "Revalidated at checkout",
      detail:
        quote.missing_components.length > 0
          ? `Missing ${quote.missing_components.join(", ")} until checkout.`
          : "Price and availability are checked again before purchase.",
    };
  }
  return {
    status: "unknown",
    label: "Needs browser check",
    detail: quote.message,
  };
}

function quoteToOffer(params: {
  quote: NonBrowserPriceQuote;
  query: string;
  platform: SupportedOfferPlatform;
  merchant: string;
  fallbackTitle: string;
  description: string;
  url?: string | null;
  quantity: number;
  tags: string[];
}): SupportedOffer {
  const title = params.quote.product_title || params.fallbackTitle;
  const url = params.quote.product_url || params.url || null;
  const task = url
    ? `Order ${title} from ${params.merchant}. Use the selected supported offer URL.`
    : `Order ${title} from ${params.merchant}.`;
  return {
    id: stableOfferId([
      params.platform,
      params.merchant,
      title,
      url,
      params.quote.source,
      params.query,
    ]),
    merchant: params.merchant,
    platform: params.platform,
    title,
    description: params.description,
    url,
    image_url: null,
    price_cents: params.quote.goods_cents,
    display_price: fmt(params.quote.goods_cents, params.quote.currency),
    estimated_total_cents: params.quote.total_cents,
    display_total: params.quote.display_total,
    availability: availabilityForQuote(params.quote),
    source: params.quote.source,
    source_label: params.quote.source_label,
    confidence: params.quote.confidence,
    retrieved_at: params.quote.retrieved_at,
    expires_at: params.quote.expires_at,
    ttl_seconds: ttlSeconds(params.quote.expires_at),
    fulfillment_mode:
      params.quote.status === "unavailable" ? "browser_agent" : "quote_revalidated",
    tags: params.tags,
    quote: params.quote,
    order_payload: {
      task,
      task_title: title,
      merchant_name: params.merchant,
      platform_hint: params.platform,
      url,
      url_policy: url ? "preferred" : "discover",
      quantity: params.quantity,
      product: {
        title,
        url,
      },
      quote: params.quote,
      offer_id: stableOfferId([
        params.platform,
        params.merchant,
        title,
        url,
        params.quote.source,
        params.query,
      ]),
    },
  };
}

function fallbackOffer(params: {
  query: string;
  platform: SupportedOfferPlatform;
  merchant: string;
  title: string;
  description: string;
  source: string;
  sourceLabel: string;
  tags: string[];
  url?: string | null;
  quantity: number;
}): SupportedOffer {
  const now = new Date().toISOString();
  const url = params.url ?? null;
  return {
    id: stableOfferId([params.platform, params.source, params.title, params.query, url]),
    merchant: params.merchant,
    platform: params.platform,
    title: params.title,
    description: params.description,
    url,
    image_url: null,
    price_cents: null,
    display_price: null,
    estimated_total_cents: null,
    display_total: null,
    availability: {
      status: "unknown",
      label: "Agent-assisted",
      detail:
        "No live catalog source produced an offer. The browser agent can still search and confirm the final checkout total.",
    },
    source: params.source,
    source_label: params.sourceLabel,
    confidence: "agent_assisted",
    retrieved_at: now,
    expires_at: null,
    ttl_seconds: null,
    fulfillment_mode: "browser_agent",
    tags: params.tags,
    quote: null,
    order_payload: {
      task: params.query
        ? `Find and place an order for ${params.query}.`
        : `Find and place this order through ${params.merchant}.`,
      task_title: params.title,
      merchant_name: params.platform === "ottoauth" ? null : params.merchant,
      platform_hint: params.platform === "ottoauth" ? null : params.platform,
      url,
      url_policy: url ? "preferred" : "discover",
      quantity: params.quantity,
      offer_id: stableOfferId([
        params.platform,
        params.source,
        params.title,
        params.query,
        url,
      ]),
    },
  };
}

function amountCents(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const raw = record.value ?? record.convertedFromValue;
  const parsed = finiteNumber(raw);
  return parsed == null ? null : Math.max(0, Math.round(parsed * 100));
}

function ebayAccessToken() {
  return (
    process.env.OTTOAUTH_EBAY_ACCESS_TOKEN?.trim() ||
    process.env.EBAY_ACCESS_TOKEN?.trim() ||
    ""
  );
}

async function ebaySearchOffers(params: {
  query: string;
  quantity: number;
  limit: number;
}) {
  const token = ebayAccessToken();
  if (!token) return [];

  try {
    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("q", params.query);
    url.searchParams.set("limit", String(Math.min(Math.max(params.limit, 1), 10)));
    url.searchParams.set("fieldgroups", "EXTENDED");
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-ebay-c-marketplace-id": "EBAY_US",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return [];
    const data = (await response.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    const summaries = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
    const now = new Date().toISOString();
    return summaries
      .map((summary) => {
        if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
        const item = summary as Record<string, unknown>;
        const title = stringValue(item.title, 240);
        const itemUrl = normalizeUrl(item.itemWebUrl);
        const priceCents = amountCents(item.price ?? item.currentBidPrice);
        if (!title || !itemUrl) return null;
        const shippingOptions = Array.isArray(item.shippingOptions)
          ? item.shippingOptions
          : [];
        const firstShipping =
          shippingOptions[0] &&
          typeof shippingOptions[0] === "object" &&
          !Array.isArray(shippingOptions[0])
            ? (shippingOptions[0] as Record<string, unknown>)
            : null;
        const shippingCents = amountCents(firstShipping?.shippingCost);
        const totalCents =
          priceCents == null ? null : priceCents * params.quantity + (shippingCents ?? 0);
        const image =
          item.image &&
          typeof item.image === "object" &&
          !Array.isArray(item.image)
            ? normalizeUrl((item.image as Record<string, unknown>).imageUrl)
            : null;
        const availability: SupportedOffer["availability"] = {
          status: "needs_revalidation",
          label: "Listing found",
          detail:
            typeof item.itemEndDate === "string"
              ? `Listing active until ${item.itemEndDate}.`
              : "Listing price is revalidated before checkout.",
        };
        const quote: Record<string, unknown> = {
          source: "ebay_browse_search",
          source_label: "eBay Browse Search",
          confidence: "high",
          currency: "usd",
          goods_cents: priceCents == null ? null : priceCents * params.quantity,
          shipping_cents: shippingCents,
          total_cents: totalCents,
          product_title: title,
          url: itemUrl,
        };
        const offer: SupportedOffer = {
          id: stableOfferId(["ebay", stringValue(item.itemId, 120), title, itemUrl]),
          merchant: "eBay",
          platform: "ebay",
          title,
          description:
            stringValue(item.shortDescription, 280) ??
            "Live eBay marketplace listing returned by the Browse API.",
          url: itemUrl,
          image_url: image,
          price_cents: priceCents,
          display_price: fmt(priceCents),
          estimated_total_cents: totalCents,
          display_total: fmt(totalCents),
          availability,
          source: "ebay_browse_search",
          source_label: "eBay Browse Search",
          confidence: "high",
          retrieved_at: now,
          expires_at: null,
          ttl_seconds: null,
          fulfillment_mode: "quote_revalidated",
          tags: ["marketplace", "live search", "revalidated"],
          quote,
          order_payload: {
            task: `Order ${title} from eBay using the selected listing.`,
            task_title: title,
            merchant_name: "eBay",
            platform_hint: "ebay",
            url: itemUrl,
            url_policy: "preferred",
            quantity: params.quantity,
            product: {
              title,
              url: itemUrl,
            },
            quote,
          },
        };
        return offer;
      })
      .filter((offer): offer is SupportedOffer => offer != null);
  } catch {
    return [];
  }
}

function likelyMouserPartNumber(query: string) {
  const tokens = query
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return (
    tokens.find((token) => {
      if (token.length < 3 || token.length > 64) return false;
      if (!/[a-z]/i.test(token) || !/\d/.test(token)) return false;
      return /^[a-z0-9._+\-/]+$/i.test(token);
    }) ?? null
  );
}

function isJlcQuery(query: string) {
  const text = query.toLowerCase();
  return (
    text.includes("jlc") ||
    text.includes("pcb") ||
    text.includes("pcba") ||
    text.includes("gerber") ||
    text.includes("3d print") ||
    text.includes("stl")
  );
}

function sourceStatus(platform: SupportedOfferPlatform): SupportedOfferSearchResult["supported_sources"][number] {
  if (platform === "ebay") {
    return {
      platform,
      label: "eBay Browse API",
      status: ebayAccessToken() ? "live" : "fallback",
    };
  }
  if (platform === "mouser") {
    return {
      platform,
      label: "Mouser Search API",
      status:
        process.env.OTTOAUTH_MOUSER_SEARCH_API_KEY ||
        process.env.MOUSER_SEARCH_API_KEY ||
        process.env.MOUSER_API_KEY
          ? "configured"
          : "fallback",
    };
  }
  if (platform === "digikey") {
    return {
      platform,
      label: "DigiKey curated catalog",
      status: "configured",
    };
  }
  if (platform === "mcmaster") {
    return {
      platform,
      label: "McMaster-Carr curated catalog",
      status: "configured",
    };
  }
  if (platform === "jlcpcb") {
    return {
      platform,
      label: "JLCPCB local pricing model",
      status: process.env.OTTOAUTH_JLCPCB_PRICE_MODEL_JSON ? "configured" : "fallback",
    };
  }
  if (platform === "amazon") {
    return {
      platform,
      label: "Amazon direct product scrape",
      status: "configured",
    };
  }
  return {
    platform,
    label: "OttoAuth browser agent",
    status: "live",
  };
}

export function normalizeSupportedOfferSearchPayload(
  payload: Record<string, unknown>,
): SupportedOfferSearchInput {
  const query = stringValue(
    payload.query ??
      payload.search ??
      payload.search_prompt ??
      payload.searchPrompt ??
      payload.task ??
      payload.prompt,
    1000,
  );
  if (!query) {
    throw new Error("query is required.");
  }
  return {
    query,
    platform: normalizePlatform(payload.platform ?? payload.platform_hint ?? payload.store),
    merchantName: stringValue(payload.merchant_name ?? payload.merchantName ?? payload.store_name),
    quantity: positiveInteger(payload.quantity ?? payload.qty),
    url: normalizeUrl(payload.url ?? payload.product_url ?? payload.productUrl),
    location: stringValue(payload.location ?? payload.pickup_location ?? payload.pickupLocation),
    limit: positiveInteger(payload.limit),
  };
}

export async function searchSupportedOffers(
  input: SupportedOfferSearchInput,
): Promise<SupportedOfferSearchResult> {
  const query = input.query.replace(/\s+/g, " ").trim();
  const normalizedQuery = query.toLowerCase();
  const platform = input.platform ?? "all";
  const quantity = input.quantity && input.quantity > 0 ? Math.trunc(input.quantity) : 1;
  const limit = input.limit && input.limit > 0 ? Math.min(Math.trunc(input.limit), 12) : 8;
  const explicitUrl = input.url ?? firstUrlFromText(query);
  const explicitUrlPlatform =
    platformFromUrl(explicitUrl) ??
    (platform === "amazon" ||
    platform === "digikey" ||
    platform === "mouser" ||
    platform === "mcmaster" ||
    platform === "ebay" ||
    platform === "jlcpcb"
      ? platform
      : null);
  const offers: SupportedOffer[] = [];

  if (explicitUrl && explicitUrlPlatform && includesPlatform(platform, explicitUrlPlatform)) {
    const quote = await resolveNonBrowserPriceQuote({
      payload: {
        task: `Quote ${query}`,
        platform_hint: explicitUrlPlatform,
        url: explicitUrl,
        url_policy: "preferred",
        quantity,
      },
      rawTask: query,
      taskPrompt: query,
      websiteUrl: explicitUrl,
      merchantName: input.merchantName,
      platformHint: explicitUrlPlatform,
      requestJson: {
        task: query,
        platform_hint: explicitUrlPlatform,
        url: explicitUrl,
        url_policy: "preferred",
      },
    });
    offers.push(
      quoteToOffer({
        quote,
        query,
        platform: explicitUrlPlatform,
        merchant: merchantForPlatform(explicitUrlPlatform),
        fallbackTitle: query,
        description: "Direct supported product URL with order-time quote revalidation.",
        url: explicitUrl,
        quantity,
        tags: ["direct url", "quote checked", "revalidated"],
      }),
    );
  }

  if (includesPlatform(platform, "digikey") && query && offers.length < limit) {
    const items = searchDigiKeyCatalog(query, limit - offers.length);
    for (const item of items) {
      const quote = await resolveNonBrowserPriceQuote({
        payload: {
          task: `Order ${item.manufacturerPartNumber} from DigiKey.`,
          platform_hint: "digikey",
          merchant_name: "DigiKey",
          part_number: item.manufacturerPartNumber,
          manufacturer_part_number: item.manufacturerPartNumber,
          quantity,
        },
        rawTask: query,
        taskPrompt: query,
        websiteUrl: item.url,
        merchantName: "DigiKey",
        platformHint: "digikey",
        requestJson: {
          task: query,
          platform_hint: "digikey",
          part_number: item.manufacturerPartNumber,
        },
      });
      offers.push(
        quoteToOffer({
          quote,
          query,
          platform: "digikey",
          merchant: "DigiKey",
          fallbackTitle: item.title,
          description:
            "DigiKey catalog estimate from common prototype/electronics SKUs. Shipping, tax, and stock are rechecked at order time.",
          url: item.url,
          quantity,
          tags: ["electronics", "catalog estimate", "revalidated"],
        }),
      );
    }
    if (
      items.length === 0 &&
      (platform === "digikey" ||
        normalizedQuery.includes("digikey") ||
        normalizedQuery.includes("digi key") ||
        normalizedQuery.includes("digi-key"))
    ) {
      offers.push(
        fallbackOffer({
          query,
          platform: "digikey",
          merchant: "DigiKey",
          title: `Find DigiKey parts for "${query}"`,
          description:
            "DigiKey catalog estimates work best with a manufacturer part number or common prototype component name.",
          source: "digikey_catalog_no_match",
          sourceLabel: "DigiKey catalog lookup",
          tags: ["electronics", "needs part number"],
          quantity,
        }),
      );
    }
  }

  if (includesPlatform(platform, "mcmaster") && query && offers.length < limit) {
    const items = searchMcMasterCatalog(query, limit - offers.length);
    for (const item of items) {
      const quote = await resolveNonBrowserPriceQuote({
        payload: {
          task: `Order ${item.partNumber} from McMaster-Carr.`,
          platform_hint: "mcmaster",
          merchant_name: "McMaster-Carr",
          part_number: item.partNumber,
          quantity,
        },
        rawTask: query,
        taskPrompt: query,
        websiteUrl: item.url,
        merchantName: "McMaster-Carr",
        platformHint: "mcmaster",
        requestJson: {
          task: query,
          platform_hint: "mcmaster",
          part_number: item.partNumber,
        },
      });
      offers.push(
        quoteToOffer({
          quote,
          query,
          platform: "mcmaster",
          merchant: "McMaster-Carr",
          fallbackTitle: item.title,
          description:
            "McMaster-Carr catalog estimate from common fasteners and shop hardware. Shipping and tax are rechecked at order time.",
          url: item.url,
          quantity,
          tags: ["hardware", "catalog estimate", "revalidated"],
        }),
      );
    }
    if (
      items.length === 0 &&
      (platform === "mcmaster" ||
        normalizedQuery.includes("mcmaster") ||
        normalizedQuery.includes("mc master"))
    ) {
      offers.push(
        fallbackOffer({
          query,
          platform: "mcmaster",
          merchant: "McMaster-Carr",
          title: `Find McMaster-Carr hardware for "${query}"`,
          description:
            "McMaster estimates work best with exact McMaster part numbers or common metric fastener descriptions.",
          source: "mcmaster_catalog_no_match",
          sourceLabel: "McMaster-Carr catalog lookup",
          tags: ["hardware", "needs part number"],
          quantity,
        }),
      );
    }
  }

  if (includesPlatform(platform, "ebay") && query && offers.length < limit) {
    offers.push(...(await ebaySearchOffers({ query, quantity, limit: limit - offers.length })));
    if (!offers.some((offer) => offer.platform === "ebay")) {
      offers.push(
        fallbackOffer({
          query,
          platform: "ebay",
          merchant: "eBay",
          title: `Search eBay for "${query}"`,
          description:
            "Use the browser agent for marketplace discovery when the eBay API is not configured or returns no results.",
          source: "ebay_browser_fallback",
          sourceLabel: "eBay browser fallback",
          tags: ["marketplace", "agent-assisted"],
          quantity,
        }),
      );
    }
  }

  if (includesPlatform(platform, "mouser") && offers.length < limit) {
    const partNumber = likelyMouserPartNumber(query);
    if (partNumber) {
      const quote = await resolveNonBrowserPriceQuote({
        payload: {
          task: `Order ${partNumber} from Mouser.`,
          platform_hint: "mouser",
          merchant_name: "Mouser",
          part_number: partNumber,
          quantity,
        },
        rawTask: query,
        taskPrompt: query,
        merchantName: "Mouser",
        platformHint: "mouser",
        requestJson: {
          task: query,
          platform_hint: "mouser",
          part_number: partNumber,
        },
      });
      offers.push(
        quoteToOffer({
          quote,
          query,
          platform: "mouser",
          merchant: "Mouser",
          fallbackTitle: `Mouser part ${partNumber}`,
          description:
            "Mouser part-number lookup. Availability, shipping, and tax are rechecked at order time.",
          quantity,
          tags: ["parts", "part number", "revalidated"],
        }),
      );
    } else {
      offers.push(
        fallbackOffer({
          query,
          platform: "mouser",
          merchant: "Mouser",
          title: `Find Mouser parts for "${query}"`,
          description:
            "Mouser pricing is strongest with an exact manufacturer or Mouser part number.",
          source: "mouser_part_number_needed",
          sourceLabel: "Mouser part lookup",
          tags: ["parts", "needs part number"],
          quantity,
        }),
      );
    }
  }

  if (includesPlatform(platform, "jlcpcb") && isJlcQuery(query) && offers.length < limit) {
    const quote = await resolveNonBrowserPriceQuote({
      payload: {
        task: query,
        platform_hint: "jlcpcb",
        merchant_name: "JLCPCB",
        quantity,
      },
      rawTask: query,
      taskPrompt: query,
      merchantName: "JLCPCB",
      platformHint: "jlcpcb",
      requestJson: {
        task: query,
        platform_hint: "jlcpcb",
      },
    });
    offers.push(
      quoteToOffer({
        quote,
        query,
        platform: "jlcpcb",
        merchant: "JLCPCB",
        fallbackTitle: "JLCPCB manufacturing estimate",
        description:
          "Local JLC pricing model or quote fallback for PCB, PCBA, and print orders.",
        quantity,
        tags: ["manufacturing", "estimate", "revalidated"],
      }),
    );
  }

  if (includesPlatform(platform, "amazon") && !explicitUrl && offers.length < limit) {
    offers.push(
      fallbackOffer({
        query,
        platform: "amazon",
        merchant: "Amazon",
        title: `Find Amazon offers for "${query}"`,
        description:
          "Amazon supports direct product-page price scraping. Search discovery stays browser-assisted unless a product URL is supplied.",
        source: "amazon_direct_url_needed",
        sourceLabel: "Amazon direct URL preferred",
        tags: ["retail", "agent-assisted", "direct URL best"],
        quantity,
      }),
    );
  }

  if (includesPlatform(platform, "ottoauth") && offers.length < limit) {
    offers.push(
      fallbackOffer({
        query,
        platform: "ottoauth",
        merchant: "OttoAuth",
        title: `Let OttoAuth browse for "${query}"`,
        description:
          "Use free-form browser fulfillment when catalog search is weak, local, account-specific, or time-sensitive.",
        source: "ottoauth_browser_agent",
        sourceLabel: "OttoAuth browser agent",
        tags: ["fallback", "human-assisted", "reconciled after checkout"],
        quantity,
      }),
    );
  }

  if (offers.length === 0) {
    offers.push(
      fallbackOffer({
        query,
        platform: "ottoauth",
        merchant: "OttoAuth",
        title: `Let OttoAuth browse for "${query}"`,
        description:
          "No supported catalog source matched the filter. The browser agent can still run this as a free-form order.",
        source: "ottoauth_browser_agent",
        sourceLabel: "OttoAuth browser agent",
        tags: ["fallback", "free-form"],
        quantity,
      }),
    );
  }

  const deduped = new Map<string, SupportedOffer>();
  for (const offer of offers) {
    if (!deduped.has(offer.id)) deduped.set(offer.id, offer);
  }

  return {
    query,
    normalized_query: normalizedQuery,
    offers: Array.from(deduped.values()).slice(0, limit),
    searched_at: new Date().toISOString(),
    supported_sources: [
      sourceStatus("amazon"),
      sourceStatus("digikey"),
      sourceStatus("mouser"),
      sourceStatus("mcmaster"),
      sourceStatus("ebay"),
      sourceStatus("jlcpcb"),
      sourceStatus("ottoauth"),
    ],
    note:
      "Search returns supported offers where OttoAuth has a reliable source, then falls back to browser-agent fulfillment. Quotes are revalidated at order time.",
  };
}
