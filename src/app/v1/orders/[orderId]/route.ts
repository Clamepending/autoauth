import { NextResponse } from "next/server";

import {
  orderApiBody,
  readJsonObject,
  requireAgentOrderAccess,
} from "@/lib/order-api";
import {
  listOrderEvents,
  listOrderMessages,
} from "@/lib/order-orchestration";

type Context = { params: Promise<{ orderId: string }> };

async function showOrder(request: Request, payload: Record<string, unknown>, orderId: string) {
  const access = await requireAgentOrderAccess({ request, payload, orderId });
  if (!access.ok) return access.response;
  return NextResponse.json({
    ok: true,
    ...orderApiBody(access.order),
    events: await listOrderEvents(access.order.id, 100),
    messages: await listOrderMessages(access.order.id),
  });
}

export async function GET(request: Request, context: Context) {
  const { orderId } = await context.params;
  return showOrder(request, {}, orderId);
}

export async function POST(request: Request, context: Context) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const { orderId } = await context.params;
  return showOrder(request, body.payload, orderId);
}
