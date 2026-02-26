import { NextResponse } from "next/server";
import { normalizeMockDeviceId } from "@/lib/computeruse-mock";
import { pairComputerUseDevice } from "@/lib/computeruse-store";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  const deviceId =
    normalizeMockDeviceId(payload?.deviceId) ||
    normalizeMockDeviceId(payload?.device_id) ||
    "local-device-1";

  const paired = await pairComputerUseDevice(deviceId);

  return NextResponse.json(
    {
      ok: true,
      device: {
        id: paired.device_id,
        pairedAt: paired.paired_at,
        updatedAt: paired.updated_at,
      },
      deviceToken: paired.auth_token,
      note: "Mock pairing only. This endpoint rotates the token each time it is called.",
    },
    { headers: corsHeaders() }
  );
}
