import { NextResponse } from "next/server";
import {
  appendComputerUseRunEvent,
  createComputerUseRun,
  markComputerUseRunWaitingForTask,
} from "@/lib/computeruse-runs";
import { buildGenericTaskGoal } from "@/lib/computeruse-task-prompts";
import {
  enqueueComputerUseLocalAgentGoalTask,
  selectComputerUseDeviceForHumanTask,
} from "@/lib/computeruse-store";
import {
  createGenericBrowserTask,
  formatGenericTaskForApi,
  getGenericBrowserTaskById,
} from "@/lib/generic-browser-tasks";
import { getHumanCreditBalance } from "@/lib/human-accounts";
import { requireCurrentHumanUser } from "@/lib/human-session";

const HUMAN_SUBMISSION_AGENT_ID = 0;

function humanActorUsername(humanUserId: number) {
  return `human:${humanUserId}`;
}

type Context = {
  params: {
    taskId: string;
  };
};

export async function POST(_request: Request, context: Context) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const taskId = Number(context.params.taskId?.trim() ?? "");
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Invalid task id." }, { status: 400 });
  }

  const originalTask = await getGenericBrowserTaskById(taskId);
  if (!originalTask) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  if (originalTask.human_user_id !== user.id) {
    return NextResponse.json(
      { error: "Only the requester can retry this order." },
      { status: 403 },
    );
  }
  if (originalTask.submission_source !== "human") {
    return NextResponse.json(
      { error: "Only human-submitted orders can be retried here." },
      { status: 409 },
    );
  }
  if (originalTask.status !== "failed") {
    return NextResponse.json(
      { error: "Only failed orders can be retried." },
      { status: 409 },
    );
  }

  const creditBalance = await getHumanCreditBalance(user.id);
  if (creditBalance <= 0) {
    return NextResponse.json(
      { error: "Your account has no credits remaining." },
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
        error: `Original spend cap exceeds your current credit balance (${creditBalance} cents available).`,
      },
      { status: 402 },
    );
  }

  const selection = await selectComputerUseDeviceForHumanTask({
    requesterHumanUserId: user.id,
    fulfillmentMode: "auto",
  });
  if (!selection?.device) {
    return NextResponse.json(
      {
        error:
          "No enabled claimed browser device or online marketplace fulfiller is available right now.",
      },
      { status: 409 },
    );
  }
  if (selection.device.human_user_id == null) {
    return NextResponse.json(
      { error: "Selected fulfillment device is not linked to a human account." },
      { status: 409 },
    );
  }

  const wrappedPrompt = buildGenericTaskGoal({
    originalPrompt: originalTask.task_prompt,
    maxChargeCents: effectiveMaxCharge,
    websiteUrl: originalTask.website_url,
    shippingAddress: originalTask.shipping_address,
    clarificationMode: "human_reply_window",
  });
  const run = await createComputerUseRun({
    agentUsername: humanActorUsername(user.id),
    deviceId: selection.device.device_id,
    taskPrompt: wrappedPrompt,
  });

  await appendComputerUseRunEvent({
    runId: run.id,
    type: "computeruse.run.created",
    data: {
      submission_source: "human",
      retry_of_task_id: originalTask.id,
      retry_of_run_id: originalTask.run_id,
      task_prompt: originalTask.task_prompt,
      requester_human_user_id: user.id,
      fulfiller_human_user_id: selection.device.human_user_id,
      device_id: selection.device.device_id,
      credit_balance_cents: creditBalance,
      max_charge_cents: effectiveMaxCharge,
      selection: selection.selection,
      website_url: originalTask.website_url,
      shipping_address_present: Boolean(originalTask.shipping_address),
    },
  });

  const { task: computerUseTask } = await enqueueComputerUseLocalAgentGoalTask({
    goal: wrappedPrompt,
    deviceId: selection.device.device_id,
    source: "computeruse_tasks",
    agentUsername: null,
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
      task_kind: "generic_browser_task_retry",
      submission_source: "human",
      retry_of_task_id: originalTask.id,
      requester_human_user_id: user.id,
      fulfiller_human_user_id: selection.device.human_user_id,
      device_id: selection.device.device_id,
      selection: selection.selection,
    },
  });

  const retriedTask = await createGenericBrowserTask({
    agentId: HUMAN_SUBMISSION_AGENT_ID,
    agentUsernameLower: humanActorUsername(user.id),
    humanUserId: user.id,
    deviceId: selection.device.device_id,
    submissionSource: "human",
    fulfillerHumanUserId: selection.device.human_user_id,
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
      type: "computeruse.run.retry_created",
      data: {
        retry_task_id: retriedTask.id,
        retry_run_id: run.id,
        retry_computeruse_task_id: computerUseTask.id,
        device_id: selection.device.device_id,
        selection: selection.selection,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    task: formatGenericTaskForApi(retriedTask, user),
    run_id: run.id,
    retried_from_task_id: originalTask.id,
    fulfillment: {
      selection: selection.selection,
      device_id: selection.device.device_id,
      fulfiller_human_user_id: selection.device.human_user_id,
      device_label: selection.device.label,
    },
  });
}
