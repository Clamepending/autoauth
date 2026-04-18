import { NextResponse } from "next/server";
import { getLinkedAgentsForHuman } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";
import { ensureStandardFulfillmentServicesForHuman } from "@/lib/standard-fulfillment-services";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentHumanUser();
  if (!user) {
    return NextResponse.json({ error: "Human authentication required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const requestedAgentId = Number(body?.agent_id ?? 0);
  const linkedAgents = await getLinkedAgentsForHuman(user.id);
  const selectedAgent =
    Number.isInteger(requestedAgentId) && requestedAgentId > 0
      ? linkedAgents.find((agent) => agent.agent_id === requestedAgentId)
      : linkedAgents[0];

  if (!selectedAgent) {
    return NextResponse.json(
      {
        error:
          "Link an agent first, then publish these standard fulfillment services.",
      },
      { status: 409 },
    );
  }

  const services = await ensureStandardFulfillmentServicesForHuman({
    humanUserId: user.id,
    ownerAgentId: selectedAgent.agent_id,
    ownerAgentUsernameLower: selectedAgent.username_lower,
  });

  return NextResponse.json({
    ok: true,
    services,
    agent: {
      id: selectedAgent.agent_id,
      username_lower: selectedAgent.username_lower,
      username_display: selectedAgent.username_display,
    },
  });
}
