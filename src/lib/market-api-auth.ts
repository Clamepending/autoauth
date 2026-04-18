import { NextResponse } from "next/server";
import { getAgentByPrivateKey } from "@/lib/db";
import { getHumanLinkForAgentUsername } from "@/lib/human-accounts";
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

function extractBearerToken(request: Request) {
  const header = request.headers.get("authorization")?.trim();
  if (!header) return null;
  const [scheme, token] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token?.trim()) return null;
  return token.trim();
}

function allowPrototypeHeaderAuth() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.OTTOAUTH_ENABLE_MARKET_HEADER_AUTH === "1"
  );
}

async function resolveAgentActor(request: Request): Promise<MarketActor | null> {
  const privateKey =
    extractBearerToken(request) ||
    request.headers.get("x-ottoauth-agent-private-key")?.trim() ||
    null;
  if (!privateKey) return null;

  const agent = await getAgentByPrivateKey(privateKey).catch(() => null);
  if (!agent) return null;

  const humanLink = await getHumanLinkForAgentUsername(agent.username_lower).catch(
    () => null,
  );
  if (!humanLink) return null;

  return {
    humanUserId: humanLink.human_user_id,
    agentId: agent.id,
    agentUsernameLower: agent.username_lower,
  };
}

function resolvePrototypeActor(
  request: Request,
  body?: Record<string, unknown> | null,
): MarketActor | null {
  if (!allowPrototypeHeaderAuth()) return null;

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

  return (await resolveAgentActor(request)) ?? resolvePrototypeActor(request, body);
}

export function missingActorResponse() {
  return NextResponse.json(
    {
      error:
        "Missing market actor. Sign in to OttoAuth or authenticate a linked agent with Authorization: Bearer <agent_private_key>.",
    },
    { status: 401 },
  );
}
