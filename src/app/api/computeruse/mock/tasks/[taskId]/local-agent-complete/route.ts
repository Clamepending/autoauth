import { NextResponse } from "next/server";
import { emitAgentEvent } from "@/lib/agent-events";
import {
  appendComputerUseRunEvent,
  markComputerUseRunFinalState,
} from "@/lib/computeruse-runs";
import { normalizeMockDeviceId } from "@/lib/computeruse-mock";
import {
  getComputerUseDeviceById,
  getComputerUseTaskById,
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
    return NextResponse.json({ error: "Missing task id." }, { status: 400, headers: corsHeaders() });
  }

  const task = await getComputerUseTaskById(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404, headers: corsHeaders() });
  }

  const deviceId = normalizeMockDeviceId(request.headers.get("x-ottoauth-mock-device")) || task.deviceId;
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
  const status = typeof payload?.status === "string" && payload.status.trim().toLowerCase() === "failed"
    ? "failed"
    : "completed";
  const summary = typeof payload?.summary === "string" ? payload.summary.trim() : "";
  const error = status === "failed" && typeof payload?.error === "string"
    ? payload.error.trim()
    : status === "failed"
      ? "Local browser-agent execution failed"
      : null;
  const result = payload?.result && typeof payload.result === "object"
    ? (payload.result as Record<string, unknown>)
    : (summary ? { summary } : null);

  if (task.runId) {
    const run = await markComputerUseRunFinalState({
      runId: task.runId,
      taskId: task.id,
      status,
      result,
      error,
    });
    await appendComputerUseRunEvent({
      runId: task.runId,
      type: status === "completed" ? "computeruse.local_agent.completed" : "computeruse.local_agent.failed",
      data: {
        task_id: task.id,
        status,
        result,
        error,
      },
    });
    if (run) {
      await appendComputerUseRunEvent({
        runId: task.runId,
        type: status === "completed" ? "computeruse.run.completed" : "computeruse.run.failed",
        data: {
          run_id: run.id,
          task_id: task.id,
          status: run.status,
          result: run.result,
          error: run.error,
        },
      });
    }
  }

  if (task.agentUsername) {
    emitAgentEvent({
      type: status === "completed" ? "computeruse.local_agent.completed" : "computeruse.local_agent.failed",
      agentUsername: task.agentUsername,
      deviceId: task.deviceId,
      data: {
        task_id: task.id,
        run_id: task.runId,
        status,
        result,
        error,
        executor: "local_browser_agent",
      },
    });
  }

  return NextResponse.json(
    {
      ok: true,
      task: {
        id: task.id,
        type: task.type,
        run_id: task.runId,
      },
      local_agent: {
        status,
        result,
        error,
      },
    },
    { headers: corsHeaders() }
  );
}
