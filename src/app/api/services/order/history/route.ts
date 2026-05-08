import { NextResponse } from "next/server";

import {
  authenticateOrderAgentFromRequest,
  readJsonObject,
} from "@/lib/order-api";
import {
  listOrdersForAgent,
  parseOrderForApi,
} from "@/lib/order-orchestration";

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const auth = await authenticateOrderAgentFromRequest(request, body.payload);
  if (!auth.ok) return auth.response;
  const orders = await listOrdersForAgent(auth.auth.usernameLower, 100);
  return NextResponse.json({
    ok: true,
    orders: orders.map(parseOrderForApi),
  });
}
