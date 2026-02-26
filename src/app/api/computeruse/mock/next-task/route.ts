import { NextResponse } from "next/server";
import {
  normalizeMockDeviceId,
  parseHttpUrl,
} from "@/lib/computeruse-mock";
import {
  claimNextComputerUseTaskForDevice,
  enqueueComputerUseOpenUrlTask,
  getComputerUseDeviceById,
  verifyComputerUseDeviceToken,
} from "@/lib/computeruse-store";
import {
  appendComputerUseRunEvent,
  markComputerUseRunRunning,
} from "@/lib/computeruse-runs";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-OttoAuth-Mock-Device",
    "Cache-Control": "no-store",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const headerDevice = request.headers.get("x-ottoauth-mock-device");
  const queryDevice = url.searchParams.get("deviceId");
  const deviceId = (headerDevice ?? queryDevice ?? "local-device-1").trim();

  if (!deviceId) {
    return NextResponse.json(
      { error: "Missing device id. Send X-OttoAuth-Mock-Device header or ?deviceId=..." },
      { status: 400, headers: corsHeaders() }
    );
  }

  if (!(await getComputerUseDeviceById(deviceId))) {
    return NextResponse.json(
      { error: "Device is not paired (mock). Pair first via POST /api/computeruse/mock/pair." },
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

  const dequeued = await claimNextComputerUseTaskForDevice(deviceId);
  if (!dequeued) {
    return new NextResponse(null, { status: 204, headers: corsHeaders() });
  }

  const { task, queueSize } = dequeued;
  if (task.runId) {
    await markComputerUseRunRunning({ runId: task.runId, taskId: task.id });
    await appendComputerUseRunEvent({
      runId: task.runId,
      type: "computeruse.task.delivered",
      data: {
        task_id: task.id,
        device_id: deviceId,
      },
    });
  }
  return NextResponse.json(
    {
      id: task.id,
      type: task.type,
      url: task.url,
      goal: task.goal,
      taskPrompt: task.taskPrompt,
      deviceId: task.deviceId,
      createdAt: task.createdAt,
      remainingQueueSize: queueSize,
    },
    { headers: corsHeaders() }
  );
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: corsHeaders() });
  }

  const parsedUrl = parseHttpUrl((payload as Record<string, unknown>).url);
  if (!parsedUrl) {
    return NextResponse.json(
      { error: "url is required and must be http/https." },
      { status: 400, headers: corsHeaders() }
    );
  }

  const deviceId = normalizeMockDeviceId((payload as Record<string, unknown>).deviceId) || "local-device-1";
  const idRaw = (payload as Record<string, unknown>).id;
  const id = typeof idRaw === "string" && idRaw.trim() ? idRaw.trim() : undefined;
  const { task, queueSize } = await enqueueComputerUseOpenUrlTask({
    url: parsedUrl,
    deviceId,
    id,
    source: "direct_mock_queue",
  });

  return NextResponse.json(
    {
      ok: true,
      task,
      queueSize,
      note: "In-memory mock queue for local dev only. Tasks are lost on server restart/reload.",
    },
    { headers: corsHeaders() }
  );
}
