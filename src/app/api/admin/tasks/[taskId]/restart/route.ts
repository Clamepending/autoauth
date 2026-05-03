import { NextResponse } from "next/server";

import {
  appendComputerUseRunEvent,
  createComputerUseRun,
  markComputerUseRunFinalState,
  markComputerUseRunWaitingForTask,
} from "@/lib/computeruse-runs";
import { buildGenericTaskGoal } from "@/lib/computeruse-task-prompts";
import {
  enqueueComputerUseLocalAgentGoalTask,
  getComputerUseDeviceById,
  selectComputerUseDeviceForHumanTask,
  updateComputerUseTaskResult,
  type ComputerUseDeviceRecord,
} from "@/lib/computeruse-store";
import {
  cancelInFlightGenericBrowserTask,
  createGenericBrowserTask,
  formatGenericTaskForApi,
  getGenericBrowserTaskByComputerUseTaskId,
  getGenericBrowserTaskById,
  type GenericBrowserTaskRecord,
} from "@/lib/generic-browser-tasks";
import {
  getHumanCreditBalance,
  getHumanUserById,
  type HumanUserRecord,
} from "@/lib/human-accounts";

type Context = {
  params: {
    taskId: string;
  };
};

const HUMAN_SUBMISSION_AGENT_ID = 0;

function humanActorUsername(humanUserId: number) {
  return `human:${humanUserId}`;
}

async function resolveOriginalTask(taskIdRaw: string) {
  const trimmed = taskIdRaw.trim();
  const numericTaskId = Number(trimmed);
  if (Number.isFinite(numericTaskId) && numericTaskId > 0) {
    return getGenericBrowserTaskById(numericTaskId);
  }
  if (!trimmed) return null;
  return getGenericBrowserTaskByComputerUseTaskId(trimmed);
}

async function chooseRestartDevice(originalTask: GenericBrowserTaskRecord) {
  const originalDevice = originalTask.device_id
    ? await getComputerUseDeviceById(originalTask.device_id)
    : null;
  if (originalDevice?.human_user_id != null) {
    return {
      selection: "same_device" as const,
      device: originalDevice,
    };
  }

  return selectComputerUseDeviceForHumanTask({
    requesterHumanUserId: originalTask.human_user_id,
    fulfillmentMode: "auto",
  });
}

function getRunAgentUsername(originalTask: GenericBrowserTaskRecord, requester: HumanUserRecord) {
  if (originalTask.submission_source === "human") {
    return humanActorUsername(requester.id);
  }
  return originalTask.agent_username_lower || humanActorUsername(requester.id);
}

async function failOriginalInFlightTask(
  originalTask: GenericBrowserTaskRecord,
  reason: string,
) {
  if (originalTask.status === "completed" || originalTask.status === "failed") {
    return originalTask;
  }

  const failedTask = await cancelInFlightGenericBrowserTask({
    taskId: originalTask.id,
    reason,
  });

  if (originalTask.computeruse_task_id) {
    await updateComputerUseTaskResult({
      taskId: originalTask.computeruse_task_id,
      status: "failed",
      error: reason,
    });
  }

  if (originalTask.run_id) {
    await markComputerUseRunFinalState({
      runId: originalTask.run_id,
      taskId: originalTask.computeruse_task_id,
      status: "failed",
      error: reason,
    });
    await appendComputerUseRunEvent({
      runId: originalTask.run_id,
      type: "computeruse.run.admin_restart_cancelled_original",
      data: {
        original_task_id: originalTask.id,
        original_computeruse_task_id: originalTask.computeruse_task_id,
        reason,
      },
    });
  }

  return failedTask ?? originalTask;
}

export async function POST(_request: Request, context: Context) {
  const originalTask = await resolveOriginalTask(context.params.taskId ?? "");
  if (!originalTask) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  if (originalTask.status === "completed") {
    return NextResponse.json(
      { error: "Completed orders are already final and cannot be restarted." },
      { status: 409 },
    );
  }

  const requester = await getHumanUserById(originalTask.human_user_id);
  if (!requester) {
    return NextResponse.json(
      { error: "Requester account not found." },
      { status: 404 },
    );
  }

  const creditBalance = await getHumanCreditBalance(requester.id);
  if (creditBalance <= 0) {
    return NextResponse.json(
      { error: "The requester account has no credits remaining." },
      { status: 402 },
    );
  }

  const effectiveMaxCharge =
    originalTask.max_charge_cents == null
      ? creditBalance
      : Math.trunc(originalTask.max_charge_cents);
  if (effectiveMaxCharge <= 0) {
    return NextResponse.json(
      { error: "The original order has an invalid spend cap." },
      { status: 409 },
    );
  }
  if (effectiveMaxCharge > creditBalance) {
    return NextResponse.json(
      {
        error: `Original spend cap exceeds the requester's current credit balance (${creditBalance} cents available).`,
      },
      { status: 402 },
    );
  }

  const selectedDevice = await chooseRestartDevice(originalTask);
  if (!selectedDevice?.device) {
    return NextResponse.json(
      {
        error:
          "No enabled claimed browser device or online marketplace fulfiller is available right now.",
      },
      { status: 409 },
    );
  }
  if (selectedDevice.device.human_user_id == null) {
    return NextResponse.json(
      { error: "Selected fulfillment device is not linked to a human account." },
      { status: 409 },
    );
  }

  const restartReason = `Restarted by admin control plane at ${new Date().toISOString()}.`;
  await failOriginalInFlightTask(originalTask, restartReason);

  const wrappedPrompt = buildGenericTaskGoal({
    originalPrompt: originalTask.task_prompt,
    maxChargeCents: effectiveMaxCharge,
    websiteUrl: originalTask.website_url,
    shippingAddress: originalTask.shipping_address,
    clarificationMode:
      originalTask.submission_source === "agent"
        ? "agent_webhook"
        : "human_reply_window",
  });
  const runAgentUsername = getRunAgentUsername(originalTask, requester);
  const run = await createComputerUseRun({
    agentUsername: runAgentUsername,
    deviceId: selectedDevice.device.device_id,
    taskPrompt: wrappedPrompt,
  });

  await appendComputerUseRunEvent({
    runId: run.id,
    type: "computeruse.run.created",
    data: {
      submission_source: originalTask.submission_source,
      admin_restart: true,
      restarted_from_task_id: originalTask.id,
      restarted_from_run_id: originalTask.run_id,
      restarted_from_computeruse_task_id: originalTask.computeruse_task_id,
      task_prompt: originalTask.task_prompt,
      requester_human_user_id: requester.id,
      fulfiller_human_user_id: selectedDevice.device.human_user_id,
      device_id: selectedDevice.device.device_id,
      credit_balance_cents: creditBalance,
      max_charge_cents: effectiveMaxCharge,
      selection: selectedDevice.selection,
      website_url: originalTask.website_url,
      shipping_address_present: Boolean(originalTask.shipping_address),
    },
  });

  const { task: computerUseTask } = await enqueueComputerUseLocalAgentGoalTask({
    goal: wrappedPrompt,
    deviceId: selectedDevice.device.device_id,
    source: "computeruse_tasks",
    agentUsername:
      originalTask.submission_source === "agent"
        ? originalTask.agent_username_lower
        : null,
    taskPrompt: wrappedPrompt,
    runId: run.id,
  });

  await markComputerUseRunWaitingForTask({
    runId: run.id,
    taskId: computerUseTask.id,
  });
  await appendComputerUseRunEvent({
    runId: run.id,
    type: "computeruse.task.queued",
    data: {
      task_id: computerUseTask.id,
      task_kind: "generic_browser_task_admin_restart",
      submission_source: originalTask.submission_source,
      restarted_from_task_id: originalTask.id,
      requester_human_user_id: requester.id,
      fulfiller_human_user_id: selectedDevice.device.human_user_id,
      device_id: selectedDevice.device.device_id,
      selection: selectedDevice.selection,
    },
  });

  const restartedTask = await createGenericBrowserTask({
    agentId:
      originalTask.submission_source === "human"
        ? HUMAN_SUBMISSION_AGENT_ID
        : originalTask.agent_id,
    agentUsernameLower: runAgentUsername,
    humanUserId: requester.id,
    deviceId: selectedDevice.device.device_id,
    submissionSource: originalTask.submission_source,
    fulfillerHumanUserId: selectedDevice.device.human_user_id,
    taskPrompt: originalTask.task_prompt,
    taskTitle: originalTask.task_title || originalTask.task_prompt.slice(0, 80),
    websiteUrl: originalTask.website_url,
    shippingAddress: originalTask.shipping_address,
    maxChargeCents: effectiveMaxCharge,
    runId: run.id,
    computeruseTaskId: computerUseTask.id,
  });

  if (originalTask.run_id) {
    await appendComputerUseRunEvent({
      runId: originalTask.run_id,
      type: "computeruse.run.admin_restart_created",
      data: {
        restart_task_id: restartedTask.id,
        restart_run_id: run.id,
        restart_computeruse_task_id: computerUseTask.id,
        device_id: selectedDevice.device.device_id,
        selection: selectedDevice.selection,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    task: formatGenericTaskForApi(restartedTask, requester),
    run_id: run.id,
    restarted_from_task_id: originalTask.id,
    fulfillment: {
      selection: selectedDevice.selection,
      device_id: selectedDevice.device.device_id,
      fulfiller_human_user_id: selectedDevice.device.human_user_id,
      device_label: (selectedDevice.device as ComputerUseDeviceRecord).label,
    },
  });
}
