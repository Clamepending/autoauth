import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { createOrder } from "@/services/amazon/orders";
import { scrapeAmazonPrice } from "@/services/amazon/scraper";
import { getBaseUrl } from "@/lib/base-url";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const itemUrl =
    typeof payload.item_url === "string" ? payload.item_url.trim() : "";
  const shippingLocation =
    typeof payload.shipping_location === "string"
      ? payload.shipping_location.trim()
      : "";

  if (!itemUrl) {
    return NextResponse.json(
      { error: "item_url is required." },
      { status: 400 },
    );
  }
  if (!shippingLocation) {
    return NextResponse.json(
      { error: "shipping_location is required." },
      { status: 400 },
    );
  }

  const scraped = await scrapeAmazonPrice(itemUrl);

  const order = await createOrder({
    usernameLower: auth.usernameLower,
    itemUrl,
    shippingLocation,
    estimatedPriceCents: scraped?.priceCents ?? null,
    productTitle: scraped?.productTitle ?? null,
  });

  const baseUrl = getBaseUrl();
  const paymentUrl = `${baseUrl}/pay/amazon/${order.id}`;

  if (!scraped) {
    return NextResponse.json(
      {
        order_id: order.id,
        payment_url: paymentUrl,
        estimated_price: null,
        product_title: null,
        scrape_failed: true,
        message:
          "Order created, but the price could not be scraped from the Amazon product page. " +
          "The payment page will not allow checkout until a human reviews and sets the price. " +
          "Send the payment_url to your human so they can see the order details.",
      },
      { status: 207 },
    );
  }

  return NextResponse.json({
    order_id: order.id,
    payment_url: paymentUrl,
    estimated_price: scraped.priceDisplay,
    product_title: scraped.productTitle,
    scrape_failed: false,
    message: `Order created. Estimated price: ${scraped.priceDisplay}. Send the payment_url to your human for payment.`,
  });
}
