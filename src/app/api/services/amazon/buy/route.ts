import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { calculateProcessingFee } from "@/services/_shared/pricing";
import { createOrder } from "@/services/amazon/orders";
import { scrapeAmazonPrice } from "@/services/amazon/scraper";
import { estimateTax } from "@/services/amazon/tax";
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

  let taxInfo: ReturnType<typeof estimateTax> | null = null;
  let feeCents = 0;
  let chargeTotal = 0;
  if (scraped) {
    taxInfo = estimateTax(scraped.priceCents, shippingLocation);
    const fee = calculateProcessingFee(taxInfo.totalCents);
    feeCents = fee.feeCents;
    chargeTotal = fee.totalCents;
  }

  const order = await createOrder({
    usernameLower: auth.usernameLower,
    itemUrl,
    shippingLocation,
    estimatedPriceCents: scraped?.priceCents ?? null,
    estimatedTaxCents: taxInfo?.taxCents ?? null,
    processingFeeCents: feeCents || null,
    taxState: taxInfo?.state ?? null,
    productTitle: scraped?.productTitle ?? null,
  });

  const baseUrl = getBaseUrl();
  const paymentUrl = `${baseUrl}/pay/amazon/${order.id}`;

  if (!scraped || !taxInfo) {
    return NextResponse.json(
      {
        order_id: order.id,
        payment_url: paymentUrl,
        estimated_price: null,
        estimated_tax: null,
        processing_fee: null,
        estimated_total: null,
        product_title: null,
        scrape_failed: true,
        message: "Price scraping failed. Try another product.",
      },
      { status: 207 },
    );
  }

  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

  return NextResponse.json({
    order_id: order.id,
    payment_url: paymentUrl,
    estimated_price: fmt(scraped.priceCents),
    estimated_tax: fmt(taxInfo.taxCents),
    processing_fee: fmt(feeCents),
    estimated_total: fmt(chargeTotal),
    tax_state: taxInfo.state,
    product_title: scraped.productTitle,
    scrape_failed: false,
    message:
      `Order created. Item: ${fmt(scraped.priceCents)}, est. tax: ${fmt(taxInfo.taxCents)}, ` +
      `processing fee: ${fmt(feeCents)}, total: ${fmt(chargeTotal)}. ` +
      `Send the payment_url to your human for payment.`,
  });
}
