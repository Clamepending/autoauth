import { NextResponse } from "next/server";
import { normalizeMockDeviceId } from "@/lib/computeruse-mock";
import {
  appendComputerUseRunEvent,
  listComputerUseRunEvents,
} from "@/lib/computeruse-runs";
import {
  getComputerUseDeviceById,
  getComputerUseTaskById,
  touchComputerUseDeviceSeen,
  verifyComputerUseDeviceToken,
} from "@/lib/computeruse-store";
import { getGenericBrowserTaskByComputerUseTaskId } from "@/lib/generic-browser-tasks";

type Context = {
  params: {
    taskId: string;
  };
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-OttoAuth-Mock-Device",
    "Cache-Control": "no-store",
  };
}

function sanitizeMessage(value: unknown, limit = 1200) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

async function authenticateTaskDevice(request: Request, taskId: string) {
  const task = await getComputerUseTaskById(taskId);
  if (!task) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Task not found." }, { status: 404, headers: corsHeaders() }),
    };
  }

  const deviceId =
    normalizeMockDeviceId(request.headers.get("x-ottoauth-mock-device")) || task.deviceId;
  if (!(await getComputerUseDeviceById(deviceId))) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Device is not paired (mock)." }, { status: 401, headers: corsHeaders() }),
    };
  }

  const tokenCheck = await verifyComputerUseDeviceToken({
    deviceId,
    authHeader: request.headers.get("authorization"),
  });
  if (!tokenCheck.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error:
            tokenCheck.reason === "missing_token"
              ? "Missing bearer token for paired device."
              : "Invalid bearer token for paired device.",
        },
        { status: 401, headers: corsHeaders() },
      ),
    };
  }

  if (task.deviceId !== "*" && task.deviceId !== deviceId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Task does not belong to this device." },
        { status: 403, headers: corsHeaders() },
      ),
    };
  }

  await touchComputerUseDeviceSeen(deviceId).catch(() => null);
  return { ok: true as const, task, deviceId };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request, context: Context) {
  const taskId = context.params.taskId?.trim() ?? "";
  if (!taskId) {
    return NextResponse.json({ error: "Missing task id." }, { status: 400, headers: corsHeaders() });
  }

  const auth = await authenticateTaskDevice(request, taskId);
  if (!auth.ok) return auth.response;

  const genericTask = await getGenericBrowserTaskByComputerUseTaskId(auth.task.id);
  const runId = genericTask?.run_id || auth.task.runId || null;
  if (!runId) {
    return NextResponse.json({ ok: true, messages: [] }, { headers: corsHeaders() });
  }

  const events = await listComputerUseRunEvents({ runId, limit: 200 });
  const messages = [...events]
    .reverse()
    .filter((event) => event.type === "computeruse.chat.human_message")
    .map((event) => ({
      id: event.id,
      created_at: event.created_at,
      role: "requester",
      message:
        typeof event.data.message === "string"
          ? event.data.message
          : typeof event.data.text === "string"
            ? event.data.text
            : "",
    }))
    .filter((message) => message.message);

  return NextResponse.json({ ok: true, messages }, { headers: corsHeaders() });
}

export async function POST(request: Request, context: Context) {
  const taskId = context.params.taskId?.trim() ?? "";
  if (!taskId) {
    return NextResponse.json({ error: "Missing task id." }, { status: 400, headers: corsHeaders() });
  }

  const auth = await authenticateTaskDevice(request, taskId);
  if (!auth.ok) return auth.response;

  const genericTask = await getGenericBrowserTaskByComputerUseTaskId(auth.task.id);
  const runId = genericTask?.run_id || auth.task.runId || null;
  if (!runId) {
    return NextResponse.json(
      { error: "This task is not attached to an OttoAuth run." },
      { status: 409, headers: corsHeaders() },
    );
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const message = sanitizeMessage(payload?.message);
  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400, headers: corsHeaders() });
  }

  const event = await appendComputerUseRunEvent({
    runId,
    type: "computeruse.chat.agent_message",
    data: {
      task_id: auth.task.id,
      generic_task_id: genericTask?.id ?? null,
      device_id: auth.deviceId,
      message,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      message: event
        ? {
            id: event.id,
            created_at: event.created_at,
            role: "agent",
            message,
          }
        : null,
    },
    { headers: corsHeaders() },
  );
}
