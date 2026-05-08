import { NextResponse } from "next/server";

import {
  orderApiBody,
  readJsonObject,
  requireAgentOrderAccess,
  responseFromOrderError,
} from "@/lib/order-api";
import { approveOrder, listOrderEvents } from "@/lib/order-orchestration";

type Context = { params: Promise<{ orderId: string }> };

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
    const order = await approveOrder({
      orderId: access.order.id,
      actor: access.auth.usernameLower,
    });
    return NextResponse.json({
      ok: true,
      ...orderApiBody(order),
      events: await listOrderEvents(access.order.id, 100),
    });
  } catch (error) {
    return responseFromOrderError(error);
  }
}
