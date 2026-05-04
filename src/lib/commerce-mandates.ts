export type CommerceCategory =
  | "retail"
  | "food"
  | "grocery"
  | "travel"
  | "industrial_parts"
  | "custom_manufacturing"
  | "services";

export type InferredCommerceCategory = CommerceCategory | "unknown";

export type CommerceMandate = {
  id: string | null;
  maxTotalCents: number | null;
  maxDailyCents: number | null;
  allowedCategories: CommerceCategory[];
  blockedCategories: CommerceCategory[];
  allowedMerchants: string[];
  blockedMerchants: string[];
  approvalRequiredOverCents: number | null;
  expiresAt: string | null;
};

export type CommerceMandateDecisionStatus =
  | "not_provided"
  | "allowed"
  | "rejected"
  | "approval_required";

export type CommerceMandateDecision = {
  ok: boolean;
  status: CommerceMandateDecisionStatus;
  code: string;
  reasons: string[];
  warnings: string[];
  category: InferredCommerceCategory;
  effectiveMaxChargeCents: number | null;
  mandate: CommerceMandate | null;
};

type CommerceMandateRequest = {
  merchantName?: string | null;
  platformHint?: string | null;
  rawTask?: string | null;
  taskPrompt?: string | null;
  requestJson?: Record<string, unknown> | null;
  maxChargeCents?: number | null;
  category?: InferredCommerceCategory | null;
  now?: Date;
};

const CATEGORY_ALIASES: Record<CommerceCategory, string[]> = {
  retail: [
    "retail",
    "shopping",
    "amazon",
    "walmart",
    "target",
    "best buy",
    "bestbuy",
    "ebay",
    "etsy",
    "shopify",
  ],
  food: [
    "food",
    "restaurant",
    "snackpass",
    "snack pass",
    "doordash",
    "door dash",
    "uber eats",
    "ubereats",
    "grubhub",
    "pickup",
    "delivery",
    "coffee",
    "lunch",
    "dinner",
  ],
  grocery: [
    "grocery",
    "groceries",
    "instacart",
    "whole foods",
    "costco",
    "safeway",
    "kroger",
  ],
  travel: [
    "travel",
    "flight",
    "flights",
    "hotel",
    "lodging",
    "airbnb",
    "booking",
    "ride",
    "rideshare",
    "uber ride",
  ],
  industrial_parts: [
    "industrial",
    "industrial parts",
    "parts",
    "hardware",
    "electronics",
    "electronic components",
    "digikey",
    "digi key",
    "mcmaster",
    "mcmaster carr",
    "mouser",
    "jlcpcb",
    "pcb",
  ],
  custom_manufacturing: [
    "custom manufacturing",
    "manufacturing",
    "3d printing",
    "3d print",
    "additive",
    "additive manufacturing",
    "cnc",
    "prototype",
    "prototyping",
    "xometry",
    "protolabs",
    "proto labs",
    "fictiv",
    "treatstock",
    "treat stock",
  ],
  services: [
    "service",
    "services",
    "subscription",
    "api",
    "compute",
    "data",
    "software",
  ],
};

const TOP_LEVEL_MANDATE_KEYS = [
  "mandate_id",
  "mandateId",
  "max_total_cents",
  "maxTotalCents",
  "max_daily_cents",
  "maxDailyCents",
  "allowed_categories",
  "allowedCategories",
  "blocked_categories",
  "blockedCategories",
  "allowed_merchants",
  "allowedMerchants",
  "blocked_merchants",
  "blockedMerchants",
  "approval_required_over_cents",
  "approvalRequiredOverCents",
  "expires_at",
  "expiresAt",
];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstValue(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (source[key] != null && source[key] !== "") return source[key];
  }
  return null;
}

function firstString(source: Record<string, unknown>, keys: string[]) {
  const value = firstValue(source, keys);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseOptionalPositiveCents(
  source: Record<string, unknown>,
  keys: string[],
  fieldName: string,
) {
  const value = firstValue(source, keys);
  if (value == null) return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number of cents if provided.`);
  }
  return Math.trunc(parsed);
}

function listFromValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => listFromValue(item));
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function readStringList(source: Record<string, unknown>, keys: string[]) {
  const values = keys.flatMap((key) => listFromValue(source[key]));
  return Array.from(new Set(values));
}

export function normalizeCommerceSlug(value: unknown) {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function normalizeCategory(value: string): CommerceCategory | null {
  const slug = normalizeCommerceSlug(value);
  if (!slug) return null;
  for (const category of Object.keys(CATEGORY_ALIASES) as CommerceCategory[]) {
    if (category === slug || CATEGORY_ALIASES[category].some((alias) => normalizeCommerceSlug(alias) === slug)) {
      return category;
    }
  }
  return null;
}

function readCategoryList(source: Record<string, unknown>, keys: string[]) {
  const categories = readStringList(source, keys)
    .map(normalizeCategory)
    .filter((value): value is CommerceCategory => Boolean(value));
  return Array.from(new Set(categories));
}

function normalizeMerchantList(source: Record<string, unknown>, keys: string[]) {
  return Array.from(
    new Set(
      readStringList(source, keys)
        .map(normalizeCommerceSlug)
        .filter(Boolean),
    ),
  );
}

function hasMandateKeys(payload: Record<string, unknown>) {
  return TOP_LEVEL_MANDATE_KEYS.some((key) => payload[key] != null && payload[key] !== "");
}

function requestText(request: CommerceMandateRequest) {
  const requestJson = request.requestJson ?? {};
  return normalizeCommerceSlug(
    [
      request.merchantName,
      request.platformHint,
      request.rawTask,
      request.taskPrompt,
      typeof requestJson.merchant_name === "string" ? requestJson.merchant_name : null,
      typeof requestJson.platform_hint === "string" ? requestJson.platform_hint : null,
      typeof requestJson.fulfillment === "string" ? requestJson.fulfillment : null,
      typeof requestJson.task === "string" ? requestJson.task : null,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function merchantMatches(merchantText: string, merchant: string) {
  if (!merchantText || !merchant) return false;
  return (
    merchantText === merchant ||
    merchantText.includes(` ${merchant} `) ||
    merchantText.startsWith(`${merchant} `) ||
    merchantText.endsWith(` ${merchant}`) ||
    merchant.includes(merchantText)
  );
}

export function inferCommerceCategory(
  request: Omit<CommerceMandateRequest, "category">,
): InferredCommerceCategory {
  const explicit = request.requestJson
    ? firstString(request.requestJson, [
        "category",
        "commerce_category",
        "commerceCategory",
        "order_category",
        "orderCategory",
      ])
    : null;
  if (explicit) return normalizeCategory(explicit) ?? "unknown";

  const text = requestText(request);
  let best: { category: CommerceCategory; score: number } | null = null;
  for (const category of Object.keys(CATEGORY_ALIASES) as CommerceCategory[]) {
    const score = CATEGORY_ALIASES[category].reduce((total, alias) => {
      const aliasSlug = normalizeCommerceSlug(alias);
      if (!aliasSlug) return total;
      return text.includes(aliasSlug) ? total + aliasSlug.length : total;
    }, 0);
    if (score > 0 && (!best || score > best.score)) {
      best = { category, score };
    }
  }
  return best?.category ?? "unknown";
}

export function normalizeCommerceMandateFromPayload(
  payload: Record<string, unknown>,
): CommerceMandate | null {
  const nested =
    record(payload.mandate) ||
    record(payload.commerce_mandate) ||
    record(payload.commerceMandate);
  if (!nested && !hasMandateKeys(payload)) return null;
  const source = nested ?? payload;

  const expiresAt = firstString(source, ["expires_at", "expiresAt", "expiration", "valid_until", "validUntil"]);
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    throw new Error("mandate.expires_at must be a valid date if provided.");
  }

  return {
    id: firstString(source, ["id", "mandate_id", "mandateId"]) ?? null,
    maxTotalCents: parseOptionalPositiveCents(
      source,
      [
        "max_total_cents",
        "maxTotalCents",
        "max_per_order_cents",
        "maxPerOrderCents",
        "per_order_max_cents",
        "perOrderMaxCents",
      ],
      "mandate.max_total_cents",
    ),
    maxDailyCents: parseOptionalPositiveCents(
      source,
      ["max_daily_cents", "maxDailyCents", "daily_max_cents", "dailyMaxCents"],
      "mandate.max_daily_cents",
    ),
    allowedCategories: readCategoryList(source, [
      "allowed_categories",
      "allowedCategories",
      "categories",
    ]),
    blockedCategories: readCategoryList(source, [
      "blocked_categories",
      "blockedCategories",
      "disallowed_categories",
      "disallowedCategories",
    ]),
    allowedMerchants: normalizeMerchantList(source, [
      "allowed_merchants",
      "allowedMerchants",
      "allowed_stores",
      "allowedStores",
      "merchants",
      "stores",
    ]),
    blockedMerchants: normalizeMerchantList(source, [
      "blocked_merchants",
      "blockedMerchants",
      "disallowed_merchants",
      "disallowedMerchants",
      "blocked_stores",
      "blockedStores",
    ]),
    approvalRequiredOverCents: parseOptionalPositiveCents(
      source,
      [
        "approval_required_over_cents",
        "approvalRequiredOverCents",
        "requires_approval_over_cents",
        "requiresApprovalOverCents",
      ],
      "mandate.approval_required_over_cents",
    ),
    expiresAt: expiresAt ?? null,
  };
}

export function evaluateCommerceMandate(
  params: CommerceMandateRequest & { mandate: CommerceMandate | null },
): CommerceMandateDecision {
  const category =
    params.category && params.category !== "unknown"
      ? params.category
      : inferCommerceCategory(params);
  const effectiveMaxChargeCents =
    params.maxChargeCents ?? params.mandate?.maxTotalCents ?? null;

  if (!params.mandate) {
    return {
      ok: true,
      status: "not_provided",
      code: "mandate_not_provided",
      reasons: [],
      warnings: [],
      category,
      effectiveMaxChargeCents,
      mandate: null,
    };
  }

  const reasons: string[] = [];
  const warnings: string[] = [];
  const mandate = params.mandate;
  const now = params.now ?? new Date();
  const merchantText = ` ${requestText(params)} `;

  if (mandate.expiresAt && new Date(mandate.expiresAt).getTime() <= now.getTime()) {
    reasons.push("The commerce mandate has expired.");
  }

  if (
    mandate.maxTotalCents != null &&
    effectiveMaxChargeCents != null &&
    effectiveMaxChargeCents > mandate.maxTotalCents
  ) {
    reasons.push(
      `Requested max charge ${effectiveMaxChargeCents} cents exceeds mandate max ${mandate.maxTotalCents} cents.`,
    );
  }

  const matchedBlockedMerchant = mandate.blockedMerchants.find((merchant) =>
    merchantMatches(merchantText, merchant),
  );
  if (matchedBlockedMerchant) {
    reasons.push(`Merchant is blocked by mandate: ${matchedBlockedMerchant}.`);
  }

  if (mandate.allowedMerchants.length > 0) {
    const matchedAllowedMerchant = mandate.allowedMerchants.some((merchant) =>
      merchantMatches(merchantText, merchant),
    );
    if (!matchedAllowedMerchant) {
      reasons.push("Request merchant is not in the mandate allowed_merchants list.");
    }
  }

  if (category !== "unknown" && mandate.blockedCategories.includes(category)) {
    reasons.push(`Category is blocked by mandate: ${category}.`);
  }

  if (mandate.allowedCategories.length > 0) {
    if (category === "unknown") {
      reasons.push("Request category could not be inferred for mandate category enforcement.");
    } else if (!mandate.allowedCategories.includes(category)) {
      reasons.push(`Category ${category} is not in the mandate allowed_categories list.`);
    }
  }

  if (reasons.length > 0) {
    return {
      ok: false,
      status: "rejected",
      code: "mandate_rejected",
      reasons,
      warnings,
      category,
      effectiveMaxChargeCents,
      mandate,
    };
  }

  if (
    mandate.approvalRequiredOverCents != null &&
    effectiveMaxChargeCents != null &&
    effectiveMaxChargeCents > mandate.approvalRequiredOverCents
  ) {
    return {
      ok: false,
      status: "approval_required",
      code: "mandate_approval_required",
      reasons: [
        `Requested max charge ${effectiveMaxChargeCents} cents exceeds approval threshold ${mandate.approvalRequiredOverCents} cents.`,
      ],
      warnings,
      category,
      effectiveMaxChargeCents,
      mandate,
    };
  }

  if (mandate.maxDailyCents != null) {
    warnings.push(
      "Mandate max_daily_cents is recorded for routing metadata; rolling daily enforcement requires persisted mandate spend tracking.",
    );
  }

  return {
    ok: true,
    status: "allowed",
    code: "mandate_allowed",
    reasons,
    warnings,
    category,
    effectiveMaxChargeCents,
    mandate,
  };
}

export function formatCommerceMandateDecisionForApi(
  decision: CommerceMandateDecision,
) {
  return {
    ok: decision.ok,
    status: decision.status,
    code: decision.code,
    reasons: decision.reasons,
    warnings: decision.warnings,
    category: decision.category,
    effective_max_charge_cents: decision.effectiveMaxChargeCents,
    mandate: decision.mandate
      ? {
          id: decision.mandate.id,
          max_total_cents: decision.mandate.maxTotalCents,
          max_daily_cents: decision.mandate.maxDailyCents,
          allowed_categories: decision.mandate.allowedCategories,
          blocked_categories: decision.mandate.blockedCategories,
          allowed_merchants: decision.mandate.allowedMerchants,
          blocked_merchants: decision.mandate.blockedMerchants,
          approval_required_over_cents: decision.mandate.approvalRequiredOverCents,
          expires_at: decision.mandate.expiresAt,
        }
      : null,
  };
}
