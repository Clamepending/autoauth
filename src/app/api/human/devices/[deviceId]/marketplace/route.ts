import { NextResponse } from "next/server";
import {
  getComputerUseDeviceById,
  setComputerUseDeviceMarketplaceEnabled,
} from "@/lib/computeruse-store";
import { requireCurrentHumanUser } from "@/lib/human-session";

type Context = {
  params: {
    deviceId: string;
  };
};

export async function POST(request: Request, context: Context) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const deviceId = context.params.deviceId?.trim() ?? "";
  if (!deviceId) {
    return NextResponse.json({ error: "Missing device id." }, { status: 400 });
  }

  const existing = await getComputerUseDeviceById(deviceId);
  if (!existing) {
    return NextResponse.json({ error: "Device not found." }, { status: 404 });
  }
  if (existing.human_user_id !== user.id) {
    return NextResponse.json({ error: "You do not own this device." }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const enabled =
    typeof payload?.enabled === "boolean"
      ? payload.enabled
      : typeof payload?.marketplace_enabled === "boolean"
        ? payload.marketplace_enabled
        : false;

  const updated = await setComputerUseDeviceMarketplaceEnabled({
    deviceId,
    humanUserId: user.id,
    enabled,
  });

  return NextResponse.json({
    ok: true,
    device: updated,
  });
}
