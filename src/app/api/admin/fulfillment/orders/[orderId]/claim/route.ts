import { NextResponse } from "next/server";

import {
  claimOrderForAdmin,
  getOrderByPublicIdOrId,
  parseOrderForApi,
} from "@/lib/order-orchestration";

type Context = { params: Promise<{ orderId: string }> };

async function readOptionalJson(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as unknown;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function adminEmail(payload: Record<string, unknown>) {
  return typeof payload.admin_email === "string" && payload.admin_email.trim()
    ? payload.admin_email.trim().toLowerCase()
    : "admin@ottoauth.local";
}

export async function POST(request: Request, context: Context) {
  const payload = await readOptionalJson(request);
  const { orderId } = await context.params;
  const order = await getOrderByPublicIdOrId(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  try {
    const claimed = await claimOrderForAdmin({
      orderId: order.id,
      adminEmail: adminEmail(payload),
    });
    return NextResponse.json({
      ok: true,
      order: claimed ? parseOrderForApi(claimed) : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Claim failed.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
