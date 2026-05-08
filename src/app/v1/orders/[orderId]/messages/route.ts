import { NextResponse } from "next/server";

import {
  readJsonObject,
  requireAgentOrderAccess,
  responseFromOrderError,
} from "@/lib/order-api";
import {
  createOrderMessage,
  listOrderMessages,
} from "@/lib/order-orchestration";

type Context = { params: Promise<{ orderId: string }> };

function text(payload: Record<string, unknown>, keys: string[], maxLength = 4000) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, maxLength);
  }
  return null;
}

export async function POST(request: Request, context: Context) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const message = text(body.payload, ["message", "body", "text"]);
  if (!message) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }
  const { orderId } = await context.params;
  const access = await requireAgentOrderAccess({
    request,
    payload: body.payload,
    orderId,
  });
  if (!access.ok) return access.response;

  try {
    const created = await createOrderMessage({
      orderId: access.order.id,
      channel: text(body.payload, ["channel"], 80) || "provider_vendor",
      authorType: "agent",
      authorLabel: access.auth.usernameLower,
      body: message,
    });
    return NextResponse.json({
      ok: true,
      message: created,
      messages: await listOrderMessages(access.order.id),
    });
  } catch (error) {
    return responseFromOrderError(error);
  }
}
