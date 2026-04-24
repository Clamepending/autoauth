import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import {
  normalizeMockDeviceId,
} from "@/lib/computeruse-mock";
import {
  getComputerUseDeviceById,
  touchComputerUseDeviceSeen,
  verifyComputerUseDeviceToken,
  waitForComputerUseTaskForDevice,
} from "@/lib/computeruse-store";
import {
  appendComputerUseRunEvent,
  markComputerUseRunRunning,
} from "@/lib/computeruse-runs";
import { markGenericBrowserTaskRunningByComputerUseTaskId } from "@/lib/generic-browser-tasks";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-OttoAuth-Mock-Device",
    "Cache-Control": "no-store",
  };
}

function unauthorized(message: string) {
  return NextResponse.json({ error: message }, { status: 401, headers: corsHeaders() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceId =
    normalizeMockDeviceId(request.headers.get("x-ottoauth-mock-device")) ||
    normalizeMockDeviceId(url.searchParams.get("deviceId")) ||
    "local-device-1";

  if (!deviceId) {
    return NextResponse.json(
      { error: "Missing device id. Send X-OttoAuth-Mock-Device header or ?deviceId=..." },
      { status: 400, headers: corsHeaders() }
    );
  }

  if (!(await getComputerUseDeviceById(deviceId))) {
    return unauthorized("Device is not paired. Pair first via POST /api/computeruse/device/pair.");
  }

  const tokenCheck = await verifyComputerUseDeviceToken({
    deviceId,
    authHeader: request.headers.get("authorization"),
  });
  if (!tokenCheck.ok) {
    return unauthorized(
      tokenCheck.reason === "missing_token"
        ? "Missing bearer token for paired device."
        : "Invalid bearer token for paired device."
    );
  }
  await touchComputerUseDeviceSeen(deviceId).catch(() => null);

  const result = await waitForComputerUseTaskForDevice({
    deviceId,
  });

  if (!result) {
    return new NextResponse(null, { status: 204, headers: corsHeaders() });
  }

  const { task, queueSize, waitedMs } = result;
  if (task.runId) {
    await markComputerUseRunRunning({ runId: task.runId, taskId: task.id });
    await appendComputerUseRunEvent({
      runId: task.runId,
      type: "computeruse.task.delivered",
      data: {
        task_id: task.id,
        device_id: deviceId,
        waited_ms: waitedMs,
      },
    });
  }
  await markGenericBrowserTaskRunningByComputerUseTaskId(task.id).catch(() => null);
  return NextResponse.json(
    {
      id: task.id,
      type: task.type,
      url: task.url,
      goal: task.goal,
      taskPrompt: task.taskPrompt,
      deviceId: task.deviceId,
      createdAt: task.createdAt,
      waitedMs,
      remainingQueueSize: queueSize,
    },
    { headers: corsHeaders() }
  );
}
