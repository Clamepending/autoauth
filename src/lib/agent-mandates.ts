import { ensureHumanAccountSchema } from "@/lib/human-accounts";
import { ensureOrderOrchestrationSchema } from "@/lib/order-orchestration";
import type { NonBrowserPriceQuote } from "@/lib/non-browser-price-quotes";
import { getTursoClient } from "@/lib/turso";

export type AgentMandatePolicyMode = "unrestricted" | "restricted" | "paused";

export type AgentMandatePolicyRecord = {
  id: number | null;
  human_agent_link_id: number;
  mode: AgentMandatePolicyMode;
  max_per_order_cents: number | null;
  max_daily_cents: number | null;
  max_weekly_cents: number | null;
  max_monthly_cents: number | null;
  require_approval_over_cents: number | null;
  allowed_domains: string[];
  blocked_domains: string[];
  blocked_categories: string[];
  approval_rules: string[];
  natural_language_mandate: string | null;
  active_revision: number;
  created_at: string | null;
  updated_at: string | null;
};

export type AgentMandateWithAgent = {
  link: {
    id: number;
    human_user_id: number;
    agent_id: number;
    linked_at: string;
    created_at: string;
    updated_at: string;
    username_lower: string;
    username_display: string;
    callback_url: string | null;
    description: string | null;
  };
  policy: AgentMandatePolicyRecord;
};

export type AgentMandateEvaluation =
  | {
      allowed: true;
      policy: AgentMandatePolicyRecord;
      metadata: AgentMandateEvaluationMetadata;
    }
  | {
      allowed: false;
      code:
        | "agent_mandate_paused"
        | "agent_mandate_domain_blocked"
        | "agent_mandate_domain_not_allowed"
        | "agent_mandate_per_order_limit"
        | "agent_mandate_daily_limit"
        | "agent_mandate_weekly_limit"
        | "agent_mandate_monthly_limit"
        | "agent_mandate_category_blocked"
        | "agent_mandate_approval_required";
      reason: string;
      policy: AgentMandatePolicyRecord;
      metadata: AgentMandateEvaluationMetadata;
    };

export type AgentMandateEvaluationMetadata = {
  policy_id: number | null;
  revision: number;
  mode: AgentMandatePolicyMode;
  evaluated_at: string;
  effective_cap_cents: number | null;
  detected_domains: string[];
  decision: "allowed" | "blocked";
  reason: string | null;
};

export const AGENT_MANDATE_APPROVAL_RULES = [
  "unknown_merchant",
  "subscription",
  "gift_card",
  "travel",
  "regulated_goods",
  "address_change",
] as const;

const APPROVAL_RULE_LABELS: Record<string, string> = {
  unknown_merchant: "unknown merchant",
  subscription: "subscriptions or recurring charges",
  gift_card: "gift cards or stored value",
  travel: "travel, ticketing, or reservations",
  regulated_goods: "regulated goods",
  address_change: "new or changed delivery address",
};

function parseJsonStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return parseJsonStringArray(parsed);
  } catch {
    return [];
  }
}

function normalizePolicyMode(value: unknown): AgentMandatePolicyMode {
  return value === "restricted" || value === "paused" ? value : "unrestricted";
}

function normalizeOptionalCents(value: unknown, label: string) {
  if (value == null || value === "") return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[$,\s]/g, ""))
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number of cents.`);
  }
  const cents = Math.trunc(parsed);
  if (cents <= 0) {
    throw new Error(`${label} must be blank or a positive number of cents.`);
  }
  if (cents > 100_000_000) {
    throw new Error(`${label} is too large.`);
  }
  return cents;
}

function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const withoutProtocol = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withoutProtocol);
    const host = url.hostname.replace(/^www\./, "");
    if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

function normalizeDomainList(value: unknown, label: string) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]+/)
      : [];
  const domains = raw
    .filter((entry): entry is string => typeof entry === "string")
    .map(normalizeDomain)
    .filter((entry): entry is string => Boolean(entry));
  const unique = Array.from(new Set(domains)).slice(0, 100);
  if (raw.some((entry) => typeof entry === "string" && entry.trim()) && unique.length === 0) {
    throw new Error(`${label} must contain valid domains.`);
  }
  return unique;
}

function normalizeKeywordList(value: unknown, label: string) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]+/)
      : [];
  const values = raw
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase().replace(/\s+/g, " "))
    .filter((entry) => entry.length > 0 && entry.length <= 80);
  const unique = Array.from(new Set(values)).slice(0, 40);
  if (raw.some((entry) => typeof entry === "string" && entry.trim()) && unique.length === 0) {
    throw new Error(`${label} must contain valid text.`);
  }
  return unique;
}

function normalizeApprovalRules(value: unknown) {
  const allowed = new Set<string>(AGENT_MANDATE_APPROVAL_RULES);
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]+/)
      : [];
  return Array.from(
    new Set(
      raw
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => allowed.has(entry)),
    ),
  );
}

function mapPolicyRow(
  row: Record<string, unknown> | undefined,
  humanAgentLinkId: number,
): AgentMandatePolicyRecord {
  if (!row) return defaultPolicyForLink(humanAgentLinkId);
  return {
    id: row.id == null ? null : Number(row.id),
    human_agent_link_id: Number(row.human_agent_link_id ?? humanAgentLinkId),
    mode: normalizePolicyMode(row.mode),
    max_per_order_cents:
      row.max_per_order_cents == null || row.max_per_order_cents === ""
        ? null
        : Number(row.max_per_order_cents),
    max_daily_cents:
      row.max_daily_cents == null || row.max_daily_cents === ""
        ? null
        : Number(row.max_daily_cents),
    max_weekly_cents:
      row.max_weekly_cents == null || row.max_weekly_cents === ""
        ? null
        : Number(row.max_weekly_cents),
    max_monthly_cents:
      row.max_monthly_cents == null || row.max_monthly_cents === ""
        ? null
        : Number(row.max_monthly_cents),
    require_approval_over_cents:
      row.require_approval_over_cents == null || row.require_approval_over_cents === ""
        ? null
        : Number(row.require_approval_over_cents),
    allowed_domains: parseJsonStringArray(row.allowed_domains_json),
    blocked_domains: parseJsonStringArray(row.blocked_domains_json),
    blocked_categories: parseJsonStringArray(row.blocked_categories_json),
    approval_rules: parseJsonStringArray(row.approval_rules_json),
    natural_language_mandate:
      row.natural_language_mandate == null
        ? null
        : String(row.natural_language_mandate),
    active_revision: Number(row.active_revision ?? 0),
    created_at: row.created_at == null ? null : String(row.created_at),
    updated_at: row.updated_at == null ? null : String(row.updated_at),
  };
}

function defaultPolicyForLink(humanAgentLinkId: number): AgentMandatePolicyRecord {
  return {
    id: null,
    human_agent_link_id: humanAgentLinkId,
    mode: "unrestricted",
    max_per_order_cents: null,
    max_daily_cents: null,
    max_weekly_cents: null,
    max_monthly_cents: null,
    require_approval_over_cents: null,
    allowed_domains: [],
    blocked_domains: [],
    blocked_categories: [],
    approval_rules: [],
    natural_language_mandate: null,
    active_revision: 0,
    created_at: null,
    updated_at: null,
  };
}

async function getPolicyForLinkId(humanAgentLinkId: number) {
  await ensureHumanAccountSchema();
  const result = await getTursoClient().execute({
    sql: "SELECT * FROM human_agent_mandate_policies WHERE human_agent_link_id = ? LIMIT 1",
    args: [humanAgentLinkId],
  });
  return mapPolicyRow(result.rows?.[0] as Record<string, unknown> | undefined, humanAgentLinkId);
}

async function getHumanAgentLinkWithAgent(linkId: number) {
  await ensureHumanAccountSchema();
  const result = await getTursoClient().execute({
    sql: `SELECT
            l.id,
            l.human_user_id,
            l.agent_id,
            l.linked_at,
            l.created_at,
            l.updated_at,
            a.username_lower,
            a.username_display,
            a.callback_url,
            a.description
          FROM human_agent_links l
          JOIN agents a ON a.id = l.agent_id
          WHERE l.id = ?
          LIMIT 1`,
    args: [linkId],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    human_user_id: Number(row.human_user_id),
    agent_id: Number(row.agent_id),
    linked_at: String(row.linked_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    username_lower: String(row.username_lower),
    username_display: String(row.username_display),
    callback_url: row.callback_url == null ? null : String(row.callback_url),
    description: row.description == null ? null : String(row.description),
  };
}

export async function getAgentMandateForHumanLink(params: {
  humanUserId: number;
  linkId: number;
}): Promise<AgentMandateWithAgent | null> {
  const link = await getHumanAgentLinkWithAgent(params.linkId);
  if (!link || link.human_user_id !== params.humanUserId) return null;
  return {
    link,
    policy: await getPolicyForLinkId(link.id),
  };
}

export async function getAgentMandateForAgentUsername(usernameLower: string) {
  await ensureHumanAccountSchema();
  const result = await getTursoClient().execute({
    sql: `SELECT
            l.id
          FROM human_agent_links l
          JOIN agents a ON a.id = l.agent_id
          WHERE a.username_lower = ?
          LIMIT 1`,
    args: [usernameLower.trim().toLowerCase()],
  });
  const linkId = Number((result.rows?.[0] as Record<string, unknown> | undefined)?.id ?? 0);
  if (!linkId) return null;
  const link = await getHumanAgentLinkWithAgent(linkId);
  if (!link) return null;
  return {
    link,
    policy: await getPolicyForLinkId(link.id),
  };
}

function normalizePolicyInput(payload: Record<string, unknown>, humanAgentLinkId: number) {
  const naturalLanguageMandate =
    typeof payload.natural_language_mandate === "string"
      ? payload.natural_language_mandate.trim().slice(0, 2000) || null
      : typeof payload.naturalLanguageMandate === "string"
        ? payload.naturalLanguageMandate.trim().slice(0, 2000) || null
        : null;

  return {
    human_agent_link_id: humanAgentLinkId,
    mode: normalizePolicyMode(payload.mode),
    max_per_order_cents: normalizeOptionalCents(
      payload.max_per_order_cents ?? payload.maxPerOrderCents,
      "Max per order",
    ),
    max_daily_cents: normalizeOptionalCents(
      payload.max_daily_cents ?? payload.maxDailyCents,
      "Daily limit",
    ),
    max_weekly_cents: normalizeOptionalCents(
      payload.max_weekly_cents ?? payload.maxWeeklyCents,
      "Weekly limit",
    ),
    max_monthly_cents: normalizeOptionalCents(
      payload.max_monthly_cents ?? payload.maxMonthlyCents,
      "Monthly limit",
    ),
    require_approval_over_cents: normalizeOptionalCents(
      payload.require_approval_over_cents ?? payload.requireApprovalOverCents,
      "Approval threshold",
    ),
    allowed_domains: normalizeDomainList(
      payload.allowed_domains ?? payload.allowedDomains,
      "Allowed domains",
    ),
    blocked_domains: normalizeDomainList(
      payload.blocked_domains ?? payload.blockedDomains,
      "Blocked domains",
    ),
    blocked_categories: normalizeKeywordList(
      payload.blocked_categories ?? payload.blockedCategories,
      "Blocked categories",
    ),
    approval_rules: normalizeApprovalRules(
      payload.approval_rules ?? payload.approvalRules,
    ),
    natural_language_mandate: naturalLanguageMandate,
  } satisfies Omit<
    AgentMandatePolicyRecord,
    "id" | "active_revision" | "created_at" | "updated_at"
  >;
}

export async function saveAgentMandatePolicyForHuman(params: {
  humanUserId: number;
  linkId: number;
  payload: Record<string, unknown>;
}) {
  const mandate = await getAgentMandateForHumanLink({
    humanUserId: params.humanUserId,
    linkId: params.linkId,
  });
  if (!mandate) throw new Error("Linked agent not found.");

  const normalized = normalizePolicyInput(params.payload, params.linkId);
  const client = getTursoClient();
  const transaction = await client.transaction("write");
  try {
    const now = new Date().toISOString();
    const existingResult = await transaction.execute({
      sql: "SELECT * FROM human_agent_mandate_policies WHERE human_agent_link_id = ? LIMIT 1",
      args: [params.linkId],
    });
    const existing = existingResult.rows?.[0] as Record<string, unknown> | undefined;
    const nextRevision = Number(existing?.active_revision ?? 0) + 1;

    if (existing) {
      await transaction.execute({
        sql: `UPDATE human_agent_mandate_policies
              SET mode = ?,
                  max_per_order_cents = ?,
                  max_daily_cents = ?,
                  max_weekly_cents = ?,
                  max_monthly_cents = ?,
                  require_approval_over_cents = ?,
                  allowed_domains_json = ?,
                  blocked_domains_json = ?,
                  blocked_categories_json = ?,
                  approval_rules_json = ?,
                  natural_language_mandate = ?,
                  active_revision = ?,
                  updated_at = ?
              WHERE human_agent_link_id = ?`,
        args: [
          normalized.mode,
          normalized.max_per_order_cents,
          normalized.max_daily_cents,
          normalized.max_weekly_cents,
          normalized.max_monthly_cents,
          normalized.require_approval_over_cents,
          JSON.stringify(normalized.allowed_domains),
          JSON.stringify(normalized.blocked_domains),
          JSON.stringify(normalized.blocked_categories),
          JSON.stringify(normalized.approval_rules),
          normalized.natural_language_mandate,
          nextRevision,
          now,
          params.linkId,
        ],
      });
    } else {
      await transaction.execute({
        sql: `INSERT INTO human_agent_mandate_policies
              (human_agent_link_id, mode, max_per_order_cents, max_daily_cents,
               max_weekly_cents, max_monthly_cents, require_approval_over_cents,
               allowed_domains_json, blocked_domains_json, blocked_categories_json,
               approval_rules_json, natural_language_mandate, active_revision,
               created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          params.linkId,
          normalized.mode,
          normalized.max_per_order_cents,
          normalized.max_daily_cents,
          normalized.max_weekly_cents,
          normalized.max_monthly_cents,
          normalized.require_approval_over_cents,
          JSON.stringify(normalized.allowed_domains),
          JSON.stringify(normalized.blocked_domains),
          JSON.stringify(normalized.blocked_categories),
          JSON.stringify(normalized.approval_rules),
          normalized.natural_language_mandate,
          nextRevision,
          now,
          now,
        ],
      });
    }

    await transaction.execute({
      sql: `INSERT INTO human_agent_mandate_revisions
            (human_agent_link_id, revision, policy_snapshot_json, created_by_human_user_id, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        params.linkId,
        nextRevision,
        JSON.stringify({ ...normalized, active_revision: nextRevision }),
        params.humanUserId,
        now,
      ],
    });

    await transaction.commit();
  } finally {
    transaction.close();
  }

  return getAgentMandateForHumanLink({
    humanUserId: params.humanUserId,
    linkId: params.linkId,
  });
}

function domainMatchesRule(domain: string, rule: string) {
  return domain === rule || domain.endsWith(`.${rule}`);
}

function collectUrlDomains(value: unknown, domains = new Set<string>()) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
      const domain = normalizeDomain(trimmed);
      if (domain) domains.add(domain);
    }
    return domains;
  }
  if (!value || typeof value !== "object") return domains;
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 80)) collectUrlDomains(entry, domains);
    return domains;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes("url") || lowerKey === "link") {
      collectUrlDomains(entry, domains);
    } else if (Array.isArray(entry) && ["items", "products", "files"].includes(lowerKey)) {
      collectUrlDomains(entry, domains);
    }
  }
  return domains;
}

function orderSearchText(payload: Record<string, unknown>) {
  const chunks: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 3) return;
    if (typeof value === "string") {
      chunks.push(value);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 40)) visit(entry, depth + 1);
      return;
    }
    for (const entry of Object.values(value as Record<string, unknown>)) {
      visit(entry, depth + 1);
    }
  };
  visit(payload, 0);
  return chunks.join(" ").replace(/\s+/g, " ").toLowerCase();
}

function hasMerchantSignal(payload: Record<string, unknown>, domains: string[]) {
  return Boolean(
    domains.length ||
      payload.merchant ||
      payload.merchant_name ||
      payload.merchantName ||
      payload.store ||
      payload.platform ||
      payload.service ||
      payload.provider_id ||
      payload.providerId,
  );
}

function approvalRuleReason(
  rules: string[],
  payload: Record<string, unknown>,
  domains: string[],
) {
  const text = orderSearchText(payload);
  if (rules.includes("unknown_merchant") && !hasMerchantSignal(payload, domains)) {
    return "This order needs approval because the merchant is not specified.";
  }
  if (rules.includes("subscription") && /\b(subscription|subscribe|recurring|monthly|annual|yearly|renewal)\b/.test(text)) {
    return "This order needs approval because it appears to involve a subscription or recurring charge.";
  }
  if (rules.includes("gift_card") && /\b(gift card|stored value|prepaid|voucher)\b/.test(text)) {
    return "This order needs approval because it appears to involve a gift card or stored value.";
  }
  if (rules.includes("travel") && /\b(flight|hotel|airbnb|reservation|rental car|train ticket|concert ticket|event ticket)\b/.test(text)) {
    return "This order needs approval because it appears to involve travel, ticketing, or reservations.";
  }
  if (rules.includes("regulated_goods") && /\b(alcohol|tobacco|vape|cannabis|weapon|firearm|ammo|prescription|pharmacy)\b/.test(text)) {
    return "This order needs approval because it appears to involve regulated goods.";
  }
  if (
    rules.includes("address_change") &&
    (payload.shipping_address ||
      payload.shippingAddress ||
      payload.delivery_address ||
      payload.deliveryAddress)
  ) {
    return "This order needs approval because it includes a delivery address.";
  }
  return null;
}

function startIsoForDays(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function reservedAgentSpendSince(params: {
  humanUserId: number;
  agentUsernameLower: string;
  sinceIso: string;
}) {
  await ensureOrderOrchestrationSchema();
  const result = await getTursoClient().execute({
    sql: `SELECT COALESCE(SUM(
              CASE
                WHEN captured_cents > 0 THEN captured_cents
                ELSE COALESCE(max_charge_cents, quoted_total_cents, 0)
              END
            ), 0) AS reserved_cents
          FROM ottoauth_orders
          WHERE human_user_id = ?
            AND agent_username_lower = ?
            AND created_at >= ?
            AND status NOT IN ('failed', 'canceled')`,
    args: [
      params.humanUserId,
      params.agentUsernameLower.trim().toLowerCase(),
      params.sinceIso,
    ],
  });
  return Number(
    (result.rows?.[0] as Record<string, unknown> | undefined)?.reserved_cents ?? 0,
  );
}

function makeMetadata(params: {
  policy: AgentMandatePolicyRecord;
  domains: string[];
  effectiveCapCents: number | null;
  decision: "allowed" | "blocked";
  reason?: string | null;
}): AgentMandateEvaluationMetadata {
  return {
    policy_id: params.policy.id,
    revision: params.policy.active_revision,
    mode: params.policy.mode,
    evaluated_at: new Date().toISOString(),
    effective_cap_cents: params.effectiveCapCents,
    detected_domains: params.domains,
    decision: params.decision,
    reason: params.reason ?? null,
  };
}

function blockedEvaluation(
  policy: AgentMandatePolicyRecord,
  domains: string[],
  effectiveCapCents: number | null,
  code: Exclude<AgentMandateEvaluation, { allowed: true }>["code"],
  reason: string,
): AgentMandateEvaluation {
  return {
    allowed: false,
    code,
    reason,
    policy,
    metadata: makeMetadata({
      policy,
      domains,
      effectiveCapCents,
      decision: "blocked",
      reason,
    }),
  };
}

export async function evaluateAgentMandateForOrder(params: {
  humanAgentLinkId: number;
  humanUserId: number;
  agentUsernameLower: string;
  payload: Record<string, unknown>;
  effectiveMaxChargeCents: number | null;
  priceQuote?: NonBrowserPriceQuote | null;
}): Promise<AgentMandateEvaluation> {
  const policy = await getPolicyForLinkId(params.humanAgentLinkId);
  const domains = Array.from(collectUrlDomains(params.payload));
  const effectiveCapCents =
    params.effectiveMaxChargeCents ??
    (params.priceQuote?.total_cents != null ? params.priceQuote.total_cents : null);

  if (policy.mode === "unrestricted") {
    return {
      allowed: true,
      policy,
      metadata: makeMetadata({
        policy,
        domains,
        effectiveCapCents,
        decision: "allowed",
      }),
    };
  }

  if (policy.mode === "paused") {
    return blockedEvaluation(
      policy,
      domains,
      effectiveCapCents,
      "agent_mandate_paused",
      "This agent is paused and cannot submit orders.",
    );
  }

  const blockedDomain = domains.find((domain) =>
    policy.blocked_domains.some((rule) => domainMatchesRule(domain, rule)),
  );
  if (blockedDomain) {
    return blockedEvaluation(
      policy,
      domains,
      effectiveCapCents,
      "agent_mandate_domain_blocked",
      `This agent is not allowed to order from ${blockedDomain}.`,
    );
  }

  if (policy.allowed_domains.length > 0) {
    const allowed = domains.some((domain) =>
      policy.allowed_domains.some((rule) => domainMatchesRule(domain, rule)),
    );
    if (!allowed) {
      return blockedEvaluation(
        policy,
        domains,
        effectiveCapCents,
        "agent_mandate_domain_not_allowed",
        domains.length
          ? `This agent is only allowed to order from ${policy.allowed_domains.join(", ")}.`
          : "This agent is restricted to allowed domains, but the order did not include a URL.",
      );
    }
  }

  if (
    policy.max_per_order_cents != null &&
    effectiveCapCents != null &&
    effectiveCapCents > policy.max_per_order_cents
  ) {
    return blockedEvaluation(
      policy,
      domains,
      effectiveCapCents,
      "agent_mandate_per_order_limit",
      `This order exceeds the agent's per-order mandate limit of ${policy.max_per_order_cents} cents.`,
    );
  }

  if (
    policy.require_approval_over_cents != null &&
    effectiveCapCents != null &&
    effectiveCapCents > policy.require_approval_over_cents
  ) {
    return blockedEvaluation(
      policy,
      domains,
      effectiveCapCents,
      "agent_mandate_approval_required",
      `This order needs approval because it exceeds ${policy.require_approval_over_cents} cents.`,
    );
  }

  const category = policy.blocked_categories.find((entry) =>
    orderSearchText(params.payload).includes(entry),
  );
  if (category) {
    return blockedEvaluation(
      policy,
      domains,
      effectiveCapCents,
      "agent_mandate_category_blocked",
      `This order matches the blocked mandate category "${category}".`,
    );
  }

  const approvalReason = approvalRuleReason(policy.approval_rules, params.payload, domains);
  if (approvalReason) {
    return blockedEvaluation(
      policy,
      domains,
      effectiveCapCents,
      "agent_mandate_approval_required",
      approvalReason,
    );
  }

  if (effectiveCapCents != null) {
    const rollingChecks: Array<{
      code: Exclude<AgentMandateEvaluation, { allowed: true }>["code"];
      label: string;
      limit: number | null;
      sinceIso: string;
    }> = [
      {
        code: "agent_mandate_daily_limit",
        label: "daily",
        limit: policy.max_daily_cents,
        sinceIso: startIsoForDays(1),
      },
      {
        code: "agent_mandate_weekly_limit",
        label: "weekly",
        limit: policy.max_weekly_cents,
        sinceIso: startIsoForDays(7),
      },
      {
        code: "agent_mandate_monthly_limit",
        label: "monthly",
        limit: policy.max_monthly_cents,
        sinceIso: startIsoForDays(30),
      },
    ];
    for (const check of rollingChecks) {
      if (check.limit == null) continue;
      const reserved = await reservedAgentSpendSince({
        humanUserId: params.humanUserId,
        agentUsernameLower: params.agentUsernameLower,
        sinceIso: check.sinceIso,
      });
      if (reserved + effectiveCapCents > check.limit) {
        return blockedEvaluation(
          policy,
          domains,
          effectiveCapCents,
          check.code,
          `This order would exceed the agent's ${check.label} mandate limit of ${check.limit} cents.`,
        );
      }
    }
  }

  return {
    allowed: true,
    policy,
    metadata: makeMetadata({
      policy,
      domains,
      effectiveCapCents,
      decision: "allowed",
    }),
  };
}

export function summarizeAgentMandate(policy: AgentMandatePolicyRecord) {
  if (policy.mode === "paused") return "Paused";
  if (policy.mode === "unrestricted") return "No custom limits";
  const parts: string[] = [];
  if (policy.max_per_order_cents != null) {
    parts.push(`per order $${(policy.max_per_order_cents / 100).toFixed(2)}`);
  }
  if (policy.max_daily_cents != null) {
    parts.push(`daily $${(policy.max_daily_cents / 100).toFixed(2)}`);
  }
  if (policy.allowed_domains.length > 0) {
    parts.push(`allowed ${policy.allowed_domains.length} domain${policy.allowed_domains.length === 1 ? "" : "s"}`);
  }
  if (policy.blocked_domains.length > 0) {
    parts.push(`blocked ${policy.blocked_domains.length} domain${policy.blocked_domains.length === 1 ? "" : "s"}`);
  }
  if (policy.approval_rules.length > 0) {
    parts.push(
      `asks first for ${policy.approval_rules
        .map((rule) => APPROVAL_RULE_LABELS[rule] || rule)
        .slice(0, 2)
        .join(", ")}`,
    );
  }
  return parts.length ? parts.join(" · ") : "Restricted";
}
