import { NextResponse } from "next/server";
import { getOrderById } from "@/services/amazon/orders";
import { getBaseUrl } from "@/lib/base-url";

type Context = { params: { orderId: string } };

export async function GET(_request: Request, context: Context) {
  const orderId = Number(context.params.orderId);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });
  }

  const order = await getOrderById(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const baseUrl = getBaseUrl();
  const fmt = (c: number | null) => (c != null ? `$${(c / 100).toFixed(2)}` : null);

  return NextResponse.json({
    order_id: order.id,
    status: order.status,
    item_url: order.item_url,
    shipping_address: order.shipping_address || order.shipping_location,
    product_title: order.product_title,
    estimated_price: fmt(order.estimated_price_cents),
    estimated_tax: fmt(order.estimated_tax_cents),
    processing_fee: fmt(order.processing_fee_cents),
    amazon_total: fmt(order.amazon_total_cents),
    confirmation_number: order.confirmation_number,
    est_delivery: order.est_delivery,
    tracking_number: order.tracking_number,
    payment_url:
      order.status === "pending_payment"
        ? `${baseUrl}/pay/amazon/${order.id}`
        : null,
    created_at: order.created_at,
    updated_at: order.updated_at,
  });
}
