import Stripe from "stripe";
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getBaseUrl } from "@/lib/base-url";
import { notifySlackAmazonFulfillment, notifySlackSnackpassFulfillment } from "@/lib/slack";
import { getOrderById, updateOrderStatus } from "@/services/amazon/orders";
import { getSnackpassOrderById, updateSnackpassOrderStatus } from "@/services/snackpass/orders";

function toUsd(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

function parseOrderId(session: Stripe.Checkout.Session): number | null {
  const fromMetadata = session.metadata?.order_id ?? "";
  const fromClientRef = session.client_reference_id ?? "";
  const value = fromMetadata || fromClientRef;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOrderKind(session: Stripe.Checkout.Session): "amazon" | "snackpass" {
  const kind = session.metadata?.order_kind?.trim().toLowerCase();
  return kind === "snackpass" ? "snackpass" : "amazon";
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header." },
      { status: 400 },
    );
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = parseOrderId(session);
    if (orderId) {
      const kind = parseOrderKind(session);
      if (kind === "snackpass") {
        const order = await getSnackpassOrderById(orderId);
        if (order && order.status !== "Fulfilled" && order.status !== "Failed") {
          await updateSnackpassOrderStatus(orderId, "Paid");

          const taxCents = order.estimated_tax_cents ?? 0;
          const feeCents = order.processing_fee_cents ?? 0;
          const tipCents = order.tip_cents ?? 0;
          const serviceFee = order.service_fee_cents ?? 0;
          const deliveryFee = order.delivery_fee_cents ?? 0;
          const subtotal = order.estimated_price_cents + serviceFee + deliveryFee;
          const totalCents = subtotal + taxCents + feeCents + tipCents;

          await notifySlackSnackpassFulfillment({
            orderId: order.id,
            username: order.username_lower,
            dishName: order.dish_name,
            restaurantName: order.restaurant_name,
            orderType: order.order_type,
            shippingLocation: order.shipping_location,
            tipDisplay: tipCents > 0 ? toUsd(tipCents) : null,
            estimatedTotal: toUsd(totalCents),
            appUrl: getBaseUrl(),
          });
        }
      } else {
        const order = await getOrderById(orderId);
        if (order && order.status !== "Fulfilled" && order.status !== "Failed") {
          await updateOrderStatus(orderId, "Paid");

          const itemCents = order.estimated_price_cents;
          const taxCents = order.estimated_tax_cents ?? 0;
          const feeCents = order.processing_fee_cents ?? 0;
          const totalCents = itemCents != null ? itemCents + taxCents + feeCents : null;

          await notifySlackAmazonFulfillment({
            orderId: order.id,
            username: order.username_lower,
            productTitle: order.product_title,
            itemUrl: order.item_url,
            shippingLocation: order.shipping_location,
            estimatedTotal: toUsd(totalCents),
            appUrl: getBaseUrl(),
          });
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
