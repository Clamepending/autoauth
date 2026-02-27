import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getSnackpassOrderById,
  updateSnackpassOrderStripeSession,
} from "@/services/snackpass/orders";
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

  const order = await getSnackpassOrderById(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
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

  const baseCents = order.estimated_price_cents;
  const serviceFee = order.service_fee_cents ?? 0;
  const deliveryFee = order.delivery_fee_cents ?? 0;
  const taxCents = order.estimated_tax_cents ?? 0;
  const tipCents = order.tip_cents ?? 0;
  const processingFee = order.processing_fee_cents ?? 0;

  const baseUrl = getBaseUrl();
  const productName = `Snackpass: ${order.dish_name.slice(0, 100)}`;

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price_data: {
        currency: "usd",
        unit_amount: baseCents,
        product_data: {
          name: productName,
          description: order.restaurant_name.slice(0, 200),
        },
      },
      quantity: 1,
    },
  ];

  if (serviceFee > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: serviceFee,
        product_data: {
          name: "Service fee",
        },
      },
      quantity: 1,
    });
  }

  if (deliveryFee > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: deliveryFee,
        product_data: {
          name: "Delivery fee",
        },
      },
      quantity: 1,
    });
  }

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

  if (tipCents > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: tipCents,
        product_data: {
          name: "Tip",
        },
      },
      quantity: 1,
    });
  }

  if (processingFee > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        unit_amount: processingFee,
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
    success_url: `${baseUrl}/pay/snackpass/${orderId}/success`,
    cancel_url: `${baseUrl}/pay/snackpass/${orderId}`,
    client_reference_id: String(orderId),
    metadata: {
      order_id: String(orderId),
      order_kind: "snackpass",
    },
  });

  await updateSnackpassOrderStripeSession(orderId, session.id);

  const url = session.url;
  if (!url) {
    return NextResponse.json(
      { error: "Could not create checkout session." },
      { status: 500 },
    );
  }

  return NextResponse.json({ url });
}
