export type FulfillmentFailureCategory =
  | "needs_clarification"
  | "spend_cap_exceeded"
  | "location_or_address_missing"
  | "login_or_auth_required"
  | "captcha_or_bot_check"
  | "site_access_blocked"
  | "site_navigation_or_routing"
  | "item_unavailable"
  | "checkout_blocked"
  | "payment_blocked"
  | "policy_or_safety"
  | "network_or_timeout"
  | "unknown";

export type FulfillmentFailureStage =
  | "request_details"
  | "routing"
  | "login"
  | "search"
  | "selection"
  | "checkout"
  | "payment"
  | "site_access"
  | "completion"
  | "unknown";

export type FulfillmentFailureClassification = {
  category: FulfillmentFailureCategory;
  stage: FulfillmentFailureStage;
  retryable: boolean;
  suggested_action: string;
  matched_signals: string[];
};

type ClassificationRule = {
  category: FulfillmentFailureCategory;
  stage: FulfillmentFailureStage;
  retryable: boolean;
  suggestedAction: string;
  signals: string[];
};

const RULES: ClassificationRule[] = [
  {
    category: "needs_clarification",
    stage: "request_details",
    retryable: true,
    suggestedAction: "Ask the requester or submitting agent for the missing detail, then retry with that value in a structured field.",
    signals: [
      "clarification_requested",
      "please clarify",
      "need clarification",
      "need more information",
      "which option",
      "which size",
      "which color",
      "missing required",
    ],
  },
  {
    category: "spend_cap_exceeded",
    stage: "checkout",
    retryable: true,
    suggestedAction: "Raise max_charge_cents, choose a cheaper alternative, or retry with a stricter substitution policy.",
    signals: [
      "exceeds the spend cap",
      "above the spend cap",
      "over the spend cap",
      "total would exceed",
      "over budget",
      "too expensive",
    ],
  },
  {
    category: "location_or_address_missing",
    stage: "request_details",
    retryable: true,
    suggestedAction: "Retry with shipping_address, pickup_location, destination, dates, or fulfillment mode supplied explicitly.",
    signals: [
      "missing address",
      "delivery address",
      "shipping address",
      "pickup location",
      "search location",
      "destination",
      "dates are missing",
      "guest count",
      "traveler details",
      "cannot determine location",
    ],
  },
  {
    category: "login_or_auth_required",
    stage: "login",
    retryable: true,
    suggestedAction: "Open the fulfillment browser profile, sign into the site, resolve account verification, then retry.",
    signals: [
      "sign in",
      "signin",
      "log in",
      "login required",
      "account required",
      "authentication required",
      "two factor",
      "2fa",
      "verification code",
      "one-time code",
    ],
  },
  {
    category: "captcha_or_bot_check",
    stage: "site_access",
    retryable: true,
    suggestedAction: "Use a warmed signed-in browser profile or manually clear the CAPTCHA/security check before retrying.",
    signals: [
      "captcha",
      "robot",
      "unusual traffic",
      "visual verification",
      "automated security check",
      "security check",
      "prove you are human",
      "verify you are human",
      "cloudflare",
    ],
  },
  {
    category: "site_access_blocked",
    stage: "site_access",
    retryable: true,
    suggestedAction: "Retry from a healthy browser profile or alternate official entry URL; if it persists, mark this site/profile as blocked.",
    signals: [
      "access denied",
      "forbidden",
      "403",
      "blocked",
      "not available in your region",
      "temporarily unavailable",
      "rate limited",
    ],
  },
  {
    category: "site_navigation_or_routing",
    stage: "routing",
    retryable: true,
    suggestedAction: "Add or update the site playbook with a direct URL, search query, or routing rule for this merchant/site.",
    signals: [
      "could not find the store",
      "could not find merchant",
      "wrong store",
      "generic homepage",
      "no search bar",
      "search result",
      "dead end",
      "wrong website",
      "not the requested merchant",
    ],
  },
  {
    category: "item_unavailable",
    stage: "selection",
    retryable: true,
    suggestedAction: "Retry with an allowed substitution, alternate merchant, or clearer item variant.",
    signals: [
      "out of stock",
      "unavailable",
      "sold out",
      "not available",
      "item not found",
      "menu item missing",
      "no longer available",
    ],
  },
  {
    category: "checkout_blocked",
    stage: "checkout",
    retryable: true,
    suggestedAction: "Inspect the checkout blocker, then retry with the missing checkout detail or a warmed browser profile.",
    signals: [
      "checkout blocked",
      "could not checkout",
      "cannot checkout",
      "place order button disabled",
      "required modifier",
      "required field",
      "delivery window",
      "minimum order",
    ],
  },
  {
    category: "payment_blocked",
    stage: "payment",
    retryable: true,
    suggestedAction: "Ask the human to update the saved payment method or confirm the intended payment account, then retry.",
    signals: [
      "payment failed",
      "payment method",
      "card declined",
      "billing address",
      "cvv",
      "insufficient funds",
      "payment verification",
    ],
  },
  {
    category: "policy_or_safety",
    stage: "request_details",
    retryable: false,
    suggestedAction: "Do not retry this task without changing the request so it complies with OttoAuth safety and policy constraints.",
    signals: [
      "malicious",
      "fraud",
      "secret",
      "password",
      "private key",
      "policy",
      "not fulfill",
      "sensitive-data",
      "exfiltration",
    ],
  },
  {
    category: "network_or_timeout",
    stage: "site_access",
    retryable: true,
    suggestedAction: "Retry once from the same browser profile; if repeated, mark the site/profile as unhealthy.",
    signals: [
      "timeout",
      "timed out",
      "network error",
      "connection reset",
      "page crashed",
      "failed to load",
      "navigation failed",
    ],
  },
];

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function objectText(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(objectText);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(objectText);
  }
  return [];
}

function existingClassification(
  result: Record<string, unknown> | null | undefined,
): FulfillmentFailureClassification | null {
  const existing =
    result?.failure_classification && typeof result.failure_classification === "object"
      ? (result.failure_classification as Record<string, unknown>)
      : null;
  if (!existing) return null;
  const category = typeof existing.category === "string" ? existing.category : "";
  const stage = typeof existing.stage === "string" ? existing.stage : "";
  if (!category || !stage) return null;
  return {
    category: category as FulfillmentFailureCategory,
    stage: stage as FulfillmentFailureStage,
    retryable: Boolean(existing.retryable),
    suggested_action:
      typeof existing.suggested_action === "string"
        ? existing.suggested_action
        : "Review the task result before retrying.",
    matched_signals: Array.isArray(existing.matched_signals)
      ? existing.matched_signals.filter((signal): signal is string => typeof signal === "string")
      : [],
  };
}

export function classifyFulfillmentFailure(params: {
  taskPrompt?: string | null;
  websiteUrl?: string | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
}): FulfillmentFailureClassification {
  const existing = existingClassification(params.result);
  if (existing) return existing;

  const primaryHaystack = normalizeText(
    [
      params.error,
      ...objectText(params.result),
    ].join(" "),
  );
  const contextHaystack = normalizeText([params.websiteUrl, params.taskPrompt].join(" "));
  for (const rule of RULES) {
    const matchedSignals = rule.signals.filter((signal) =>
      primaryHaystack.includes(signal.toLowerCase()),
    );
    if (matchedSignals.length > 0) {
      return {
        category: rule.category,
        stage: rule.stage,
        retryable: rule.retryable,
        suggested_action: rule.suggestedAction,
        matched_signals: matchedSignals,
      };
    }
  }
  for (const rule of RULES) {
    const matchedSignals = rule.signals.filter((signal) =>
      contextHaystack.includes(signal.toLowerCase()),
    );
    if (matchedSignals.length > 0) {
      return {
        category: rule.category,
        stage: rule.stage,
        retryable: rule.retryable,
        suggested_action: rule.suggestedAction,
        matched_signals: matchedSignals,
      };
    }
  }

  return {
    category: "unknown",
    stage: "unknown",
    retryable: true,
    suggested_action:
      "Review the run events, latest snapshot, and task result, then add a more specific playbook rule or failure signal if this repeats.",
    matched_signals: [],
  };
}

export function extractFulfillmentFailureClassification(
  result: Record<string, unknown> | null | undefined,
): FulfillmentFailureClassification | null {
  return existingClassification(result);
}
