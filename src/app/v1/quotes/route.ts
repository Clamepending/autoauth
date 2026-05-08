import { NextResponse } from "next/server";

import {
  authenticateOrderAgentFromRequest,
  readJsonObject,
  responseFromOrderError,
} from "@/lib/order-api";
import { normalizeOrderRequest } from "@/lib/order-orchestration";
import { resolveNonBrowserPriceQuote } from "@/lib/non-browser-price-quotes";

export const dynamic = "force-dynamic";

function optionalString(value: unknown, maxLength = 2000) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;

  const auth = await authenticateOrderAgentFromRequest(request, body.payload);
  if (!auth.ok) return auth.response;

  try {
    const normalized = normalizeOrderRequest(body.payload);
    const quote = await resolveNonBrowserPriceQuote({
      payload: body.payload,
      rawTask: normalized.task,
      taskPrompt: normalized.task,
      websiteUrl:
        normalized.storeUrl ??
        optionalString(body.payload.url ?? body.payload.product_url ?? body.payload.productUrl),
      merchantName: normalized.merchant ?? normalized.store,
      platformHint: optionalString(
        body.payload.platform_hint ??
          body.payload.platformHint ??
          body.payload.platform ??
          body.payload.service ??
          body.payload.store,
        120,
      ),
      requestJson: {
        ...body.payload,
        normalized: {
          kind: normalized.kind,
          store: normalized.store,
          merchant: normalized.merchant,
          title: normalized.title,
          task: normalized.task,
          order_type: normalized.orderType,
          store_url: normalized.storeUrl,
          pickup_location: normalized.pickupLocation,
          shipping_address_present: Boolean(normalized.shippingAddress),
        },
      },
    });

    return NextResponse.json({
      ok: true,
      quote,
      price_quote: quote,
      request: {
        kind: normalized.kind,
        store: normalized.store,
        merchant: normalized.merchant,
        title: normalized.title,
        task: normalized.task,
        order_type: normalized.orderType,
        store_url: normalized.storeUrl,
        pickup_location: normalized.pickupLocation,
        shipping_address_present: Boolean(normalized.shippingAddress),
      },
      note:
        "This endpoint never uses browser automation. If no price is available, create the order under a spend cap and OttoAuth will reconcile actual charges after fulfillment.",
    });
  } catch (error) {
    return responseFromOrderError(error, 400);
  }
}
