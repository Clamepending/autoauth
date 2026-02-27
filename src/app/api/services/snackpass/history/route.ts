import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { getSnackpassOrdersByUsername } from "@/services/snackpass/orders";

function fmt(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const orders = await getSnackpassOrdersByUsername(auth.usernameLower);

  return NextResponse.json({
    orders: orders.map((o) => {
      const taxCents = o.estimated_tax_cents ?? 0;
      const feeCents = o.processing_fee_cents ?? 0;
      const tipCents = o.tip_cents ?? 0;
      const serviceFee = o.service_fee_cents ?? 0;
      const deliveryFee = o.delivery_fee_cents ?? 0;
      const subtotal = o.estimated_price_cents + serviceFee + deliveryFee;
      const total = subtotal + taxCents + feeCents + tipCents;

      return {
        id: o.id,
        dish_name: o.dish_name,
        restaurant_name: o.restaurant_name,
        shipping_location: o.shipping_location,
        order_type: o.order_type,
        status: o.status,
        estimated_price: fmt(o.estimated_price_cents),
        estimated_tax: fmt(taxCents),
        service_fee: fmt(serviceFee),
        delivery_fee: fmt(deliveryFee),
        tip: tipCents ? fmt(tipCents) : null,
        processing_fee: fmt(feeCents),
        estimated_total: fmt(total),
        tax_state: o.tax_state,
        fulfillment_note: o.fulfillment_note,
        created_at: o.created_at,
        updated_at: o.updated_at,
      };
    }),
  });
}
