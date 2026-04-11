export function buildGenericTaskGoal(params: {
  originalPrompt: string;
  maxChargeCents: number;
}) {
  const spendCapUsd = `$${(params.maxChargeCents / 100).toFixed(2)}`;
  return `You are OttoAuth's browser fulfillment agent for a human-backed task.

The human has already pre-funded credits. Do not ask for a new payment approval screen. If this task involves a purchase and the total would stay within the spend cap, you may complete it.

Spend cap:
- Never complete a purchase above ${spendCapUsd}.
- If the total would exceed ${spendCapUsd}, stop before purchase and report a failure with the price you found.

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
