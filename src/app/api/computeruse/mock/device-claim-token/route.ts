import { NextResponse } from "next/server";
import {
  normalizeMockDeviceId,
} from "@/lib/computeruse-mock";
import {
  getComputerUseDeviceById,
  setComputerUseDeviceBrowserToken,
  verifyComputerUseDeviceToken,
} from "@/lib/computeruse-store";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-OttoAuth-Mock-Device",
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
    normalizeMockDeviceId(request.headers.get("x-ottoauth-mock-device")) ||
    normalizeMockDeviceId(payload?.deviceId) ||
    "local-device-1";

  if (!(await getComputerUseDeviceById(deviceId))) {
    return NextResponse.json(
      { error: "Device is not paired (mock)." },
      { status: 401, headers: corsHeaders() }
    );
  }

  const tokenCheck = await verifyComputerUseDeviceToken({
    deviceId,
    authHeader: request.headers.get("authorization"),
  });
  if (!tokenCheck.ok) {
    return NextResponse.json(
      {
        error:
          tokenCheck.reason === "missing_token"
            ? "Missing bearer token for paired device."
            : "Invalid bearer token for paired device.",
      },
      { status: 401, headers: corsHeaders() }
    );
  }

  const agentPairToken =
    typeof payload?.agent_pair_token === "string"
      ? payload.agent_pair_token.trim()
      : typeof payload?.agentPairToken === "string"
        ? payload.agentPairToken.trim()
        : "";
  if (!agentPairToken) {
    return NextResponse.json(
      { error: "agent_pair_token is required." },
      { status: 400, headers: corsHeaders() }
    );
  }

  const updated = await setComputerUseDeviceBrowserToken({
    deviceId,
    browserToken: agentPairToken,
  });
  if (!updated) {
    return NextResponse.json(
      { error: "Failed to save agent pair token." },
      { status: 500, headers: corsHeaders() }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      device: {
        id: updated.device_id,
        agentPairToken: updated.browser_token,
        agentPairTokenUpdatedAt: updated.updated_at,
      },
      note: "Mock device claim token registered. Share this token with your agent to target this browser/device.",
    },
    { headers: corsHeaders() }
  );
}
