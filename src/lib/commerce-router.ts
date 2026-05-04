import {
  inferCommerceCategory,
  normalizeCommerceSlug,
  type InferredCommerceCategory,
} from "@/lib/commerce-mandates";
import {
  directApiAdapterConfigured,
  type CommerceFulfillmentCategory,
} from "@/lib/commerce-adapter-config";

export type CommerceFulfillmentRail =
  | "acp"
  | "zinc"
  | "api"
  | "ottoauth_agents";

export type CommerceAdapterStatus = "active" | "planned";

export type CommerceRoutePlan = {
  preferredRail: CommerceFulfillmentRail;
  executionRail: CommerceFulfillmentRail;
  fulfillmentCategory: CommerceFulfillmentCategory;
  preferredFulfillmentCategory: CommerceFulfillmentCategory;
  adapterId: string;
  adapterStatus: CommerceAdapterStatus;
  adapterConfigured: boolean;
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
  apiCheckoutRequested?: boolean;
};

type CommerceAdapterHint = {
  merchantKey: string;
  adapterId: string;
  rail: CommerceFulfillmentRail;
  fallbackRail: CommerceFulfillmentRail;
  fulfillmentCategory: CommerceFulfillmentCategory;
  status: CommerceAdapterStatus;
  aliases: string[];
  domains: string[];
  requiresConfiguration?: boolean;
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
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "zinc",
    status: "planned",
    aliases: ["amazon", "amazon.com", "amazon prime"],
    domains: ["amazon.com"],
  },
  {
    merchantKey: "walmart",
    adapterId: "zinc.walmart",
    rail: "zinc",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "zinc",
    status: "planned",
    aliases: ["walmart", "wal mart"],
    domains: ["walmart.com"],
  },
  {
    merchantKey: "target",
    adapterId: "zinc.target",
    rail: "zinc",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "zinc",
    status: "planned",
    aliases: ["target"],
    domains: ["target.com"],
  },
  {
    merchantKey: "bestbuy",
    adapterId: "zinc.bestbuy",
    rail: "zinc",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "zinc",
    status: "planned",
    aliases: ["best buy", "bestbuy"],
    domains: ["bestbuy.com"],
  },
];

const ACP_ADAPTERS: CommerceAdapterHint[] = [
  {
    merchantKey: "acp",
    adapterId: "acp.checkout",
    rail: "api",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "api",
    status: "planned",
    aliases: ["acp", "agentic commerce protocol", "shopify", "stripe shared payment token"],
    domains: ["myshopify.com"],
  },
];

const DIRECT_API_ADAPTERS: CommerceAdapterHint[] = [
  {
    merchantKey: "mouser",
    adapterId: "api.mouser",
    rail: "api",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "api",
    status: "active",
    aliases: ["mouser", "mouser electronics"],
    domains: ["mouser.com"],
    requiresConfiguration: true,
  },
  {
    merchantKey: "digikey",
    adapterId: "api.digikey",
    rail: "api",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "api",
    status: "active",
    aliases: ["digikey", "digi key", "digi-key"],
    domains: ["digikey.com"],
    requiresConfiguration: true,
  },
  {
    merchantKey: "treatstock",
    adapterId: "api.treatstock",
    rail: "api",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "api",
    status: "active",
    aliases: ["treatstock", "treat stock"],
    domains: ["treatstock.com"],
    requiresConfiguration: true,
  },
  {
    merchantKey: "jlcpcb",
    adapterId: "api.jlcpcb",
    rail: "api",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "api",
    status: "active",
    aliases: [
      "jlcpcb",
      "jlc pcb",
      "jlc api",
      "jlcpcb pcb",
      "jlcpcb pcba",
      "jlcpcb assembly",
      "jlcpcb pcb assembly",
      "jlcpcb printed circuit board",
      "easyeda jlcpcb",
    ],
    domains: ["jlcpcb.com", "cart.jlcpcb.com", "api.jlcpcb.com"],
    requiresConfiguration: true,
  },
  {
    merchantKey: "xometry",
    adapterId: "api.xometry",
    rail: "api",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "api",
    status: "planned",
    aliases: ["xometry"],
    domains: ["xometry.com"],
    requiresConfiguration: true,
  },
  {
    merchantKey: "protolabs",
    adapterId: "api.protolabs",
    rail: "api",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "api",
    status: "planned",
    aliases: ["protolabs", "proto labs", "prodesk"],
    domains: ["protolabs.com", "buildit.protolabs.com"],
    requiresConfiguration: true,
  },
  {
    merchantKey: "fictiv",
    adapterId: "api.fictiv",
    rail: "api",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "api",
    status: "planned",
    aliases: ["fictiv"],
    domains: ["fictiv.com", "app.fictiv.com"],
    requiresConfiguration: true,
  },
];

const OTTOAUTH_AGENT_ADAPTERS: CommerceAdapterHint[] = [
  {
    merchantKey: "snackpass",
    adapterId: "ottoauth.browser.snackpass",
    rail: "ottoauth_agents",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "ottoauth_agents",
    status: "active",
    aliases: ["snackpass", "snack pass"],
    domains: ["snackpass.co", "order.snackpass.co"],
  },
  {
    merchantKey: "mcmaster",
    adapterId: "ottoauth.browser.mcmaster",
    rail: "ottoauth_agents",
    fallbackRail: "ottoauth_agents",
    fulfillmentCategory: "ottoauth_agents",
    status: "active",
    aliases: ["mcmaster", "mcmaster carr", "mcmaster-carr"],
    domains: ["mcmaster.com"],
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
    ...DIRECT_API_ADAPTERS,
    ...ACP_ADAPTERS,
    ...ZINC_RETAIL_ADAPTERS,
    ...OTTOAUTH_AGENT_ADAPTERS,
  ]
    .map((adapter) => scoreAdapter(adapter, input))
    .filter((candidate): candidate is ScoredCommerceAdapter => Boolean(candidate))
    .sort((a, b) => b.score - a.score);

  return candidates[0] ?? null;
}

function adapterNote(
  adapter: CommerceAdapterHint | null,
  executionRail: CommerceFulfillmentRail,
  configured: boolean,
  apiCheckoutRequested: boolean,
) {
  if (!adapter) {
    return "No specialized commerce adapter matched, so OttoAuth will use OttoAuth agents.";
  }
  if (executionRail === "ottoauth_agents") {
    if (adapter.rail === "api" && !configured) {
      return `${adapter.adapterId} is the preferred API rail, but credentials are not configured; OttoAuth agents will fulfill this order.`;
    }
    if (adapter.rail === "api" && configured && !apiCheckoutRequested) {
      return `${adapter.adapterId} is configured, but the request did not include API checkout fields; OttoAuth agents will fulfill this order.`;
    }
    if (adapter.rail === "zinc") {
      return `${adapter.adapterId} is the preferred Zinc rail; current execution remains OttoAuth agents until Zinc is configured.`;
    }
    return "This request is executable now through OttoAuth agents.";
  }
  return `${adapter.adapterId} is configured and selected for direct API execution.`;
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
  const preferredRail = adapter?.rail ?? "ottoauth_agents";
  const adapterId = adapter?.adapterId ?? "ottoauth.browser.generic";
  const adapterStatus = adapter?.status ?? "active";
  const adapterConfigured = adapter ? directApiAdapterConfigured(adapter.adapterId) : false;
  const executionRail =
    adapter?.rail === "api" && adapterConfigured && input.apiCheckoutRequested
      ? "api"
      : adapter?.fallbackRail ?? "ottoauth_agents";
  const preferredFulfillmentCategory = adapter?.fulfillmentCategory ?? "ottoauth_agents";
  const fulfillmentCategory: CommerceFulfillmentCategory =
    executionRail === "api"
      ? "api"
      : executionRail === "zinc"
        ? "zinc"
        : "ottoauth_agents";
  const reasons = match?.reasons ?? ["default internal browser fulfillment fallback"];

  return {
    preferredRail,
    executionRail,
    fulfillmentCategory,
    preferredFulfillmentCategory,
    adapterId,
    adapterStatus,
    adapterConfigured,
    merchantKey: adapter?.merchantKey ?? null,
    category,
    confidence: Math.min(match?.score ?? 25, 100),
    reasons,
    userFulfillmentExposed: false,
    note: adapterNote(adapter, executionRail, adapterConfigured, Boolean(input.apiCheckoutRequested)),
  };
}

export function formatCommerceRoutePlanForApi(plan: CommerceRoutePlan) {
  return {
    preferred_rail: plan.preferredRail,
    execution_rail: plan.executionRail,
    fulfillment_category: plan.fulfillmentCategory,
    preferred_fulfillment_category: plan.preferredFulfillmentCategory,
    adapter_id: plan.adapterId,
    adapter_status: plan.adapterStatus,
    adapter_configured: plan.adapterConfigured,
    merchant_key: plan.merchantKey,
    category: plan.category,
    confidence: plan.confidence,
    reasons: plan.reasons,
    user_fulfillment_exposed: plan.userFulfillmentExposed,
    note: plan.note,
  };
}
