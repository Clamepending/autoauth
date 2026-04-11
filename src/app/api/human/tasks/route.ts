import { NextResponse } from "next/server";
import {
  appendComputerUseRunEvent,
  createComputerUseRun,
  markComputerUseRunWaitingForTask,
} from "@/lib/computeruse-runs";
import {
  buildGenericTaskGoal,
  normalizeOptionalShippingAddress,
  normalizeOptionalWebsiteUrl,
} from "@/lib/computeruse-task-prompts";
import {
  enqueueComputerUseLocalAgentGoalTask,
  selectComputerUseDeviceForHumanTask,
} from "@/lib/computeruse-store";
import {
  createGenericBrowserTask,
  formatGenericTaskForApi,
} from "@/lib/generic-browser-tasks";
import { getHumanCreditBalance } from "@/lib/human-accounts";
import { requireCurrentHumanUser } from "@/lib/human-session";

const HUMAN_SUBMISSION_AGENT_ID = 0;

function humanActorUsername(humanUserId: number) {
  return `human:${humanUserId}`;
}

export async function POST(request: Request) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const taskPrompt =
    typeof payload.task_prompt === "string"
      ? payload.task_prompt.trim()
      : typeof payload.taskPrompt === "string"
        ? payload.taskPrompt.trim()
        : "";
  const taskTitle =
    typeof payload.task_title === "string"
      ? payload.task_title.trim()
      : typeof payload.taskTitle === "string"
        ? payload.taskTitle.trim()
        : "";
  let websiteUrl: string | null = null;
  let shippingAddress: string | null = null;
  try {
    websiteUrl = normalizeOptionalWebsiteUrl(
      payload.website_url ?? payload.websiteUrl,
    );
    shippingAddress = normalizeOptionalShippingAddress(
      payload.shipping_address ?? payload.shippingAddress,
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid task request." },
      { status: 400 },
    );
  }
  const requestedMaxCharge =
    typeof payload.max_charge_cents === "number"
      ? payload.max_charge_cents
      : typeof payload.maxChargeCents === "number"
        ? payload.maxChargeCents
        : null;
  const fulfillmentModeRaw =
    typeof payload.fulfillment_mode === "string"
      ? payload.fulfillment_mode
      : typeof payload.fulfillmentMode === "string"
        ? payload.fulfillmentMode
        : "auto";
  const fulfillmentMode =
    fulfillmentModeRaw === "own_device" || fulfillmentModeRaw === "marketplace"
      ? fulfillmentModeRaw
      : "auto";

  if (!taskPrompt) {
    return NextResponse.json({ error: "task_prompt is required." }, { status: 400 });
  }

  const creditBalance = await getHumanCreditBalance(user.id);
  if (creditBalance <= 0) {
    return NextResponse.json(
      { error: "Your account has no credits remaining." },
      { status: 402 },
    );
  }

  const effectiveMaxCharge =
    requestedMaxCharge == null ? creditBalance : Math.trunc(requestedMaxCharge);
  if (effectiveMaxCharge <= 0) {
    return NextResponse.json(
      { error: "max_charge_cents must be positive if provided." },
      { status: 400 },
    );
  }
  if (requestedMaxCharge != null && effectiveMaxCharge > creditBalance) {
    return NextResponse.json(
      {
        error: `Requested max charge exceeds your current credit balance (${creditBalance} cents available).`,
      },
      { status: 402 },
    );
  }

  const selection = await selectComputerUseDeviceForHumanTask({
    requesterHumanUserId: user.id,
    fulfillmentMode,
  });
  if (!selection?.device) {
    const error =
      fulfillmentMode === "own_device"
        ? "You do not have a claimed OttoAuth browser device yet."
        : fulfillmentMode === "marketplace"
          ? "No online marketplace fulfillment device is available right now."
          : "No claimed browser device or online marketplace fulfiller is available right now.";
    return NextResponse.json({ error }, { status: 409 });
  }
  if (selection.device.human_user_id == null) {
    return NextResponse.json(
      { error: "Selected fulfillment device is not linked to a human account." },
      { status: 409 },
    );
  }

  const wrappedPrompt = buildGenericTaskGoal({
    originalPrompt: taskPrompt,
    maxChargeCents: effectiveMaxCharge,
    websiteUrl,
    shippingAddress,
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
      task_prompt: taskPrompt,
      requester_human_user_id: user.id,
      fulfiller_human_user_id: selection.device.human_user_id,
      device_id: selection.device.device_id,
      credit_balance_cents: creditBalance,
      max_charge_cents: effectiveMaxCharge,
      selection: selection.selection,
      website_url: websiteUrl,
      shipping_address_present: Boolean(shippingAddress),
    },
  });

  const { task } = await enqueueComputerUseLocalAgentGoalTask({
    goal: wrappedPrompt,
    deviceId: selection.device.device_id,
    source: "computeruse_tasks",
    agentUsername: null,
    taskPrompt: wrappedPrompt,
    runId: run.id,
  });

  await markComputerUseRunWaitingForTask({
    runId: run.id,
    taskId: task.id,
  });
  await appendComputerUseRunEvent({
    runId: run.id,
    type: "computeruse.task.queued",
    data: {
      task_id: task.id,
      task_kind: "generic_browser_task",
      submission_source: "human",
      requester_human_user_id: user.id,
      fulfiller_human_user_id: selection.device.human_user_id,
      device_id: selection.device.device_id,
      selection: selection.selection,
    },
  });

  const createdTask = await createGenericBrowserTask({
    agentId: HUMAN_SUBMISSION_AGENT_ID,
    agentUsernameLower: humanActorUsername(user.id),
    humanUserId: user.id,
    deviceId: selection.device.device_id,
    submissionSource: "human",
    fulfillerHumanUserId: selection.device.human_user_id,
    taskPrompt,
    taskTitle: taskTitle || taskPrompt.slice(0, 80),
    websiteUrl,
    shippingAddress,
    maxChargeCents: effectiveMaxCharge,
    runId: run.id,
    computeruseTaskId: task.id,
  });

  return NextResponse.json({
    ok: true,
    task: formatGenericTaskForApi(createdTask, user),
    run_id: run.id,
    fulfillment: {
      selection: selection.selection,
      device_id: selection.device.device_id,
      fulfiller_human_user_id: selection.device.human_user_id,
      device_label: selection.device.label,
    },
  });
}
