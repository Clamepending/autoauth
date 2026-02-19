import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { getOrdersByUsername } from "@/services/amazon/orders";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const orders = await getOrdersByUsername(auth.usernameLower);

  return NextResponse.json({
    orders: orders.map((o) => {
      const itemCents = o.estimated_price_cents;
      const taxCents = o.estimated_tax_cents ?? 0;
      const feeCents = o.processing_fee_cents ?? 0;
      const totalCents =
        itemCents != null ? itemCents + taxCents + feeCents : null;
      const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
      return {
        id: o.id,
        item_url: o.item_url,
        shipping_location: o.shipping_location,
        status: o.status,
        estimated_price: itemCents ? fmt(itemCents) : null,
        estimated_tax: taxCents ? fmt(taxCents) : null,
        processing_fee: feeCents ? fmt(feeCents) : null,
        estimated_total: totalCents ? fmt(totalCents) : null,
        product_title: o.product_title,
        created_at: o.created_at,
      };
    }),
  });
}
