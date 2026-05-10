// Phase 2: credit refills go through vibe-id, not autoauth's local Stripe.
// This route stays at the same path so the existing /credits/refill UI
// keeps working with no client change. It just proxies to vibe-id
// /credits/topup, which creates the Stripe Checkout session against
// vibe-id's Stripe account (which holds the credit ledger).

import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";
import {
  parsePositiveInteger,
  validateRefillAmountCents,
} from "@/lib/credit-refill";
import { requireCurrentHumanUser } from "@/lib/human-session";
import { createTopupSession } from "@/lib/vibe-id-client";

export async function POST(request: Request) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const amountCents = parsePositiveInteger(payload.amount_cents);
  const amountError = validateRefillAmountCents(amountCents);
  if (amountError) {
    return NextResponse.json({ error: amountError }, { status: 400 });
  }

  const baseUrl = getBaseUrl();
  const topupResult = await createTopupSession({
    amountDollars: Math.floor((amountCents ?? 0) / 100),
    successUrl: `${baseUrl}/credits/refill/success?amount_cents=${amountCents}`,
    cancelUrl: `${baseUrl}/credits/refill`,
  });

  if (!topupResult.ok) {
    const message =
      topupResult.error === "stripe_not_configured"
        ? "Credit top-up is temporarily unavailable. Please try again shortly."
        : `Could not start checkout (${topupResult.error}).`;
    return NextResponse.json(
      { error: message },
      { status: topupResult.status >= 400 && topupResult.status < 500 ? topupResult.status : 502 },
    );
  }

  return NextResponse.json({ url: topupResult.checkoutUrl });
}
