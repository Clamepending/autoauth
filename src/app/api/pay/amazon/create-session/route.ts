import { NextResponse } from "next/server";
import { getAmazonOrderById, updateAmazonOrderStripeSession } from "@/lib/db";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { getBaseUrl } from "@/lib/base-url";

const PLACEHOLDER_AMOUNT_CENTS = 10000; // $100

/**
 * POST /api/pay/amazon/create-session
 * Body: { order_id: number }
 * Returns: { url: string } — Stripe Checkout URL (Google Pay / card). 503 if Stripe not configured.
 */
export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const orderId = typeof payload.order_id === "number" ? payload.order_id : Number(payload.order_id);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return NextResponse.json({ error: "Valid order_id is required." }, { status: 400 });
  }

  const order = await getAmazonOrderById(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Payment is not configured. Set STRIPE_SECRET_KEY." },
      { status: 503 }
    );
  }

  const baseUrl = getBaseUrl();
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Payment is not configured." },
      { status: 503 }
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: PLACEHOLDER_AMOUNT_CENTS,
          product_data: {
            name: `Amazon order #${orderId}`,
            description: order.item_url.slice(0, 200),
            images: [],
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${baseUrl}/pay/amazon/${orderId}/success`,
    cancel_url: `${baseUrl}/pay/amazon/${orderId}`,
    client_reference_id: String(orderId),
  });

  await updateAmazonOrderStripeSession(orderId, session.id);

  const url = session.url;
  if (!url) {
    return NextResponse.json(
      { error: "Could not create checkout session." },
      { status: 500 }
    );
  }

  return NextResponse.json({ url });
}
