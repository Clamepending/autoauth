import { emitAgentEvent } from "@/lib/agent-events";
import { getAgentClarificationTimeoutMs } from "@/lib/computeruse-agent-clarification-config";
import { buildGenericTaskGoal } from "@/lib/computeruse-task-prompts";
import {
  appendComputerUseRunEvent,
  markComputerUseRunFinalState,
  markComputerUseRunWaitingForTask,
} from "@/lib/computeruse-runs";
import { enqueueComputerUseLocalAgentGoalTask } from "@/lib/computeruse-store";
import type {
  GenericBrowserTaskClarificationCallbackStatus,
  GenericBrowserTaskRecord,
} from "@/lib/generic-browser-tasks";
import {
  cancelGenericBrowserTaskAwaitingClarification,
  getGenericBrowserTaskById,
  resumeGenericBrowserTaskAfterClarification,
} from "@/lib/generic-browser-tasks";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAgentClarificationExpired(task: Pick<GenericBrowserTaskRecord, "status" | "clarification_deadline_at">) {
  if (task.status !== "awaiting_agent_clarification") return false;
  if (!task.clarification_deadline_at) return false;
  return new Date(task.clarification_deadline_at).getTime() <= Date.now();
}

export async function waitForAgentClarificationResolution(params: {
  taskId: number;
  timeoutMs: number;
  intervalMs?: number;
}) {
  const deadline = Date.now() + params.timeoutMs;
  const intervalMs = Math.max(100, Math.min(params.intervalMs ?? 250, 1000));

  while (Date.now() < deadline) {
    const task = await getGenericBrowserTaskById(params.taskId);
    if (!task) return null;
    if (task.status !== "awaiting_agent_clarification") {
      return task;
    }
    await sleep(intervalMs);
  }

  return getGenericBrowserTaskById(params.taskId);
}

export async function resumeAgentClarificationTask(params: {
  task: GenericBrowserTaskRecord;
  clarificationResponse: string;
  agentUsernameLower: string;
}) {
  if (!params.task.clarification_request) {
    throw new Error("Task is missing clarification request.");
  }

  const resumedPrompt = buildGenericTaskGoal({
    originalPrompt: params.task.task_prompt,
    maxChargeCents: params.task.max_charge_cents ?? 0,
    websiteUrl: params.task.website_url,
    shippingAddress: params.task.shipping_address,
    clarificationMode: "agent_webhook",
    clarificationQuestion: params.task.clarification_request,
    clarificationResponse: params.clarificationResponse,
  });

  const queued = await enqueueComputerUseLocalAgentGoalTask({
    goal: resumedPrompt,
    deviceId: params.task.device_id,
    source: "computeruse_tasks",
    agentUsername: params.agentUsernameLower,
    taskPrompt: resumedPrompt,
    runId: params.task.run_id,
  });

  const updatedTask = await resumeGenericBrowserTaskAfterClarification({
    taskId: params.task.id,
    clarificationResponse: params.clarificationResponse,
    newComputeruseTaskId: queued.task.id,
  });
  if (!updatedTask) {
    throw new Error("Failed to update task after clarification response.");
  }

  if (params.task.run_id) {
    await markComputerUseRunWaitingForTask({
      runId: params.task.run_id,
      taskId: queued.task.id,
    });
    await appendComputerUseRunEvent({
      runId: params.task.run_id,
      type: "computeruse.agent_clarification.responded",
      data: {
        task_id: queued.task.id,
        generic_task_id: params.task.id,
        clarification_question: params.task.clarification_request,
        clarification_response: params.clarificationResponse,
      },
    });
    await appendComputerUseRunEvent({
      runId: params.task.run_id,
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
    agentUsername: params.agentUsernameLower,
    deviceId: params.task.device_id,
    data: {
      task_id: queued.task.id,
      generic_task_id: params.task.id,
      clarification_question: params.task.clarification_request,
      clarification_response: params.clarificationResponse,
      resumed_after_clarification: true,
    },
  });

  return {
    task: updatedTask,
    computeruseTaskId: queued.task.id,
    queueSize: queued.queueSize,
  };
}

export async function cancelAgentClarificationTask(params: {
  task: GenericBrowserTaskRecord;
  reason: string;
  callbackStatus?: GenericBrowserTaskClarificationCallbackStatus;
  callbackHttpStatus?: number | null;
  callbackError?: string | null;
}) {
  const updatedTask = await cancelGenericBrowserTaskAwaitingClarification({
    taskId: params.task.id,
    reason: params.reason,
    callbackStatus: params.callbackStatus,
    callbackHttpStatus: params.callbackHttpStatus,
    callbackError: params.callbackError,
  });
  if (!updatedTask) {
    throw new Error("Failed to cancel clarification task.");
  }

  if (params.task.run_id) {
    await markComputerUseRunFinalState({
      runId: params.task.run_id,
      taskId: params.task.computeruse_task_id,
      status: "failed",
      result: null,
      error: params.reason,
    });
    await appendComputerUseRunEvent({
      runId: params.task.run_id,
      type: "computeruse.agent_clarification.timed_out",
      data: {
        task_id: params.task.computeruse_task_id,
        generic_task_id: params.task.id,
        clarification_question: params.task.clarification_request,
        reason: params.reason,
      },
    });
    await appendComputerUseRunEvent({
      runId: params.task.run_id,
      type: "computeruse.run.failed",
      data: {
        run_id: params.task.run_id,
        task_id: params.task.computeruse_task_id,
        status: "failed",
        error: params.reason,
      },
    });
  }

  emitAgentEvent({
    type: "computeruse.agent_clarification.timed_out",
    agentUsername: params.task.agent_username_lower,
    deviceId: params.task.device_id,
    data: {
      task_id: params.task.computeruse_task_id,
      generic_task_id: params.task.id,
      clarification_question: params.task.clarification_request,
      reason: params.reason,
    },
  });

  return updatedTask;
}
