import { NextResponse } from "next/server";
import { missingActorResponse, resolveMarketActor } from "@/lib/market-api-auth";
import { callMarketService } from "@/lib/market-services";

export const dynamic = "force-dynamic";

type Context = {
  params: {
    serviceId: string;
  };
};

export async function POST(request: Request, context: Context) {
  const serviceId = Number(context.params.serviceId);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    return NextResponse.json({ error: "Invalid service id." }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const maxPriceCents = Number(body?.max_price_cents);
  if (!Number.isInteger(maxPriceCents) || maxPriceCents < 0) {
    return NextResponse.json(
      { error: "max_price_cents must be a non-negative integer." },
      { status: 400 },
    );
  }

  const actor = await resolveMarketActor(request, body);
  if (!actor) return missingActorResponse();
  try {
    const result = await callMarketService({
      serviceId,
      buyerHumanUserId: actor.humanUserId,
      buyerAgentId: actor.agentId,
      input: body?.input,
      maxPriceCents,
      reason: typeof body?.reason === "string" ? body.reason : null,
      taskId: typeof body?.task_id === "string" ? body.task_id : null,
      idempotencyKey:
        typeof body?.idempotency_key === "string"
          ? body.idempotency_key
          : "",
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
