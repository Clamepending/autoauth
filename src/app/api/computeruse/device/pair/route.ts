import { NextResponse } from "next/server";
import { claimComputerUseDeviceForHuman, pairComputerUseDevice } from "@/lib/computeruse-store";
import {
  consumeHumanDevicePairingCode,
  previewHumanDevicePairingCode,
} from "@/lib/human-accounts";

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
    typeof payload?.device_id === "string"
      ? payload.device_id.trim()
      : typeof payload?.deviceId === "string"
        ? payload.deviceId.trim()
        : "browser-agent-1";
  const deviceLabel =
    typeof payload?.device_label === "string"
      ? payload.device_label.trim()
      : typeof payload?.deviceLabel === "string"
        ? payload.deviceLabel.trim()
        : deviceId;
  const pairingCode =
    typeof payload?.pairing_code === "string"
      ? payload.pairing_code.trim()
      : typeof payload?.pairingCode === "string"
        ? payload.pairingCode.trim()
        : "";

  const paired = await pairComputerUseDevice(deviceId);
  if (!pairingCode) {
    return NextResponse.json(
      {
        ok: true,
        device: {
          id: paired.device_id,
          pairedAt: paired.paired_at,
          updatedAt: paired.updated_at,
          claimedHumanId: paired.human_user_id,
        },
        deviceToken: paired.auth_token,
        note:
          "Device paired without a human claim code. It can poll OttoAuth, but human-linked tasks will not route to it until a dashboard-generated claim code is supplied.",
      },
      { headers: corsHeaders() },
    );
  }

  const pairingPreview = await previewHumanDevicePairingCode(pairingCode);
  if (!pairingPreview || pairingPreview.status === "expired" || pairingPreview.status === "consumed") {
    return NextResponse.json(
      {
        error:
          pairingPreview?.status === "expired"
            ? "This device claim code has expired."
            : "This device claim code is invalid or already used.",
      },
      { status: 400, headers: corsHeaders() },
    );
  }

  if (paired.human_user_id && paired.human_user_id !== pairingPreview.humanUser.id) {
    return NextResponse.json(
      {
        error: "This device is already claimed by another human account.",
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const pairing = await consumeHumanDevicePairingCode(pairingCode);
  if (!pairing || pairing.status !== "consumed_now") {
    return NextResponse.json(
      { error: "This device claim code was already used." },
      { status: 400, headers: corsHeaders() },
    );
  }

  const claimed = await claimComputerUseDeviceForHuman({
    deviceId: paired.device_id,
    humanUserId: pairing.humanUser.id,
    label: deviceLabel,
  });
  if (!claimed) {
    return NextResponse.json(
      { error: "Failed to claim device." },
      { status: 500, headers: corsHeaders() },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      device: {
        id: claimed.device_id,
        label: claimed.label,
        pairedAt: claimed.paired_at,
        updatedAt: claimed.updated_at,
        claimedHumanId: claimed.human_user_id,
      },
      deviceToken: claimed.auth_token,
      human: {
        email: pairing.humanUser.email,
        displayName: pairing.humanUser.display_name,
      },
      note: "Device paired and claimed. It can now receive human-linked OttoAuth tasks.",
    },
    { headers: corsHeaders() },
  );
}
