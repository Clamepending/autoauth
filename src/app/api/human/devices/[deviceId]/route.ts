import { NextResponse } from "next/server";
import { removeComputerUseDeviceForHuman } from "@/lib/computeruse-store";
import { requireCurrentHumanUser } from "@/lib/human-session";

type Context = {
  params: {
    deviceId: string;
  };
};

export async function DELETE(_request: Request, context: Context) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const deviceId = context.params.deviceId?.trim() ?? "";
  if (!deviceId) {
    return NextResponse.json({ error: "Invalid device id." }, { status: 400 });
  }

  try {
    const device = await removeComputerUseDeviceForHuman({
      humanUserId: user.id,
      deviceId,
    });
    return NextResponse.json({
      ok: true,
      removed_device_id: device.device_id,
      device: {
        device_id: device.device_id,
        label: device.label,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove device.";
    const status =
      message === "Device not found."
        ? 404
        : message === "You do not own this device."
          ? 403
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
