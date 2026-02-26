import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { emitAgentEvent } from "@/lib/agent-events";
import { getAgentDefaultComputerUseDevice } from "@/lib/computeruse-registrations";
import {
  normalizeMockDeviceId,
  parseHttpUrl,
} from "@/lib/computeruse-mock";
import {
  enqueueComputerUseOpenUrlTask,
  getComputerUseDeviceByBrowserToken,
  getComputerUseDeviceById,
} from "@/lib/computeruse-store";

function extractUrlFromTaskPrompt(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const taskPrompt = input.trim();
  if (!taskPrompt) return null;

  const direct = parseHttpUrl(taskPrompt);
  if (direct) return direct;

  const match = taskPrompt.match(/https?:\/\/[^\s)]+/i);
  if (!match) return null;
  return parseHttpUrl(match[0]);
}

function normalizeDeviceField(payload: Record<string, unknown>) {
  return (
    normalizeMockDeviceId(payload.device_id) ||
    normalizeMockDeviceId(payload.deviceId) ||
    normalizeMockDeviceId(payload.device) ||
    ""
  );
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const rawDeviceField = normalizeDeviceField(payload);
  const browserToken =
    typeof payload.browser_token === "string"
      ? payload.browser_token.trim()
      : typeof payload.browserToken === "string"
        ? payload.browserToken.trim()
        : typeof payload.device_token === "string"
          ? payload.device_token.trim()
          : typeof payload.deviceToken === "string"
            ? payload.deviceToken.trim()
            : rawDeviceField;
  const registered = await getAgentDefaultComputerUseDevice(auth.usernameLower);
  const paired =
    (browserToken ? await getComputerUseDeviceByBrowserToken(browserToken) : null) ??
    (registered ? await getComputerUseDeviceById(registered.device_id) : null) ??
    (await getComputerUseDeviceById(rawDeviceField || "local-device-1"));
  if (!paired) {
    return NextResponse.json(
      {
        error:
          browserToken
            ? "Unknown browser token. Generate a fresh token in the extension and share it with the agent."
            : "No registered browser/device for this agent. Call POST /api/computeruse/register-device once with a browser token.",
      },
      { status: 400 }
    );
  }

  const taskPrompt =
    typeof payload.task_prompt === "string"
      ? payload.task_prompt.trim()
      : typeof payload.taskPrompt === "string"
        ? payload.taskPrompt.trim()
        : "";
  if (!taskPrompt) {
    return NextResponse.json(
      { error: "task_prompt is required." },
      { status: 400 }
    );
  }

  // For the current mock executor, we only support "open_url", so we derive a URL
  // from the prompt (or accept explicit url override for testing).
  const explicitUrl = parseHttpUrl(payload.url);
  const derivedUrl = explicitUrl ?? extractUrlFromTaskPrompt(taskPrompt);
  if (!derivedUrl) {
    return NextResponse.json(
      {
        error:
          "Mock executor can only open URLs right now. Include an http/https URL in task_prompt (or provide url).",
      },
      { status: 400 }
    );
  }

  const requestId =
    typeof payload.id === "string" && payload.id.trim()
      ? payload.id.trim()
      : undefined;

  const { task, queueSize } = await enqueueComputerUseOpenUrlTask({
    url: derivedUrl,
    deviceId: paired.device_id,
    id: requestId,
    source: "computeruse_tasks",
    agentUsername: auth.usernameLower,
    taskPrompt,
  });

  const event = emitAgentEvent({
    type: "computeruse.task.queued",
    agentUsername: auth.usernameLower,
    deviceId: paired.device_id,
    data: {
      task_id: task.id,
      status: "queued",
      executor: "mock_open_url",
      mapped_action: {
        type: "open_url",
        url: derivedUrl,
      },
      task_prompt: taskPrompt,
    },
  });

  return NextResponse.json({
    ok: true,
    status: "queued",
    task_id: task.id,
    device_id: paired.device_id,
    task_prompt: taskPrompt,
    executor: "mock_open_url",
    mapped_action: {
      type: "open_url",
      url: derivedUrl,
    },
    queue_size: queueSize,
    event_id: event.id,
    note: "This is a mock computer-use endpoint. It maps task_prompt to open_url when a URL is present.",
  });
}
