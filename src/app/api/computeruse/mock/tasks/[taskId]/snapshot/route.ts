import { NextResponse } from "next/server";
import { normalizeMockDeviceId } from "@/lib/computeruse-mock";
import {
  getComputerUseDeviceById,
  getComputerUseTaskById,
  touchComputerUseDeviceSeen,
  verifyComputerUseDeviceToken,
} from "@/lib/computeruse-store";
import { createGenericBrowserTaskSnapshotFromDevice } from "@/lib/generic-browser-tasks";

type Context = {
  params: {
    taskId: string;
  };
};

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

export async function POST(request: Request, context: Context) {
  const taskId = context.params.taskId?.trim() ?? "";
  if (!taskId) {
    return NextResponse.json({ error: "Missing task id." }, { status: 400, headers: corsHeaders() });
  }

  const task = await getComputerUseTaskById(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404, headers: corsHeaders() });
  }

  const deviceId =
    normalizeMockDeviceId(request.headers.get("x-ottoauth-mock-device")) || task.deviceId;
  if (!(await getComputerUseDeviceById(deviceId))) {
    return NextResponse.json({ error: "Device is not paired (mock)." }, { status: 401, headers: corsHeaders() });
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

  if (task.deviceId !== "*" && task.deviceId !== deviceId) {
    return NextResponse.json({ error: "Task does not belong to this device." }, { status: 403, headers: corsHeaders() });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const imageBase64 =
    typeof payload?.image_base64 === "string"
      ? payload.image_base64.trim()
      : typeof payload?.imageBase64 === "string"
        ? payload.imageBase64.trim()
        : "";
  const width =
    typeof payload?.width === "number"
      ? payload.width
      : typeof payload?.width === "string"
        ? Number(payload.width)
        : null;
  const height =
    typeof payload?.height === "number"
      ? payload.height
      : typeof payload?.height === "string"
        ? Number(payload.height)
        : null;
  const tabs = Array.isArray(payload?.tabs)
    ? payload.tabs
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const record = entry as Record<string, unknown>;
          const id = Number(record.id);
          if (!Number.isFinite(id)) return null;
          return {
            id,
            title: typeof record.title === "string" ? record.title : "",
            url: typeof record.url === "string" ? record.url : "",
            active: Boolean(record.active),
          };
        })
        .filter((entry): entry is { id: number; title: string; url: string; active: boolean } => entry != null)
    : [];

  if (!imageBase64) {
    return NextResponse.json({ error: "image_base64 is required." }, { status: 400, headers: corsHeaders() });
  }

  const snapshot = await createGenericBrowserTaskSnapshotFromDevice({
    computeruseTaskId: task.id,
    deviceId,
    imageBase64,
    width: Number.isFinite(width as number) ? Number(width) : null,
    height: Number.isFinite(height as number) ? Number(height) : null,
    tabs,
  });
  await touchComputerUseDeviceSeen(deviceId).catch(() => null);

  const latestTask = await getComputerUseTaskById(taskId);
  const taskAborted =
    latestTask?.status === "failed" || latestTask?.status === "completed";

  return NextResponse.json(
    {
      ok: true,
      snapshot,
      task_aborted: taskAborted,
      task_status: latestTask?.status ?? task.status,
    },
    { headers: corsHeaders() }
  );
}
