import { NextResponse } from "next/server";

import {
  authenticateOrderAgentFromRequest,
  createOrderForAgentRequest,
  orderApiBody,
  readJsonObject,
  responseFromOrderError,
} from "@/lib/order-api";
import {
  listOrderEvents,
  listOrdersForAgent,
  parseOrderForApi,
  previewOrderRequest,
} from "@/lib/order-orchestration";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authenticateOrderAgentFromRequest(request, {});
  if (!auth.ok) return auth.response;
  const orders = await listOrdersForAgent(auth.auth.usernameLower, 100);
  return NextResponse.json({
    ok: true,
    orders: orders.map(parseOrderForApi),
  });
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;

  if (
    body.payload.dry_run === true ||
    body.payload.preview === true ||
    body.payload.validate_only === true ||
    body.payload.test_mode === true
  ) {
    try {
      return NextResponse.json({
        ok: true,
        dry_run: true,
        order_preview: previewOrderRequest(body.payload),
        note: "No order was created, no credits were checked, and no fulfillment was queued.",
      });
    } catch (error) {
      return responseFromOrderError(error, 400);
    }
  }

  const auth = await authenticateOrderAgentFromRequest(request, body.payload);
  if (!auth.ok) return auth.response;

  const created = await createOrderForAgentRequest({
    request,
    payload: body.payload,
    auth: auth.auth,
    resourcePath: new URL(request.url).pathname,
  });
  if (!created.ok) return created.response;

  const response = NextResponse.json(
    {
      ok: true,
      reused: created.reused,
      ...orderApiBody(created.order),
      events: await listOrderEvents(created.order.id, 20),
    },
    { status: created.reused ? 200 : 201 },
  );
  created.responseHeaders?.forEach((value, key) => response.headers.set(key, value));
  return response;
}
