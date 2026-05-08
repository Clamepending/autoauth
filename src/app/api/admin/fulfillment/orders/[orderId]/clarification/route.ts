import { NextResponse } from "next/server";

import { requireAdminApiAccess } from "@/lib/admin-auth";
import {
  createOrderClarification,
  getOrderByPublicIdOrId,
  listOrderClarifications,
  listOrderEvents,
  parseOrderForApi,
} from "@/lib/order-orchestration";

type Context = { params: Promise<{ orderId: string }> };

function text(payload: Record<string, unknown>, keys: string[], maxLength = 2000) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, maxLength);
  }
  return "";
}

export async function POST(request: Request, context: Context) {
  const admin = await requireAdminApiAccess();
  if (!admin.ok) return admin.response;

  const payload = (await request.json().catch(() => null)) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = text(payload as Record<string, unknown>, ["question", "message", "body"]);
  if (!question) {
    return NextResponse.json({ error: "question is required." }, { status: 400 });
  }

  const { orderId } = await context.params;
  const order = await getOrderByPublicIdOrId(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  try {
    const created = await createOrderClarification({
      orderId: order.id,
      question,
      requestedBy: admin.email,
    });
    const updated = await getOrderByPublicIdOrId(order.public_id);
    return NextResponse.json({
      ok: true,
      clarification: created,
      order: updated ? parseOrderForApi(updated) : null,
      clarifications: await listOrderClarifications(order.id),
      events: await listOrderEvents(order.id, 50),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clarification failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
