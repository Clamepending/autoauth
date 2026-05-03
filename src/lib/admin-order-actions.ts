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
} from "@/lib/computeruse-store";
import {
  cancelInFlightGenericBrowserTask,
  createGenericBrowserTask,
  getGenericBrowserTaskByComputerUseTaskId,
  getGenericBrowserTaskById,
  type GenericBrowserTaskRecord,
} from "@/lib/generic-browser-tasks";
import {
  getHumanCreditBalance,
  getHumanUserById,
  type HumanUserRecord,
} from "@/lib/human-accounts";

const HUMAN_SUBMISSION_AGENT_ID = 0;

export type AdminOrderDuplicateAction = "copy" | "restart";

function humanActorUsername(humanUserId: number) {
  return `human:${humanUserId}`;
}

export async function resolveAdminOrderTask(taskIdRaw: string) {
  const trimmed = taskIdRaw.trim();
  const numericTaskId = Number(trimmed);
  if (Number.isFinite(numericTaskId) && numericTaskId > 0) {
    return getGenericBrowserTaskById(numericTaskId);
  }
  if (!trimmed) return null;
  return getGenericBrowserTaskByComputerUseTaskId(trimmed);
}

async function chooseDuplicateDevice(originalTask: GenericBrowserTaskRecord) {
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

export async function duplicateAdminOrderTask(params: {
  originalTask: GenericBrowserTaskRecord;
  action: AdminOrderDuplicateAction;
  failOriginal?: boolean;
}) {
  const { originalTask, action } = params;
  const requester = await getHumanUserById(originalTask.human_user_id);
  if (!requester) {
    throw new Error("Requester account not found.");
  }

  const creditBalance = await getHumanCreditBalance(requester.id);
  if (creditBalance <= 0) {
    throw new Error("The requester account has no credits remaining.");
  }

  const effectiveMaxCharge =
    originalTask.max_charge_cents == null
      ? creditBalance
      : Math.trunc(originalTask.max_charge_cents);
  if (effectiveMaxCharge <= 0) {
    throw new Error("The original order has an invalid spend cap.");
  }
  if (effectiveMaxCharge > creditBalance) {
    throw new Error(
      `Original spend cap exceeds the requester's current credit balance (${creditBalance} cents available).`,
    );
  }

  const selectedDevice = await chooseDuplicateDevice(originalTask);
  if (!selectedDevice?.device) {
    throw new Error(
      "No enabled claimed browser device or online marketplace fulfiller is available right now.",
    );
  }
  if (selectedDevice.device.human_user_id == null) {
    throw new Error("Selected fulfillment device is not linked to a human account.");
  }

  const actionLabel = action === "restart" ? "Restarted" : "Copied";
  if (params.failOriginal) {
    await failOriginalInFlightTask(
      originalTask,
      `${actionLabel} by admin control plane at ${new Date().toISOString()}.`,
    );
  }

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
      admin_action: action,
      admin_duplicate: true,
      duplicated_from_task_id: originalTask.id,
      duplicated_from_run_id: originalTask.run_id,
      duplicated_from_computeruse_task_id: originalTask.computeruse_task_id,
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
      task_kind:
        action === "restart"
          ? "generic_browser_task_admin_restart"
          : "generic_browser_task_admin_copy",
      submission_source: originalTask.submission_source,
      duplicated_from_task_id: originalTask.id,
      requester_human_user_id: requester.id,
      fulfiller_human_user_id: selectedDevice.device.human_user_id,
      device_id: selectedDevice.device.device_id,
      selection: selectedDevice.selection,
    },
  });

  const duplicatedTask = await createGenericBrowserTask({
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
      type:
        action === "restart"
          ? "computeruse.run.admin_restart_created"
          : "computeruse.run.admin_copy_created",
      data: {
        duplicate_task_id: duplicatedTask.id,
        duplicate_run_id: run.id,
        duplicate_computeruse_task_id: computerUseTask.id,
        action,
        device_id: selectedDevice.device.device_id,
        selection: selectedDevice.selection,
      },
    });
  }

  return {
    task: duplicatedTask,
    requester,
    run,
    computerUseTask,
    fulfillment: {
      selection: selectedDevice.selection,
      device_id: selectedDevice.device.device_id,
      fulfiller_human_user_id: selectedDevice.device.human_user_id,
      device_label: selectedDevice.device.label,
    },
  };
}
