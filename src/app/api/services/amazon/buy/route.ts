import { NextResponse } from "next/server";
import { getAgentByUsername } from "@/lib/db";
import { createAmazonOrder } from "@/lib/db";
import { normalizeUsername, validateUsername, verifyPrivateKey } from "@/lib/agent-auth";
import { getBaseUrl } from "@/lib/base-url";

/**
 * POST /api/services/amazon/buy
 * Body: username, private_key, item_url, shipping_location
 * Returns: payment_url — URL to autoauth page to pay via Stripe/Google Pay (placeholder amount).
 */
export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawUsername = typeof payload.username === "string" ? payload.username.trim() : "";
  const privateKey = typeof payload.private_key === "string" ? payload.private_key.trim() : "";
  const itemUrl = typeof payload.item_url === "string" ? payload.item_url.trim() : "";
  const shippingLocation = typeof payload.shipping_location === "string" ? payload.shipping_location.trim() : "";

  const validation = validateUsername(rawUsername);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  if (!privateKey) {
    return NextResponse.json({ error: "private_key is required." }, { status: 400 });
  }
  if (!itemUrl) {
    return NextResponse.json({ error: "item_url is required." }, { status: 400 });
  }
  if (!shippingLocation) {
    return NextResponse.json({ error: "shipping_location is required." }, { status: 400 });
  }

  const usernameLower = normalizeUsername(rawUsername);
  const agent = await getAgentByUsername(usernameLower);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }
  if (!verifyPrivateKey(privateKey, agent.private_key)) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const order = await createAmazonOrder({
    usernameLower,
    itemUrl,
    shippingLocation,
  });

  const baseUrl = getBaseUrl();
  const paymentUrl = `${baseUrl}/pay/amazon/${order.id}`;

  return NextResponse.json({
    order_id: order.id,
    payment_url: paymentUrl,
    message:
      "Send the payment_url link to your human for payment. They open it in a browser to pay via Stripe / Google Pay (placeholder amount: $100).",
  });
}
