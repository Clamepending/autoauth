/**
 * Calculate the processing fee needed to cover Stripe's cut.
 *
 * Stripe charges 2.9% + $0.30 per successful card charge.
 * To net the desired amount after fees, we solve:
 *   charge - (charge * 0.029 + 30) = desired
 *   charge * 0.971 = desired + 30
 *   charge = (desired + 30) / 0.971
 *
 * The fee is: charge - desired
 */

const STRIPE_PERCENT = 0.029;
const STRIPE_FLAT_CENTS = 30;

export function calculateProcessingFee(subtotalCents: number): {
  feeCents: number;
  totalCents: number;
} {
  const chargeNeeded = Math.ceil(
    (subtotalCents + STRIPE_FLAT_CENTS) / (1 - STRIPE_PERCENT),
  );
  const feeCents = chargeNeeded - subtotalCents;
  return { feeCents, totalCents: chargeNeeded };
}
