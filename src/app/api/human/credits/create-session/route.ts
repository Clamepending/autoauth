import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getBaseUrl } from "@/lib/base-url";
import {
  parsePositiveInteger,
  validateRefillAmountCents,
} from "@/lib/credit-refill";
import { requireCurrentHumanUser } from "@/lib/human-session";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

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
    return NextResponse.json(
      { error: amountError },
      { status: 400 },
    );
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe checkout is not configured." },
      { status: 503 },
    );
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe checkout is not configured." },
      { status: 503 },
    );
  }

  const baseUrl = getBaseUrl();
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        product_data: {
          name: "OttoAuth credit refill",
          description: `Add $${(amountCents / 100).toFixed(2)} in OttoAuth credits`,
        },
      },
      quantity: 1,
    },
  ];

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: lineItems,
    success_url: `${baseUrl}/credits/refill/success?amount_cents=${amountCents}`,
    cancel_url: `${baseUrl}/credits/refill`,
    customer_email: user.email,
    client_reference_id: `human:${user.id}`,
    metadata: {
      checkout_kind: "credit_refill",
      human_user_id: String(user.id),
      refill_cents: String(amountCents),
      human_email: user.email,
    },
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Could not create checkout session." },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: session.url });
}
