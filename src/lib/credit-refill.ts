export const MIN_REFILL_CENTS = 500;
export const MAX_REFILL_CENTS = 50000;

export function isCreditRefillSimulationEnabled() {
  if ((process.env.OTTOAUTH_ENABLE_REFILL_SIMULATION ?? "").trim() === "1") {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}

export function parsePositiveInteger(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : Math.trunc(value);
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Math.trunc(parsed);
}

export function validateRefillAmountCents(amountCents: number) {
  if (!Number.isInteger(amountCents)) {
    return "A whole-number refill amount is required.";
  }
  if (amountCents < MIN_REFILL_CENTS || amountCents > MAX_REFILL_CENTS) {
    return `Refill amount must be between $${(MIN_REFILL_CENTS / 100).toFixed(2)} and $${(
      MAX_REFILL_CENTS / 100
    ).toFixed(2)}.`;
  }
  return null;
}
