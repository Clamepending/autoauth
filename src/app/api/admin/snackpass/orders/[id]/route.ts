import { NextResponse } from "next/server";
import { getSnackpassOrderById } from "@/services/snackpass/orders";

function fmt(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid order id." }, { status: 400 });
  }

  const order = await getSnackpassOrderById(id);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const taxCents = order.estimated_tax_cents ?? 0;
  const feeCents = order.processing_fee_cents ?? 0;
  const tipCents = order.tip_cents ?? 0;
  const serviceFee = order.service_fee_cents ?? 0;
  const deliveryFee = order.delivery_fee_cents ?? 0;
  const subtotal = order.estimated_price_cents + serviceFee + deliveryFee;
  const total = subtotal + taxCents + feeCents + tipCents;

  return NextResponse.json({
    id: order.id,
    username: order.username_lower,
    status: order.status,
    dish_name: order.dish_name,
    restaurant_name: order.restaurant_name,
    shipping_location: order.shipping_location,
    order_type: order.order_type,
    delivery_instructions: order.delivery_instructions,
    estimated_price: fmt(order.estimated_price_cents),
    estimated_tax: fmt(taxCents),
    service_fee: fmt(serviceFee),
    delivery_fee: fmt(deliveryFee),
    tip: tipCents ? fmt(tipCents) : null,
    processing_fee: fmt(feeCents),
    estimated_total: fmt(total),
    tax_state: order.tax_state,
    stripe_session_id: order.stripe_session_id,
    fulfillment_note: order.fulfillment_note,
    created_at: order.created_at,
    updated_at: order.updated_at,
  });
}
