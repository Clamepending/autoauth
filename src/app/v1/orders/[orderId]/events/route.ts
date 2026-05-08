import { NextResponse } from "next/server";

import {
  readJsonObject,
  requireAgentOrderAccess,
} from "@/lib/order-api";
import { listOrderEvents } from "@/lib/order-orchestration";

type Context = { params: Promise<{ orderId: string }> };

function limitFrom(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 100;
}

async function listEvents(
  request: Request,
  payload: Record<string, unknown>,
  orderId: string,
) {
  const access = await requireAgentOrderAccess({ request, payload, orderId });
  if (!access.ok) return access.response;
  return NextResponse.json({
    ok: true,
    events: await listOrderEvents(access.order.id, limitFrom(payload.limit)),
  });
}

export async function GET(request: Request, context: Context) {
  const { orderId } = await context.params;
  return listEvents(request, {}, orderId);
}

export async function POST(request: Request, context: Context) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const { orderId } = await context.params;
  return listEvents(request, body.payload, orderId);
}
