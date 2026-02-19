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
    orders: orders.map((o) => ({
      id: o.id,
      item_url: o.item_url,
      shipping_location: o.shipping_location,
      status: o.status,
      estimated_price: o.estimated_price_cents
        ? `$${(o.estimated_price_cents / 100).toFixed(2)}`
        : null,
      product_title: o.product_title,
      created_at: o.created_at,
    })),
  });
}
