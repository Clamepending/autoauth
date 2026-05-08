import { NextResponse } from "next/server";

import { requireAdminApiAccess } from "@/lib/admin-auth";
import {
  createOrderMessage,
  getOrderByPublicIdOrId,
  listOrderEvents,
  listOrderMessages,
  parseOrderForApi,
} from "@/lib/order-orchestration";

type Context = { params: Promise<{ orderId: string }> };

function text(payload: Record<string, unknown>, keys: string[], maxLength = 4000) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, maxLength);
  }
  return "";
}

function channel(payload: Record<string, unknown>) {
  const raw = text(payload, ["channel"], 80).toLowerCase();
  return raw || "requester";
}

export async function POST(request: Request, context: Context) {
  const admin = await requireAdminApiAccess();
  if (!admin.ok) return admin.response;

  const payload = (await request.json().catch(() => null)) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const record = payload as Record<string, unknown>;
  const body = text(record, ["message", "body", "note"]);
  if (!body) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }

  const { orderId } = await context.params;
  const order = await getOrderByPublicIdOrId(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  try {
    const created = await createOrderMessage({
      orderId: order.id,
      channel: channel(record),
      authorType: "admin",
      authorLabel: admin.email,
      body,
    });
    return NextResponse.json({
      ok: true,
      message: created,
      order: parseOrderForApi(order),
      messages: await listOrderMessages(order.id),
      events: await listOrderEvents(order.id, 50),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Message failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
