import { NextResponse } from "next/server";

import {
  orderApiBody,
  readJsonObject,
  requireAgentOrderAccess,
  responseFromOrderError,
} from "@/lib/order-api";
import { cancelOrder, listOrderEvents } from "@/lib/order-orchestration";

type Context = { params: Promise<{ orderId: string }> };

function reasonFrom(payload: Record<string, unknown>) {
  const value = payload.reason;
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 1000)
    : "Order canceled by the submitting agent.";
}

export async function POST(request: Request, context: Context) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const { orderId } = await context.params;
  const access = await requireAgentOrderAccess({
    request,
    payload: body.payload,
    orderId,
  });
  if (!access.ok) return access.response;

  try {
    const order = await cancelOrder({
      orderId: access.order.id,
      reason: reasonFrom(body.payload),
      actor: access.auth.usernameLower,
    });
    return NextResponse.json({
      ok: true,
      cancelled: order?.status === "canceled",
      ...orderApiBody(order),
      events: await listOrderEvents(access.order.id, 100),
    });
  } catch (error) {
    return responseFromOrderError(error);
  }
}
