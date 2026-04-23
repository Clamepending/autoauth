import { NextResponse } from "next/server";
import {
  verifyComputerUseDeviceToken,
  type ComputerUseDeviceRecord,
} from "@/lib/computeruse-store";

type MacroMiningAuthResult =
  | { ok: true; deviceId: string; device: ComputerUseDeviceRecord }
  | { ok: false; response: NextResponse };

export async function authenticateMacroMiningDevice(
  request: Request,
  body?: Record<string, unknown> | null,
): Promise<MacroMiningAuthResult> {
  const deviceId =
    request.headers.get("x-ottoauth-device-id")?.trim() ||
    request.headers.get("x-ottoauth-mock-device")?.trim() ||
    (typeof body?.deviceId === "string" ? body.deviceId.trim() : "");

  if (!deviceId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing device authentication." },
        { status: 401 },
      ),
    };
  }

  const auth = await verifyComputerUseDeviceToken({
    deviceId,
    authHeader: request.headers.get("authorization"),
  });

  if (!auth.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid device authentication." },
        { status: 401 },
      ),
    };
  }

  return { ok: true, deviceId, device: auth.device };
}
