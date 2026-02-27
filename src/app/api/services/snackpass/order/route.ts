import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { calculateProcessingFee } from "@/services/_shared/pricing";
import { estimateTax } from "@/services/amazon/tax";
import { getBaseUrl } from "@/lib/base-url";
import { createAgentRequest } from "@/lib/db";
import { notifySlack } from "@/lib/slack";
import { getSnackpassDefaultFees } from "@/services/snackpass/pricing";
import {
  searchMenuItems,
  type SnackpassMenuItemRecord,
} from "@/services/snackpass/menu";
import { createSnackpassOrder } from "@/services/snackpass/orders";

function fmt(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

function parseTipCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string" && value.trim()) {
    const num = Number(value);
    if (Number.isFinite(num)) return Math.max(0, Math.round(num));
  }
  return null;
}

function normalizeOrderType(value: unknown): "pickup" | "delivery" {
  if (typeof value !== "string") return "pickup";
  const normalized = value.trim().toLowerCase();
  return normalized === "delivery" ? "delivery" : "pickup";
}

function serializeMatch(item: SnackpassMenuItemRecord) {
  return {
    id: item.id,
    dish_name: item.dish_name,
    restaurant_name: item.restaurant_name,
    restaurant_address: item.restaurant_address,
    base_price: fmt(item.base_price_cents),
    service_fee: fmt(item.service_fee_cents),
    delivery_fee: fmt(item.delivery_fee_cents),
  };
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const dishName = typeof payload.dish_name === "string" ? payload.dish_name.trim() : "";
  const restaurantName = typeof payload.restaurant_name === "string" ? payload.restaurant_name.trim() : "";
  const shippingLocation = typeof payload.shipping_location === "string" ? payload.shipping_location.trim() : "";
  const deliveryInstructions = typeof payload.delivery_instructions === "string"
    ? payload.delivery_instructions.trim()
    : "";
  const orderType = normalizeOrderType(payload.order_type);
  const tipCents = parseTipCents(payload.tip_cents);

  if (!dishName) {
    return NextResponse.json({ error: "dish_name is required." }, { status: 400 });
  }
  if (!shippingLocation) {
    return NextResponse.json({ error: "shipping_location is required." }, { status: 400 });
  }

  const matches = await searchMenuItems({
    dishQuery: dishName,
    restaurantQuery: restaurantName || undefined,
    limit: 8,
  });

  if (!matches.length) {
    const record = await createAgentRequest({
      usernameLower: auth.usernameLower,
      requestType: "snackpass",
      message: `Missing dish: ${dishName}${restaurantName ? ` from ${restaurantName}` : ""}. Shipping: ${shippingLocation}.`,
    });

    const baseUrl = getBaseUrl();
    await notifySlack({
      agentDisplay: auth.agent.username_display,
      requestType: "snackpass",
      message: record.message,
      requestId: record.id,
      appUrl: baseUrl,
    }).catch((err) => console.error("[slack] notify failed:", err));

    return NextResponse.json(
      {
        error: "Dish not found in Snackpass catalog.",
        request_id: record.id,
        message: "We created a manual request to add this dish. Ask your human for more details or wait for an update.",
      },
      { status: 404 }
    );
  }

  if (!restaurantName && matches.length > 1) {
    return NextResponse.json(
      {
        error: "Multiple matches found. Please specify restaurant_name.",
        matches: matches.map(serializeMatch),
        message: "Multiple dishes match your request. Please provide restaurant_name and retry.",
      },
      { status: 409 }
    );
  }

  const match = matches[0];
  const { serviceFeeCents: defaultServiceFee, deliveryFeeCents: defaultDeliveryFee } = getSnackpassDefaultFees();

  const serviceFeeCents = match.service_fee_cents ?? defaultServiceFee;
  const deliveryFeeCents = match.delivery_fee_cents ?? (orderType === "delivery" ? defaultDeliveryFee : 0);

  const taxableSubtotal = match.base_price_cents + serviceFeeCents + deliveryFeeCents;
  const taxInfo = estimateTax(taxableSubtotal, shippingLocation);
  const tip = tipCents ?? 0;
  const totalBeforeProcessing = taxInfo.totalCents + tip;
  const fee = calculateProcessingFee(totalBeforeProcessing);

  const order = await createSnackpassOrder({
    usernameLower: auth.usernameLower,
    menuItemId: match.id,
    dishName: match.dish_name,
    restaurantName: match.restaurant_name,
    shippingLocation,
    orderType,
    deliveryInstructions: deliveryInstructions || null,
    tipCents: tipCents ?? null,
    serviceFeeCents,
    deliveryFeeCents,
    estimatedPriceCents: match.base_price_cents,
    estimatedTaxCents: taxInfo.taxCents,
    processingFeeCents: fee.feeCents,
    taxState: taxInfo.state ?? null,
  });

  const baseUrl = getBaseUrl();
  const paymentUrl = `${baseUrl}/pay/snackpass/${order.id}`;

  return NextResponse.json({
    order_id: order.id,
    payment_url: paymentUrl,
    dish_name: match.dish_name,
    restaurant_name: match.restaurant_name,
    estimated_price: fmt(match.base_price_cents),
    estimated_tax: fmt(taxInfo.taxCents),
    service_fee: fmt(serviceFeeCents),
    delivery_fee: fmt(deliveryFeeCents),
    tip: tipCents != null ? fmt(tipCents) : null,
    processing_fee: fmt(fee.feeCents),
    estimated_total: fmt(fee.totalCents),
    tax_state: taxInfo.state,
    order_type: orderType,
    message: "Order created. Send the payment_url to your human for payment approval.",
  });
}
