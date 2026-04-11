import { NextResponse } from "next/server";
import { createHumanDevicePairingCode } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";

export async function POST(request: Request) {
  const user = await getCurrentHumanUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const deviceLabel =
    typeof payload.device_label === "string"
      ? payload.device_label.trim()
      : typeof payload.deviceLabel === "string"
        ? payload.deviceLabel.trim()
        : "";
  const ttlMinutes =
    typeof payload.ttl_minutes === "number"
      ? payload.ttl_minutes
      : typeof payload.ttlMinutes === "number"
        ? payload.ttlMinutes
        : undefined;

  const code = await createHumanDevicePairingCode({
    humanUserId: user.id,
    deviceLabel: deviceLabel || null,
    ttlMinutes,
  });

  return NextResponse.json({
    ok: true,
    code: code.code,
    expires_at: code.expiresAt,
  });
}
