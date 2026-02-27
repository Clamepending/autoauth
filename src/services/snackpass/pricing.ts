function parseCentsEnv(key: string): number | null {
  const raw = process.env[key]?.trim();
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? Math.round(num) : null;
}

export function getSnackpassDefaultFees(): {
  serviceFeeCents: number;
  deliveryFeeCents: number;
} {
  const serviceFee = parseCentsEnv("SNACKPASS_SERVICE_FEE_CENTS") ?? 0;
  const deliveryFee = parseCentsEnv("SNACKPASS_DELIVERY_FEE_CENTS") ?? 0;
  return {
    serviceFeeCents: Math.max(0, serviceFee),
    deliveryFeeCents: Math.max(0, deliveryFee),
  };
}
