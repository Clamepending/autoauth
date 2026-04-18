import { NextResponse } from "next/server";
import { missingActorResponse, resolveMarketActor } from "@/lib/market-api-auth";
import {
  getMarketServiceById,
  updateMarketService,
} from "@/lib/market-services";

export const dynamic = "force-dynamic";

type Context = {
  params: {
    serviceId: string;
  };
};

function parseServiceId(context: Context) {
  const serviceId = Number(context.params.serviceId);
  return Number.isInteger(serviceId) && serviceId > 0 ? serviceId : null;
}

export async function GET(_request: Request, context: Context) {
  const serviceId = parseServiceId(context);
  if (!serviceId) {
    return NextResponse.json({ error: "Invalid service id." }, { status: 400 });
  }
  const service = await getMarketServiceById(serviceId);
  if (!service) {
    return NextResponse.json({ error: "Service not found." }, { status: 404 });
  }
  return NextResponse.json({ service });
}

export async function PATCH(request: Request, context: Context) {
  const serviceId = parseServiceId(context);
  if (!serviceId) {
    return NextResponse.json({ error: "Invalid service id." }, { status: 400 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const actor = await resolveMarketActor(request, body);
  if (!actor) return missingActorResponse();
  try {
    const service = await updateMarketService({
      serviceId,
      ownerHumanUserId: actor.humanUserId,
      patch: body ?? {},
    });
    return NextResponse.json({ service });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
