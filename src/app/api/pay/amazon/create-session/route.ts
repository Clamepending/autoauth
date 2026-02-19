import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getOrderById,
  updateOrderStripeSession,
} from "@/services/amazon/orders";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { getBaseUrl } from "@/lib/base-url";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const orderId =
    typeof payload.order_id === "number"
      ? payload.order_id
      : Number(payload.order_id);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return NextResponse.json(
      { error: "Valid order_id is required." },
      { status: 400 },
    );
  }

  const order = await getOrderById(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  if (order.estimated_price_cents == null) {
    return NextResponse.json(
      {
        error:
          "Price is not available for this order. The product page could not be scraped. A human must review and set the price manually.",
      },
      { status: 422 },
    );
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Payment is not configured. Set STRIPE_SECRET_KEY." },
      { status: 503 },
    );
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Payment is not configured." },
      { status: 503 },
    );
  }

  const itemCents = order.estimated_price_cents;
  const taxCents = order.estimated_tax_cents ?? 0;
  const feeCents = order.processing_fee_cents ?? 0;
  const totalCents = itemCents + taxCents + feeCents;

  const productName = order.product_title
    ? `Amazon: ${order.product_title.slice(0, 100)}`
    : `Amazon order #${orderId}`;

  const baseUrl = getBaseUrl();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price_data: {
        currency: "usd",
        unit_amount: itemCents,
        product_data: {
          name: productName,
          description: order.item_url.slice(0, 200),
        },
      },
      quantity: 1,
    },
  ];

  if (taxCents > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: taxCents,
        product_data: {
          name: `Estimated sales tax${order.tax_state ? ` (${order.tax_state})` : ""}`,
        },
      },
      quantity: 1,
    });
  }

  if (feeCents > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: feeCents,
        product_data: {
          name: "Processing fee",
        },
      },
      quantity: 1,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: lineItems,
    success_url: `${baseUrl}/pay/amazon/${orderId}/success`,
    cancel_url: `${baseUrl}/pay/amazon/${orderId}`,
    client_reference_id: String(orderId),
    metadata: {
      order_id: String(orderId),
      item_cents: String(itemCents),
      tax_cents: String(taxCents),
      fee_cents: String(feeCents),
      total_cents: String(totalCents),
    },
  });

  await updateOrderStripeSession(orderId, session.id);

  const url = session.url;
  if (!url) {
    return NextResponse.json(
      { error: "Could not create checkout session." },
      { status: 500 },
    );
  }

  return NextResponse.json({ url });
}
