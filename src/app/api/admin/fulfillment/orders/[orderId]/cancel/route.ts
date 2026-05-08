import { NextResponse } from "next/server";

import { requireAdminApiAccess } from "@/lib/admin-auth";
import {
  cancelOrder,
  getOrderByPublicIdOrId,
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

  const { orderId } = await context.params;
  const order = await getOrderByPublicIdOrId(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  try {
    const reason =
      text(payload as Record<string, unknown>, ["reason", "cancel_reason", "cancelReason"]) ||
      "Canceled by admin.";
    const updated = await cancelOrder({
      orderId: order.id,
      reason,
      actor: admin.email,
    });
    return NextResponse.json({
      ok: true,
      order: updated ? parseOrderForApi(updated) : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cancel failed.";
    const lower = message.toLowerCase();
    const status = lower.includes("not found")
      ? 404
      : lower.includes("completed") || lower.includes("already")
        ? 409
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
