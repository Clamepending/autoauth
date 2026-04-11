export type ModelUsageRecord = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  source?: string | null;
};

type ModelPrice = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

const DEFAULT_MODEL_PRICING: Record<string, ModelPrice> = {
  "claude-sonnet-4-5": {
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
  },
  "claude-haiku-4-5": {
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 5,
  },
};

let cachedPricing: Record<string, ModelPrice> | null = null;

function parsePricingConfig(): Record<string, ModelPrice> {
  if (cachedPricing) return cachedPricing;

  const raw = process.env.OTTOAUTH_MODEL_PRICING_JSON?.trim();
  if (!raw) {
    cachedPricing = DEFAULT_MODEL_PRICING;
    return cachedPricing;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, { inputPerMillionUsd?: number; outputPerMillionUsd?: number }>;
    const normalized = Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => Number.isFinite(value?.inputPerMillionUsd) && Number.isFinite(value?.outputPerMillionUsd))
        .map(([key, value]) => [
          key.trim().toLowerCase(),
          {
            inputPerMillionUsd: Number(value.inputPerMillionUsd),
            outputPerMillionUsd: Number(value.outputPerMillionUsd),
          },
        ]),
    );
    cachedPricing = Object.keys(normalized).length > 0 ? normalized : DEFAULT_MODEL_PRICING;
  } catch {
    cachedPricing = DEFAULT_MODEL_PRICING;
  }

  return cachedPricing;
}

function getPriceForModel(model: string): ModelPrice | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  const pricing = parsePricingConfig();
  const match = Object.keys(pricing)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => normalized.startsWith(prefix));
  return match ? pricing[match] : null;
}

export function calculateInferenceCostCents(usages: ModelUsageRecord[]) {
  let totalUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const details = usages.map((usage) => {
    const input = Math.max(0, Math.trunc(usage.input_tokens || 0));
    const output = Math.max(0, Math.trunc(usage.output_tokens || 0));
    totalInputTokens += input;
    totalOutputTokens += output;
    const price = getPriceForModel(usage.model);
    const usd = price
      ? (input / 1_000_000) * price.inputPerMillionUsd + (output / 1_000_000) * price.outputPerMillionUsd
      : 0;
    totalUsd += usd;
    return {
      ...usage,
      calculated_usd: usd,
      priced: Boolean(price),
    };
  });

  return {
    cents: Math.round(totalUsd * 100),
    totalInputTokens,
    totalOutputTokens,
    details,
  };
}
