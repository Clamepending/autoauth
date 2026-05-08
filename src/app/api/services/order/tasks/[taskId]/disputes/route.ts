import { NextResponse } from "next/server";

import {
  orderApiBody,
  readJsonObject,
  requireAgentOrderAccess,
  responseFromOrderError,
} from "@/lib/order-api";
import {
  createOrderDispute,
  getOrderById,
  listOrderEvents,
} from "@/lib/order-orchestration";

type Context = { params: Promise<{ taskId: string }> };

function text(payload: Record<string, unknown>, keys: string[], maxLength = 1000) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, maxLength);
  }
  return null;
}

export async function POST(request: Request, context: Context) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const reason = text(body.payload, ["reason", "issue"], 200);
  if (!reason) {
    return NextResponse.json({ error: "reason is required." }, { status: 400 });
  }
  const { taskId } = await context.params;
  const access = await requireAgentOrderAccess({
    request,
    payload: body.payload,
    orderId: taskId,
  });
  if (!access.ok) return access.response;

  try {
    const dispute = await createOrderDispute({
      orderId: access.order.id,
      reason,
      requestedResolution: text(body.payload, [
        "requested_resolution",
        "requestedResolution",
        "resolution",
      ]),
      evidence: body.payload.evidence ?? null,
    });
    const order = await getOrderById(access.order.id);
    return NextResponse.json({
      ok: true,
      dispute,
      ...orderApiBody(order),
      events: await listOrderEvents(access.order.id, 100),
    });
  } catch (error) {
    return responseFromOrderError(error);
  }
}
