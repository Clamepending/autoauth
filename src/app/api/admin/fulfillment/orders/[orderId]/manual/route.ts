import { NextResponse } from "next/server";

import { requireAdminApiAccess } from "@/lib/admin-auth";
import {
  completeOrderManually,
  getOrderByPublicIdOrId,
  parseOrderForApi,
} from "@/lib/order-orchestration";

type Context = { params: Promise<{ orderId: string }> };

async function readJson(request: Request) {
  const payload = (await request.json().catch(() => null)) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}

function text(payload: Record<string, unknown>, keys: string[], maxLength = 4000) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, maxLength);
  }
  return null;
}

function cents(payload: Record<string, unknown>, centsKey: string, dollarsKey: string) {
  const centsValue = payload[centsKey];
  if (typeof centsValue === "number" && Number.isFinite(centsValue)) {
    return Math.max(0, Math.trunc(centsValue));
  }
  if (typeof centsValue === "string" && centsValue.trim()) {
    const parsed = Number(centsValue.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
  }
  const dollarsValue = payload[dollarsKey];
  if (typeof dollarsValue === "number" && Number.isFinite(dollarsValue)) {
    return Math.max(0, Math.round(dollarsValue * 100));
  }
  if (typeof dollarsValue === "string" && dollarsValue.trim()) {
    const parsed = Number(dollarsValue.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed * 100));
  }
  return 0;
}

function status(payload: Record<string, unknown>) {
  return payload.status === "failed" || payload.outcome === "failed"
    ? "failed"
    : "completed";
}

export async function POST(request: Request, context: Context) {
  const admin = await requireAdminApiAccess();
  if (!admin.ok) return admin.response;

  const payload = await readJson(request);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { orderId } = await context.params;
  const order = await getOrderByPublicIdOrId(orderId);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  try {
    const updated = await completeOrderManually({
      orderId: order.id,
      adminEmail: admin.email,
      status: status(payload),
      merchant: text(payload, ["merchant"], 500),
      summary: text(payload, ["summary"], 4000),
      error: text(payload, ["error"], 2000),
      currency: text(payload, ["currency"], 8),
      goodsCents: cents(payload, "goods_cents", "goods_dollars"),
      shippingCents: cents(payload, "shipping_cents", "shipping_dollars"),
      taxCents: cents(payload, "tax_cents", "tax_dollars"),
      otherCents: cents(payload, "other_cents", "other_dollars"),
      receiptUrl: text(payload, ["receipt_url", "receiptUrl"], 2000),
      receiptText: text(payload, ["receipt_text", "receiptText"], 6000),
      orderNumber: text(payload, ["order_number", "orderNumber"], 300),
      confirmationCode: text(payload, ["confirmation_code", "confirmationCode"], 300),
      pickupCode: text(payload, ["pickup_code", "pickupCode"], 300),
      trackingNumber: text(payload, ["tracking_number", "trackingNumber"], 300),
      trackingUrl: text(payload, ["tracking_url", "trackingUrl"], 2000),
      providerStatus: text(payload, ["provider_status", "providerStatus"], 300),
      deliveryEta: text(payload, ["delivery_eta", "deliveryEta"], 300),
      note: text(payload, ["note", "admin_notes", "adminNotes"], 4000),
    });
    return NextResponse.json({
      ok: true,
      order: updated ? parseOrderForApi(updated) : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Manual fulfillment failed.";
    const lower = message.toLowerCase();
    const statusCode =
      lower.includes("not found")
        ? 404
        : lower.includes("credit") || lower.includes("fund")
          ? 402
          : lower.includes("needs") || lower.includes("exceeds") || lower.includes("already")
            ? 409
            : 400;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
