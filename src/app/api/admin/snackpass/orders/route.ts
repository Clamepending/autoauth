import { NextResponse } from "next/server";
import { listSnackpassOrders } from "@/services/snackpass/orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmt(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

export async function GET() {
  const orders = await listSnackpassOrders();
  return NextResponse.json(
    orders.map((o) => {
      const taxCents = o.estimated_tax_cents ?? 0;
      const feeCents = o.processing_fee_cents ?? 0;
      const tipCents = o.tip_cents ?? 0;
      const serviceFee = o.service_fee_cents ?? 0;
      const deliveryFee = o.delivery_fee_cents ?? 0;
      const subtotal = o.estimated_price_cents + serviceFee + deliveryFee;
      const total = subtotal + taxCents + feeCents + tipCents;

      return {
        id: o.id,
        username: o.username_lower,
        status: o.status,
        dish_name: o.dish_name,
        restaurant_name: o.restaurant_name,
        order_type: o.order_type,
        shipping_location: o.shipping_location,
        estimated_total: fmt(total),
        created_at: o.created_at,
        updated_at: o.updated_at,
      };
    }),
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    }
  );
}
