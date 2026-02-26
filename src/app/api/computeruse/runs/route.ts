import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import { emitAgentEvent } from "@/lib/agent-events";
import { getAgentDefaultComputerUseDevice } from "@/lib/computeruse-registrations";
import {
  appendComputerUseRunEvent,
  createComputerUseRun,
  markComputerUseRunWaitingForTask,
} from "@/lib/computeruse-runs";
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
    return NextResponse.json({ error: "task_prompt is required." }, { status: 400 });
  }

  const explicitUrl = parseHttpUrl(payload.url);
  const derivedUrl = explicitUrl ?? extractUrlFromTaskPrompt(taskPrompt);
  if (!derivedUrl) {
    return NextResponse.json(
      {
        error:
          "Mock run executor can only open URLs right now. Include an http/https URL in task_prompt (or provide url).",
      },
      { status: 400 }
    );
  }

  const run = await createComputerUseRun({
    agentUsername: auth.usernameLower,
    deviceId: paired.device_id,
    taskPrompt,
  });
  await appendComputerUseRunEvent({
    runId: run.id,
    type: "computeruse.run.created",
    data: {
      task_prompt: taskPrompt,
      device_id: paired.device_id,
    },
  });

  const { task, queueSize } = await enqueueComputerUseOpenUrlTask({
    url: derivedUrl,
    deviceId: paired.device_id,
    source: "computeruse_tasks",
    agentUsername: auth.usernameLower,
    taskPrompt,
    runId: run.id,
  });

  await markComputerUseRunWaitingForTask({ runId: run.id, taskId: task.id });
  await appendComputerUseRunEvent({
    runId: run.id,
    type: "computeruse.task.queued",
    data: {
      task_id: task.id,
      mapped_action: { type: "open_url", url: derivedUrl },
      queue_size: queueSize,
    },
  });

  const agentEvent = emitAgentEvent({
    type: "computeruse.run.queued",
    agentUsername: auth.usernameLower,
    deviceId: paired.device_id,
    data: {
      run_id: run.id,
      task_id: task.id,
      status: "waiting_for_device",
      task_prompt: taskPrompt,
      mapped_action: { type: "open_url", url: derivedUrl },
    },
  });

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    status: "waiting_for_device",
    device_id: paired.device_id,
    task_prompt: taskPrompt,
    current_task_id: task.id,
    mapped_action: { type: "open_url", url: derivedUrl },
    queue_size: queueSize,
    event_id: agentEvent.id,
    note: "Mock async computer-use run. Use /api/computeruse/runs/:runId and /events to track progress.",
  });
}
