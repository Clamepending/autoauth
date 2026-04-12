import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import {
  appendComputerUseRunEvent,
  markComputerUseRunWaitingForTask,
} from "@/lib/computeruse-runs";
import { enqueueComputerUseLocalAgentGoalTask } from "@/lib/computeruse-store";
import {
  formatGenericTaskForApi,
  getGenericBrowserTaskById,
  resumeGenericBrowserTaskAfterClarification,
} from "@/lib/generic-browser-tasks";
import { buildGenericTaskGoal } from "@/lib/computeruse-task-prompts";
import { getHumanUserById } from "@/lib/human-accounts";
import { emitAgentEvent } from "@/lib/agent-events";

type Context = {
  params: Promise<{ taskId: string }>;
};

export async function POST(request: Request, context: Context) {
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const { taskId } = await context.params;
  const parsedTaskId = Number(taskId);
  if (!Number.isInteger(parsedTaskId) || parsedTaskId < 1) {
    return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
  }

  const clarificationResponse =
    typeof payload.clarification_response === "string"
      ? payload.clarification_response.trim()
      : typeof payload.clarificationResponse === "string"
        ? payload.clarificationResponse.trim()
        : "";
  if (!clarificationResponse) {
    return NextResponse.json(
      { error: "clarification_response is required." },
      { status: 400 },
    );
  }

  const task = await getGenericBrowserTaskById(parsedTaskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  if (task.agent_username_lower !== auth.usernameLower) {
    return NextResponse.json(
      { error: "Not authorized to respond to this task." },
      { status: 403 },
    );
  }
  if (task.submission_source !== "agent") {
    return NextResponse.json(
      { error: "Only agent-submitted tasks support clarification callbacks." },
      { status: 409 },
    );
  }
  if (task.status !== "awaiting_agent_clarification" || !task.clarification_request) {
    return NextResponse.json(
      { error: "This task is not currently awaiting agent clarification." },
      { status: 409 },
    );
  }

  const resumedPrompt = buildGenericTaskGoal({
    originalPrompt: task.task_prompt,
    maxChargeCents: task.max_charge_cents ?? 0,
    websiteUrl: task.website_url,
    shippingAddress: task.shipping_address,
    clarificationMode: "agent_webhook",
    clarificationQuestion: task.clarification_request,
    clarificationResponse,
  });

  const queued = await enqueueComputerUseLocalAgentGoalTask({
    goal: resumedPrompt,
    deviceId: task.device_id,
    source: "computeruse_tasks",
    agentUsername: auth.usernameLower,
    taskPrompt: resumedPrompt,
    runId: task.run_id,
  });

  const updatedTask = await resumeGenericBrowserTaskAfterClarification({
    taskId: task.id,
    clarificationResponse,
    newComputeruseTaskId: queued.task.id,
  });
  if (!updatedTask) {
    return NextResponse.json(
      { error: "Failed to update task after clarification response." },
      { status: 500 },
    );
  }

  if (task.run_id) {
    await markComputerUseRunWaitingForTask({
      runId: task.run_id,
      taskId: queued.task.id,
    });
    await appendComputerUseRunEvent({
      runId: task.run_id,
      type: "computeruse.agent_clarification.responded",
      data: {
        task_id: queued.task.id,
        generic_task_id: task.id,
        clarification_question: task.clarification_request,
        clarification_response: clarificationResponse,
      },
    });
    await appendComputerUseRunEvent({
      runId: task.run_id,
      type: "computeruse.task.queued",
      data: {
        task_id: queued.task.id,
        queue_size: queued.queueSize,
        resumed_after_clarification: true,
      },
    });
  }

  emitAgentEvent({
    type: "computeruse.agent_clarification.responded",
    agentUsername: auth.usernameLower,
    deviceId: task.device_id,
    data: {
      task_id: queued.task.id,
      generic_task_id: task.id,
      clarification_question: task.clarification_request,
      clarification_response: clarificationResponse,
      resumed_after_clarification: true,
    },
  });

  const humanUser = await getHumanUserById(task.human_user_id);

  return NextResponse.json({
    ok: true,
    task: formatGenericTaskForApi(updatedTask, humanUser),
    run_id: task.run_id,
    computeruse_task_id: queued.task.id,
    queue_size: queued.queueSize,
    note: "Clarification received. OttoAuth queued a follow-up browser task on the linked device.",
  });
}
