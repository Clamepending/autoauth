import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { listAgentEvents } from "@/lib/agent-events";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const limitRaw =
    typeof payload.limit === "number"
      ? payload.limit
      : typeof payload.limit === "string"
        ? Number(payload.limit)
        : undefined;
  const limit = Number.isFinite(limitRaw as number) ? Number(limitRaw) : 25;

  const events = listAgentEvents({
    agentUsername: auth.usernameLower,
    limit,
  });

  return NextResponse.json({
    ok: true,
    events,
    count: events.length,
    note: "Mock event inspection endpoint for development. Not a realtime delivery channel.",
  });
}
