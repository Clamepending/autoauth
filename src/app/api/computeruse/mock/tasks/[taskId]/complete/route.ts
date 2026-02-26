import { NextResponse } from "next/server";
import { emitAgentEvent } from "@/lib/agent-events";
import {
  appendComputerUseRunEvent,
  markComputerUseRunFromTaskResult,
} from "@/lib/computeruse-runs";
import {
  normalizeMockDeviceId,
} from "@/lib/computeruse-mock";
import {
  getComputerUseDeviceById,
  getComputerUseTaskById,
  updateComputerUseTaskResult,
  verifyComputerUseDeviceToken,
} from "@/lib/computeruse-store";

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
    return NextResponse.json(
      { error: "Missing task id." },
      { status: 400, headers: corsHeaders() }
    );
  }

  const task = await getComputerUseTaskById(taskId);
  if (!task) {
    return NextResponse.json(
      { error: "Task not found." },
      { status: 404, headers: corsHeaders() }
    );
  }

  const deviceId =
    normalizeMockDeviceId(request.headers.get("x-ottoauth-mock-device")) ||
    task.deviceId;

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

  if (task.deviceId !== "*" && task.deviceId !== deviceId) {
    return NextResponse.json(
      { error: "Task does not belong to this device." },
      { status: 403, headers: corsHeaders() }
    );
  }

  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const rawStatus =
    typeof payload?.status === "string" ? payload.status.trim().toLowerCase() : "completed";
  const status = rawStatus === "failed" ? "failed" : "completed";
  const summary =
    typeof payload?.summary === "string" ? payload.summary.trim() : null;
  const openedUrl = typeof payload?.url === "string" ? payload.url : task.url;
  const result =
    status === "completed"
      ? {
          summary: summary || `Opened ${openedUrl}`,
          url: openedUrl,
          source: "extension_mock_callback",
        }
      : null;
  const error =
    status === "failed" && typeof payload?.error === "string"
      ? payload.error.trim()
      : status === "failed"
        ? "Mock extension reported failure"
        : null;

  const updated = await updateComputerUseTaskResult({
    taskId,
    status,
    result,
    error,
  });
  if (!updated) {
    return NextResponse.json(
      { error: "Task not found." },
      { status: 404, headers: corsHeaders() }
    );
  }

  if (updated.agentUsername) {
    emitAgentEvent({
      type:
        status === "completed"
          ? "computeruse.task.completed"
          : "computeruse.task.failed",
      agentUsername: updated.agentUsername,
      deviceId: updated.deviceId,
      data: {
        task_id: updated.id,
        run_id: updated.runId,
        status,
        result: updated.result,
        error: updated.error,
        executor: "mock_open_url",
      },
    });
  }

  if (updated.runId) {
    const run = await markComputerUseRunFromTaskResult(updated);
    await appendComputerUseRunEvent({
      runId: updated.runId,
      type:
        status === "completed"
          ? "computeruse.task.completed"
          : "computeruse.task.failed",
      data: {
        task_id: updated.id,
        status,
        result: updated.result,
        error: updated.error,
      },
    });
    if (run) {
      await appendComputerUseRunEvent({
        runId: updated.runId,
        type:
          status === "completed"
            ? "computeruse.run.completed"
            : "computeruse.run.failed",
        data: {
          run_id: run.id,
          task_id: updated.id,
          status: run.status,
          result: run.result,
          error: run.error,
        },
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      task: {
        id: updated.id,
        status: updated.status,
        completed_at: updated.completedAt,
        result: updated.result,
        error: updated.error,
      },
    },
    { headers: corsHeaders() }
  );
}
