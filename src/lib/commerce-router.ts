import {
  inferCommerceCategory,
  normalizeCommerceSlug,
  type InferredCommerceCategory,
} from "@/lib/commerce-mandates";

export type CommerceFulfillmentRail =
  | "acp"
  | "zinc"
  | "native_adapter"
  | "ottoauth_internal";

export type CommerceAdapterStatus = "active" | "planned";

export type CommerceRoutePlan = {
  preferredRail: CommerceFulfillmentRail;
  executionRail: "ottoauth_internal";
  adapterId: string;
  adapterStatus: CommerceAdapterStatus;
  merchantKey: string | null;
  category: InferredCommerceCategory;
  confidence: number;
  reasons: string[];
  userFulfillmentExposed: false;
  note: string;
};

type CommerceRouteInput = {
  rawTask: string;
  taskPrompt?: string | null;
  websiteUrl?: string | null;
  merchantName?: string | null;
  platformHint?: string | null;
  fulfillment?: string | null;
  requestJson?: Record<string, unknown> | null;
};

type CommerceAdapterHint = {
  merchantKey: string;
  adapterId: string;
  rail: CommerceFulfillmentRail;
  status: CommerceAdapterStatus;
  aliases: string[];
  domains: string[];
};

type ScoredCommerceAdapter = {
  adapter: CommerceAdapterHint;
  score: number;
  reasons: string[];
};

const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const ZINC_RETAIL_ADAPTERS: CommerceAdapterHint[] = [
  {
    merchantKey: "amazon",
    adapterId: "zinc.amazon",
    rail: "zinc",
    status: "planned",
    aliases: ["amazon", "amazon.com", "amazon prime"],
    domains: ["amazon.com"],
  },
  {
    merchantKey: "walmart",
    adapterId: "zinc.walmart",
    rail: "zinc",
    status: "planned",
    aliases: ["walmart", "wal mart"],
    domains: ["walmart.com"],
  },
  {
    merchantKey: "target",
    adapterId: "zinc.target",
    rail: "zinc",
    status: "planned",
    aliases: ["target"],
    domains: ["target.com"],
  },
  {
    merchantKey: "bestbuy",
    adapterId: "zinc.bestbuy",
    rail: "zinc",
    status: "planned",
    aliases: ["best buy", "bestbuy"],
    domains: ["bestbuy.com"],
  },
];

const ACP_ADAPTERS: CommerceAdapterHint[] = [
  {
    merchantKey: "acp",
    adapterId: "acp.checkout",
    rail: "acp",
    status: "planned",
    aliases: ["acp", "agentic commerce protocol", "shopify", "stripe shared payment token"],
    domains: ["myshopify.com"],
  },
];

const OTTOAUTH_INTERNAL_ADAPTERS: CommerceAdapterHint[] = [
  {
    merchantKey: "snackpass",
    adapterId: "ottoauth.browser.snackpass",
    rail: "ottoauth_internal",
    status: "active",
    aliases: ["snackpass", "snack pass"],
    domains: ["snackpass.co", "order.snackpass.co"],
  },
  {
    merchantKey: "digikey",
    adapterId: "ottoauth.browser.digikey",
    rail: "ottoauth_internal",
    status: "active",
    aliases: ["digikey", "digi key"],
    domains: ["digikey.com"],
  },
  {
    merchantKey: "mcmaster",
    adapterId: "ottoauth.browser.mcmaster",
    rail: "ottoauth_internal",
    status: "active",
    aliases: ["mcmaster", "mcmaster carr", "mcmaster-carr"],
    domains: ["mcmaster.com"],
  },
  {
    merchantKey: "mouser",
    adapterId: "ottoauth.browser.mouser",
    rail: "ottoauth_internal",
    status: "active",
    aliases: ["mouser"],
    domains: ["mouser.com"],
  },
];

function hostnameFromUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const candidate = URL_SCHEME_PATTERN.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hostMatchesDomain(hostname: string | null, domain: string) {
  if (!hostname) return false;
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
  return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
}

function stringField(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function routeText(input: CommerceRouteInput) {
  return normalizeCommerceSlug(
    [
      input.rawTask,
      input.taskPrompt,
      input.merchantName,
      input.platformHint,
      input.fulfillment,
      stringField(input.requestJson, "merchant_name", "platform_hint", "task"),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function aliasMatches(text: string, alias: string) {
  const slug = normalizeCommerceSlug(alias);
  if (!text || !slug) return false;
  return ` ${text} `.includes(` ${slug} `);
}

function scoreAdapter(
  adapter: CommerceAdapterHint,
  input: CommerceRouteInput,
): ScoredCommerceAdapter | null {
  const text = routeText(input);
  const hostname =
    hostnameFromUrl(input.websiteUrl) ||
    hostnameFromUrl(stringField(input.requestJson, "url", "website_url", "websiteUrl"));
  const reasons: string[] = [];
  let score = 0;

  const matchedDomain = adapter.domains.find((domain) => hostMatchesDomain(hostname, domain));
  if (matchedDomain) {
    score += 100;
    reasons.push(`matched domain ${matchedDomain}`);
  }

  const matchedAlias = adapter.aliases.find((alias) => aliasMatches(text, alias));
  if (matchedAlias) {
    score += 70;
    reasons.push(`matched merchant hint ${matchedAlias}`);
  }

  return score > 0 ? { adapter, score, reasons } : null;
}

function bestAdapter(input: CommerceRouteInput) {
  const candidates = [
    ...ACP_ADAPTERS,
    ...ZINC_RETAIL_ADAPTERS,
    ...OTTOAUTH_INTERNAL_ADAPTERS,
  ]
    .map((adapter) => scoreAdapter(adapter, input))
    .filter((candidate): candidate is ScoredCommerceAdapter => Boolean(candidate))
    .sort((a, b) => b.score - a.score);

  return candidates[0] ?? null;
}

function adapterNote(adapter: CommerceAdapterHint | null) {
  if (!adapter) {
    return "No specialized commerce adapter matched, so OttoAuth will use internal browser fulfillment.";
  }
  if (adapter.rail === "ottoauth_internal") {
    return "This request is executable now through OttoAuth internal browser fulfillment.";
  }
  return `${adapter.adapterId} is the preferred future rail for this merchant; current execution remains OttoAuth internal browser fulfillment.`;
}

export function planCommerceRoute(input: CommerceRouteInput): CommerceRoutePlan {
  const category = inferCommerceCategory({
    merchantName: input.merchantName,
    platformHint: input.platformHint,
    rawTask: input.rawTask,
    taskPrompt: input.taskPrompt,
    requestJson: input.requestJson,
  });
  const match = bestAdapter(input);
  const adapter = match?.adapter ?? null;
  const preferredRail = adapter?.rail ?? "ottoauth_internal";
  const adapterId = adapter?.adapterId ?? "ottoauth.browser.generic";
  const adapterStatus = adapter?.status ?? "active";
  const reasons = match?.reasons ?? ["default internal browser fulfillment fallback"];

  return {
    preferredRail,
    executionRail: "ottoauth_internal",
    adapterId,
    adapterStatus,
    merchantKey: adapter?.merchantKey ?? null,
    category,
    confidence: Math.min(match?.score ?? 25, 100),
    reasons,
    userFulfillmentExposed: false,
    note: adapterNote(adapter),
  };
}

export function formatCommerceRoutePlanForApi(plan: CommerceRoutePlan) {
  return {
    preferred_rail: plan.preferredRail,
    execution_rail: plan.executionRail,
    adapter_id: plan.adapterId,
    adapter_status: plan.adapterStatus,
    merchant_key: plan.merchantKey,
    category: plan.category,
    confidence: plan.confidence,
    reasons: plan.reasons,
    user_fulfillment_exposed: plan.userFulfillmentExposed,
    note: plan.note,
  };
}
