import { NextResponse } from "next/server";
import { getOrderById } from "@/services/amazon/orders";

function toUsd(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid order id." }, { status: 400 });
  }

  const order = await getOrderById(id);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const itemCents = order.estimated_price_cents;
  const taxCents = order.estimated_tax_cents ?? 0;
  const feeCents = order.processing_fee_cents ?? 0;
  const totalCents = itemCents != null ? itemCents + taxCents + feeCents : null;

  return NextResponse.json({
    id: order.id,
    username: order.username_lower,
    status: order.status,
    item_url: order.item_url,
    product_title: order.product_title,
    shipping_location: order.shipping_location,
    estimated_price: toUsd(itemCents),
    estimated_tax: taxCents > 0 ? toUsd(taxCents) : null,
    processing_fee: feeCents > 0 ? toUsd(feeCents) : null,
    estimated_total: toUsd(totalCents),
    stripe_session_id: order.stripe_session_id,
    tracking_number: order.tracking_number,
    fulfillment_note: order.fulfillment_note,
    created_at: order.created_at,
    updated_at: order.updated_at,
  });
}
