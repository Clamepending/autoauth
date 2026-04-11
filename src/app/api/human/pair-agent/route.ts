import { NextResponse } from "next/server";
import { linkAgentToHumanByPairingKey } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";

export async function POST(request: Request) {
  const user = await getCurrentHumanUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const pairingKey =
    typeof payload.pairing_key === "string"
      ? payload.pairing_key.trim()
      : typeof payload.pairingKey === "string"
        ? payload.pairingKey.trim()
        : "";
  if (!pairingKey) {
    return NextResponse.json({ error: "pairing_key is required." }, { status: 400 });
  }

  try {
    const result = await linkAgentToHumanByPairingKey({
      humanUserId: user.id,
      pairingKey,
    });
    return NextResponse.json({
      ok: true,
      status: result.status,
      agent: {
        id: result.agent.id,
        username: result.agent.username_display,
        username_lower: result.agent.username_lower,
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Pairing failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
