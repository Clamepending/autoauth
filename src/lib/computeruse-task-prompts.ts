const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

export function normalizeOptionalWebsiteUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.length > 2000) {
    throw new Error("website_url is too long.");
  }

  const candidate = URL_SCHEME_PATTERN.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("website_url must be a valid http or https URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("website_url must use http or https.");
  }
  return parsed.toString();
}

export function normalizeOptionalShippingAddress(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;
  if (normalized.length > 2000) {
    throw new Error("shipping_address is too long.");
  }
  return normalized;
}

export function buildGenericTaskGoal(params: {
  originalPrompt: string;
  maxChargeCents: number;
  websiteUrl?: string | null;
  shippingAddress?: string | null;
}) {
  const spendCapUsd = `$${(params.maxChargeCents / 100).toFixed(2)}`;
  const websiteSection = params.websiteUrl
    ? `
Preferred website:
- Start on ${params.websiteUrl}.
- Stay on that website unless the task clearly requires leaving it.`
    : "";
  const shippingSection = params.shippingAddress
    ? `
Shipping address:
- If a checkout flow asks for a shipping address, use this address exactly as written.
- Do not invent missing fields.

${params.shippingAddress}`
    : "";
  return `You are OttoAuth's browser fulfillment agent for a human-backed task.

The human has already pre-funded credits. Do not ask for a new payment approval screen. If this task involves a purchase and the total would stay within the spend cap, you may complete it.

Spend cap:
- Never complete a purchase above ${spendCapUsd}.
- If the total would exceed ${spendCapUsd}, stop before purchase and report a failure with the price you found.
${websiteSection}${shippingSection}

Task to complete:
${params.originalPrompt}

When you finish, return EXACTLY one JSON object and nothing else.

For a successful completion:
{
  "status": "completed",
  "summary": "<short human-readable summary>",
  "merchant": "<merchant or website name>",
  "charges": {
    "goods_cents": <integer>,
    "shipping_cents": <integer>,
    "tax_cents": <integer>,
    "other_cents": <integer>,
    "currency": "usd"
  }
}

If no purchase happened, set all charge fields to 0.

If the task fails or would exceed the cap:
{
  "status": "failed",
  "summary": "<short failure summary>",
  "error": "<clear error message>",
  "merchant": "<merchant or website name if known>",
  "charges": {
    "goods_cents": 0,
    "shipping_cents": 0,
    "tax_cents": 0,
    "other_cents": 0,
    "currency": "usd"
  }
}`;
}
