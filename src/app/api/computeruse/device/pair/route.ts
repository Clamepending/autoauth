import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  claimComputerUseDeviceForHuman,
  getComputerUseDeviceById,
  pairComputerUseDevice,
} from "@/lib/computeruse-store";
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

function internalWorkerPairingToken() {
  return (process.env.OTTOAUTH_INTERNAL_WORKER_PAIRING_TOKEN || "").trim();
}

function requestInternalWorkerPairingToken(
  request: Request,
  payload: Record<string, unknown> | null,
) {
  return (
    request.headers.get("x-ottoauth-internal-worker-token") ||
    request.headers.get("X-OttoAuth-Internal-Worker-Token") ||
    (typeof payload?.internal_worker_token === "string"
      ? payload.internal_worker_token
      : typeof payload?.internalWorkerToken === "string"
        ? payload.internalWorkerToken
        : "")
  ).trim();
}

function isValidInternalWorkerPairingToken(expected: string, actual: string) {
  if (!expected || !actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
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

  if (!pairingCode) {
    const expectedInternalToken = internalWorkerPairingToken();
    const suppliedInternalToken = requestInternalWorkerPairingToken(request, payload);
    if (!isValidInternalWorkerPairingToken(expectedInternalToken, suppliedInternalToken)) {
      return NextResponse.json(
        {
          error:
            "Internal worker pairing requires a trusted OttoAuth worker token.",
        },
        { status: 403, headers: corsHeaders() },
      );
    }

    const existing = await getComputerUseDeviceById(deviceId);
    if (existing?.human_user_id != null) {
      return NextResponse.json(
        {
          error:
            "This device is already claimed by a human account. Use a new device id for internal worker pairing.",
        },
        { status: 409, headers: corsHeaders() },
      );
    }

    const paired = await pairComputerUseDevice({
      deviceId,
      internalWorkerEnabled: true,
    });
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
          "Trusted internal OttoAuth fulfillment worker paired. It can receive internally routed tasks after it is online.",
      },
      { headers: corsHeaders() },
    );
  }

  const existing = await getComputerUseDeviceById(deviceId);
  if (existing?.internal_worker_enabled) {
    return NextResponse.json(
      {
        error:
          "This device id belongs to a trusted internal worker. Use a different device id for human device claiming.",
      },
      { status: 409, headers: corsHeaders() },
    );
  }

  const paired = await pairComputerUseDevice(deviceId);

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
      note: "Device paired and claimed. It is now enabled to receive OttoAuth tasks.",
    },
    { headers: corsHeaders() },
  );
}
