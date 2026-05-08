import { NextResponse } from "next/server";

import {
  authenticateOrderAgentFromRequest,
  createOrderForAgentRequest,
  orderApiBody,
  readJsonObject,
  responseFromOrderError,
} from "@/lib/order-api";
import { listOrderEvents, previewOrderRequest } from "@/lib/order-orchestration";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const { payload } = body;

  if (
    payload.dry_run === true ||
    payload.preview === true ||
    payload.validate_only === true ||
    payload.test_mode === true
  ) {
    try {
      const preview = previewOrderRequest(payload);
      return NextResponse.json({
        ok: true,
        dry_run: true,
        order_preview: preview,
        pricing: preview.pricing,
        note: "No order was created, no credits were checked, and no fulfillment was queued.",
      });
    } catch (error) {
      return responseFromOrderError(error, 400);
    }
  }

  const auth = await authenticateOrderAgentFromRequest(request, payload, {
    scope: "orders:create",
  });
  if (!auth.ok) return auth.response;

  const created = await createOrderForAgentRequest({
    request,
    payload,
    auth: auth.auth,
    resourcePath: new URL(request.url).pathname,
  });
  if (!created.ok) return created.response;

  const apiBody = orderApiBody(created.order);
  const response = NextResponse.json(
    {
      ok: true,
      reused: created.reused,
      ...apiBody,
      pricing: apiBody?.order?.pricing ?? null,
      mandate: created.mandate,
      events: await listOrderEvents(created.order.id, 20),
      linked_human: created.linkedHuman,
      human_credit_balance: `$${(created.availableAfterFunding / 100).toFixed(2)}`,
      x402_funded_cents: created.fundedCents,
      fulfillment: {
        provider: created.order.provider_id,
        mode: created.order.fulfillment_mode,
        status: created.order.status,
      },
      note:
        created.order.fulfillment_mode === "human_admin"
          ? "Order created in the human fulfillment queue. No automated provider adapter was queued."
          : "Order created and routed through the provider capability router.",
    },
    { status: created.reused ? 200 : 201 },
  );
  created.responseHeaders?.forEach((value, key) => response.headers.set(key, value));
  return response;
}
