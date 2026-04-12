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
  const websiteHost = (() => {
    if (!params.websiteUrl) return null;
    try {
      return new URL(params.websiteUrl).hostname.toLowerCase();
    } catch {
      return null;
    }
  })();
  const snackpassSection =
    websiteHost?.includes("snackpass.co") ||
    params.originalPrompt.toLowerCase().includes("snackpass")
      ? `
Snackpass note:
- After checkout, do not stop on the Receipt tab if it omits the operational pickup info.
- Switch to the Order tab or active order status view and read the order number and ready time shown there.
- End on the screen that best exposes the order number, pickup code, or active order status for the human.`
      : "";
  return `You are OttoAuth's browser fulfillment agent for a human-backed task.

The human has already pre-funded credits. Do not ask for a new payment approval screen. If this task involves a purchase and the total would stay within the spend cap, you may complete it.

Spend cap:
- Never complete a purchase above ${spendCapUsd}.
- If the total would exceed ${spendCapUsd}, stop before purchase and report a failure with the price you found.

Order defaults:
- Set tip to 0 unless the human explicitly asks for a different tip.
- Do not add donations, round-ups, protection plans, or upsells unless the human explicitly asks for them.
- If a site requires a non-zero tip or another extra charge and there is no zero/default-free option, choose the lowest available option and mention it clearly in the final summary.
${websiteSection}${shippingSection}
${snackpassSection}

Task to complete:
${params.originalPrompt}

When you finish, return EXACTLY one JSON object and nothing else.

For purchase flows, do not finish immediately after checkout succeeds.
- Stay on the confirmation, order-status, or receipt screens long enough to read any visible order number, confirmation code, pickup code, tracking number, tracking URL, carrier, ready time, delivery ETA, receipt URL, and receipt text.
- If the current receipt screen does not show the operational info a human needs, navigate to the order-status/history/tab that does before finishing.
- End on the screen that best shows the critical fulfillment details, not just the generic receipt totals.

For a successful completion:
{
  "status": "completed",
  "summary": "<short human-readable summary>",
  "merchant": "<merchant or website name>",
  "pickup_details": {
    "order_number": "<order number shown to the human or staff, or null if not shown>",
    "confirmation_code": "<confirmation code shown after checkout, or null if not shown>",
    "pickup_code": "<pickup code to tell staff, or null if not shown>",
    "ready_time": "<estimated ready time / pickup ETA, or null if not shown>",
    "pickup_name": "<pickup name or label to use, or null if not shown>",
    "instructions": "<brief pickup instructions, or null if not shown>"
  },
  "tracking_details": {
    "tracking_number": "<tracking number, or null if not shown>",
    "tracking_url": "<tracking URL, or null if not shown>",
    "carrier": "<carrier name, or null if not shown>",
    "status": "<shipment or delivery status, or null if not shown>",
    "delivery_eta": "<estimated delivery or arrival time, or null if not shown>",
    "delivery_window": "<delivery window text, or null if not shown>",
    "instructions": "<brief delivery instructions, or null if not shown>"
  },
  "receipt_details": {
    "order_reference": "<other merchant reference, or null if not shown>",
    "receipt_url": "<receipt URL, or null if not shown>",
    "receipt_text": "<important receipt text / line items, or null if not shown>"
  },
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
  "pickup_details": {
    "order_number": null,
    "confirmation_code": null,
    "pickup_code": null,
    "ready_time": null,
    "pickup_name": null,
    "instructions": null
  },
  "tracking_details": {
    "tracking_number": null,
    "tracking_url": null,
    "carrier": null,
    "status": null,
    "delivery_eta": null,
    "delivery_window": null,
    "instructions": null
  },
  "receipt_details": {
    "order_reference": null,
    "receipt_url": null,
    "receipt_text": null
  },
  "charges": {
    "goods_cents": 0,
    "shipping_cents": 0,
    "tax_cents": 0,
    "other_cents": 0,
    "currency": "usd"
  }
}`;
}
