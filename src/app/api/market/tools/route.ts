import { NextResponse } from "next/server";
import { missingActorResponse, resolveMarketActor } from "@/lib/market-api-auth";
import {
  callMarketService,
  getMarketServiceCallById,
  listMarketServices,
} from "@/lib/market-services";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const tool = typeof body?.tool === "string" ? body.tool : "";
  const args =
    body?.arguments && typeof body.arguments === "object"
      ? (body.arguments as Record<string, unknown>)
      : {};

  if (tool === "ottoauth_search_market") {
    const services = await listMarketServices({
      query: typeof args.query === "string" ? args.query : "",
      limit: Number(args.limit ?? 10),
    });
    return NextResponse.json({ services });
  }

  if (tool === "ottoauth_get_payment_status") {
    const callId = typeof args.call_id === "string" ? args.call_id : "";
    if (!callId) {
      return NextResponse.json({ error: "call_id is required." }, { status: 400 });
    }
    const call = await getMarketServiceCallById(callId);
    if (!call) {
      return NextResponse.json({ error: "Payment call not found." }, { status: 404 });
    }
    return NextResponse.json({ call });
  }

  if (tool === "ottoauth_use_service") {
    const actor = await resolveMarketActor(request, body);
    if (!actor) return missingActorResponse();
    try {
      const result = await callMarketService({
        serviceId: Number(args.service_id),
        buyerHumanUserId: actor.humanUserId,
        buyerAgentId: actor.agentId,
        input: args.input,
        maxPriceCents: Number(args.max_price_cents ?? 0),
        reason: typeof args.reason === "string" ? args.reason : null,
        taskId: typeof args.task_id === "string" ? args.task_id : null,
        idempotencyKey:
          typeof args.idempotency_key === "string" ? args.idempotency_key : "",
      });
      return NextResponse.json(result);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ error: "Unknown OttoAuth Pay tool." }, { status: 400 });
}
