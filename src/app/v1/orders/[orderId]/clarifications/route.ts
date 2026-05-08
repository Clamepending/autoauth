import { NextResponse } from "next/server";

import {
  orderApiBody,
  readJsonObject,
  requireAgentOrderAccess,
  responseFromOrderError,
} from "@/lib/order-api";
import {
  createOrderClarification,
  getOrderById,
  listOrderEvents,
  respondToOrderClarification,
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
  const { orderId } = await context.params;
  const access = await requireAgentOrderAccess({
    request,
    payload: body.payload,
    orderId,
  });
  if (!access.ok) return access.response;

  try {
    const question = text(body.payload, ["question"], 2000);
    if (question) {
      const clarification = await createOrderClarification({
        orderId: access.order.id,
        question,
        requestedBy: access.auth.usernameLower,
      });
      const order = await getOrderById(access.order.id);
      return NextResponse.json({
        ok: true,
        clarification,
        ...orderApiBody(order),
        events: await listOrderEvents(access.order.id, 100),
      });
    }

    const response = text(body.payload, [
      "clarification_response",
      "clarificationResponse",
      "response",
      "answer",
    ]);
    if (!response) {
      return NextResponse.json(
        { error: "question or clarification_response is required." },
        { status: 400 },
      );
    }
    const rawClarificationId =
      body.payload.clarification_id ?? body.payload.clarificationId;
    const clarificationId =
      rawClarificationId == null || rawClarificationId === ""
        ? null
        : Number(rawClarificationId);
    const order = await respondToOrderClarification({
      orderId: access.order.id,
      clarificationId:
        clarificationId != null && Number.isInteger(clarificationId)
          ? clarificationId
          : null,
      response,
      respondedBy: access.auth.usernameLower,
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
