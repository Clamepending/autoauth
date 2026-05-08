import { NextResponse } from "next/server";

import {
  readJsonObject,
  requireAgentOrderAccess,
} from "@/lib/order-api";
import { listOrderEvents } from "@/lib/order-orchestration";

type Context = { params: Promise<{ runId: string }> };

function limitFrom(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 100;
}

export async function POST(request: Request, context: Context) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const { runId } = await context.params;
  const access = await requireAgentOrderAccess({
    request,
    payload: body.payload,
    orderId: runId,
  });
  if (!access.ok) return access.response;
  return NextResponse.json({
    ok: true,
    order_id: access.order.public_id,
    events: await listOrderEvents(access.order.id, limitFrom(body.payload.limit)),
  });
}
