import { NextResponse } from "next/server";
import { getCurrentHumanUser } from "@/lib/human-session";

export type MarketActor = {
  humanUserId: number;
  agentId: number | null;
  agentUsernameLower: string | null;
};

function toPositiveInt(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function resolveMarketActor(
  request: Request,
  body?: Record<string, unknown> | null,
): Promise<MarketActor | null> {
  const currentHuman = await getCurrentHumanUser().catch(() => null);
  if (currentHuman) {
    return {
      humanUserId: currentHuman.id,
      agentId: null,
      agentUsernameLower: null,
    };
  }

  const headers = request.headers;
  const fromHeader = toPositiveInt(headers.get("x-ottoauth-human-user-id"));
  const fromBody =
    typeof body?.human_user_id === "number" || typeof body?.human_user_id === "string"
      ? toPositiveInt(String(body.human_user_id))
      : null;
  const humanUserId = fromHeader ?? fromBody;
  if (!humanUserId) return null;

  const agentId =
    toPositiveInt(headers.get("x-ottoauth-agent-id")) ??
    (typeof body?.agent_id === "number" || typeof body?.agent_id === "string"
      ? toPositiveInt(String(body.agent_id))
      : null);
  const agentUsernameLower =
    headers.get("x-ottoauth-agent-username")?.trim().toLowerCase() ||
    (typeof body?.agent_username === "string"
      ? body.agent_username.trim().toLowerCase()
      : null);
  return {
    humanUserId,
    agentId,
    agentUsernameLower,
  };
}

export function missingActorResponse() {
  return NextResponse.json(
    {
      error:
        "Missing market actor. Sign in to OttoAuth or provide X-OttoAuth-Human-User-Id for agent/prototype calls.",
    },
    { status: 401 },
  );
}
