import { NextResponse } from "next/server";
import { missingActorResponse, resolveMarketActor } from "@/lib/market-api-auth";
import {
  createMarketService,
  listMarketServices,
} from "@/lib/market-services";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const services = await listMarketServices({
    query: url.searchParams.get("query"),
    includeUnlisted: url.searchParams.get("include_unlisted") === "1",
    limit: Number(url.searchParams.get("limit") || 50),
  });
  return NextResponse.json({ services });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const actor = await resolveMarketActor(request, body);
  if (!actor) return missingActorResponse();
  try {
    const service = await createMarketService({
      ownerHumanUserId: actor.humanUserId,
      ownerAgentId: actor.agentId,
      ownerAgentUsernameLower: actor.agentUsernameLower,
      name: body?.name,
      capability: body?.capability,
      description: body?.description,
      endpointUrl: body?.endpoint_url,
      priceCents: body?.price_cents,
      inputSchema: body?.input_schema,
      outputSchema: body?.output_schema,
      examples: body?.examples,
      tags: body?.tags,
      visibility: body?.visibility,
      supportedRails: body?.supported_rails,
      refundPolicy: body?.refund_policy,
    });
    return NextResponse.json({ service }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
