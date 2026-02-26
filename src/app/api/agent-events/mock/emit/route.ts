import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { emitAgentEvent } from "@/lib/agent-events";
import { normalizeMockDeviceId } from "@/lib/computeruse-mock";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const type =
    typeof payload.type === "string" ? payload.type.trim() : "";
  if (!type) {
    return NextResponse.json({ error: "type is required." }, { status: 400 });
  }

  const deviceId =
    normalizeMockDeviceId(payload.device_id) ||
    normalizeMockDeviceId(payload.deviceId) ||
    normalizeMockDeviceId(payload.device) ||
    "";

  const data = isRecord(payload.data) ? payload.data : {};
  const event = emitAgentEvent({
    type,
    agentUsername: auth.usernameLower,
    deviceId: deviceId || null,
    data,
  });

  return NextResponse.json({
    ok: true,
    event,
    note: "Mock event emit endpoint for development/testing. This does not deliver events to devices yet.",
  });
}
