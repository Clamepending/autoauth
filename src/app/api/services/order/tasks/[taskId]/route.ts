import { NextResponse } from "next/server";

import {
  orderApiBody,
  readJsonObject,
  requireAgentOrderAccess,
} from "@/lib/order-api";
import {
  listOrderClarifications,
  listOrderEvents,
  listOrderMessages,
} from "@/lib/order-orchestration";

type Context = { params: Promise<{ taskId: string }> };

export async function POST(request: Request, context: Context) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const { taskId } = await context.params;
  const access = await requireAgentOrderAccess({
    request,
    payload: body.payload,
    orderId: taskId,
  });
  if (!access.ok) return access.response;

  return NextResponse.json({
    ok: true,
    ...orderApiBody(access.order),
    events: await listOrderEvents(access.order.id, 100),
    messages: await listOrderMessages(access.order.id),
    clarifications: await listOrderClarifications(access.order.id),
  });
}
