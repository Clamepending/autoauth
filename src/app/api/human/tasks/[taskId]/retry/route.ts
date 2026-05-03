import { NextResponse } from "next/server";
import {
  appendComputerUseRunEvent,
  createComputerUseRun,
  markComputerUseRunWaitingForTask,
} from "@/lib/computeruse-runs";
import { buildGenericTaskGoal } from "@/lib/computeruse-task-prompts";
import {
  selectFulfillmentPlaybooks,
  summarizeSelectedFulfillmentPlaybooks,
} from "@/lib/fulfillment-playbooks";
import {
  enqueueComputerUseLocalAgentGoalTask,
  selectComputerUseDeviceForHumanTask,
  verifyComputerUseDeviceToken,
  type ComputerUseDeviceRecord,
} from "@/lib/computeruse-store";
import {
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
import { requireCurrentHumanUser } from "@/lib/human-session";

const HUMAN_SUBMISSION_AGENT_ID = 0;
const DEVICE_RETRY_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function humanActorUsername(humanUserId: number) {
  return `human:${humanUserId}`;
}

type Context = {
  params: {
    taskId: string;
  };
};

type RetryActor = {
  requester: HumanUserRecord;
  device: ComputerUseDeviceRecord | null;
  selection: "auto" | "same_device_retry";
  actor: "requester" | "device";
};

async function resolveOriginalTask(taskIdRaw: string) {
  const trimmed = taskIdRaw.trim();
  const numericTaskId = Number(trimmed);
  if (Number.isFinite(numericTaskId) && numericTaskId > 0) {
    return getGenericBrowserTaskById(numericTaskId);
  }
  if (!trimmed) return null;
  return getGenericBrowserTaskByComputerUseTaskId(trimmed);
}

async function authorizeRetry(
  request: Request,
  originalTask: GenericBrowserTaskRecord,
): Promise<{ actor: RetryActor } | { response: NextResponse }> {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (user) {
    if (originalTask.human_user_id !== user.id) {
      return {
        response: NextResponse.json(
          { error: "Only the requester can retry this order." },
          { status: 403 },
        ),
      };
    }
    return {
      actor: {
        requester: user,
        device: null,
        selection: "auto",
        actor: "requester",
      },
    };
  }

  const url = new URL(request.url);
  const deviceId =
    request.headers.get("x-ottoauth-device-id")?.trim() ||
    url.searchParams.get("device_id")?.trim() ||
    "";
  if (!deviceId) {
    return {
      response: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      ),
    };
  }

  const verification = await verifyComputerUseDeviceToken({
    deviceId,
    authHeader: request.headers.get("authorization"),
  });
  if (!verification.ok) {
    return {
      response: NextResponse.json(
        { error: "Invalid fulfillment device credentials." },
        { status: 401 },
      ),
    };
  }

  const device = verification.device;
  if (originalTask.device_id !== device.device_id) {
    return {
      response: NextResponse.json(
        { error: "This device can only retry orders originally assigned to it." },
        { status: 403 },
      ),
    };
  }
  if (device.human_user_id == null) {
    return {
      response: NextResponse.json(
        { error: "This fulfillment device is not linked to a human account." },
        { status: 409 },
      ),
    };
  }
  if (
    originalTask.fulfiller_human_user_id != null &&
    originalTask.fulfiller_human_user_id !== device.human_user_id
  ) {
    return {
      response: NextResponse.json(
        { error: "This device is not the recorded fulfiller for this order." },
        { status: 403 },
      ),
    };
  }
  if (originalTask.billing_status !== "not_charged" || originalTask.total_cents !== 0) {
    return {
      response: NextResponse.json(
        { error: "Device retry is only allowed for failed, not-charged orders." },
        { status: 409 },
      ),
    };
  }

  const failedAtMs = new Date(
    originalTask.completed_at || originalTask.updated_at || originalTask.created_at,
  ).getTime();
  if (Number.isFinite(failedAtMs) && Date.now() - failedAtMs > DEVICE_RETRY_MAX_AGE_MS) {
    return {
      response: NextResponse.json(
        { error: "This failed order is too old for device-initiated retry." },
        { status: 409 },
      ),
    };
  }

  const requester = await getHumanUserById(originalTask.human_user_id);
  if (!requester) {
    return {
      response: NextResponse.json(
        { error: "Requester account not found." },
        { status: 404 },
      ),
    };
  }

  return {
    actor: {
      requester,
      device,
      selection: "same_device_retry",
      actor: "device",
    },
  };
}

export async function POST(request: Request, context: Context) {
  const originalTask = await resolveOriginalTask(context.params.taskId ?? "");
  if (!originalTask) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  const authorization = await authorizeRetry(request, originalTask);
  if ("response" in authorization) {
    return authorization.response;
  }
  const retryActor = authorization.actor;

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

  const creditBalance = await getHumanCreditBalance(retryActor.requester.id);
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

  const selectedDevice = retryActor.device
    ? { selection: retryActor.selection, device: retryActor.device }
    : await selectComputerUseDeviceForHumanTask({
        requesterHumanUserId: retryActor.requester.id,
        fulfillmentMode: "auto",
      });
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

  const fulfillmentPlaybooks = selectFulfillmentPlaybooks({
    rawTask: originalTask.task_prompt,
    taskPrompt: originalTask.task_prompt,
    websiteUrl: originalTask.website_url,
    shippingAddress: originalTask.shipping_address,
  });
  const fulfillmentPlaybookSummaries =
    summarizeSelectedFulfillmentPlaybooks(fulfillmentPlaybooks);
  const wrappedPrompt = buildGenericTaskGoal({
    originalPrompt: originalTask.task_prompt,
    maxChargeCents: effectiveMaxCharge,
    websiteUrl: originalTask.website_url,
    shippingAddress: originalTask.shipping_address,
    clarificationMode: "human_reply_window",
    fulfillmentPlaybooks,
  });
  const run = await createComputerUseRun({
    agentUsername: humanActorUsername(retryActor.requester.id),
    deviceId: selectedDevice.device.device_id,
    taskPrompt: wrappedPrompt,
  });

  await appendComputerUseRunEvent({
    runId: run.id,
    type: "computeruse.run.created",
    data: {
      submission_source: "human",
      retry_actor: retryActor.actor,
      retry_of_task_id: originalTask.id,
      retry_of_run_id: originalTask.run_id,
      task_prompt: originalTask.task_prompt,
      requester_human_user_id: retryActor.requester.id,
      fulfiller_human_user_id: selectedDevice.device.human_user_id,
      device_id: selectedDevice.device.device_id,
      credit_balance_cents: creditBalance,
      max_charge_cents: effectiveMaxCharge,
      selection: selectedDevice.selection,
      website_url: originalTask.website_url,
      shipping_address_present: Boolean(originalTask.shipping_address),
      fulfillment_playbooks: fulfillmentPlaybookSummaries,
    },
  });

  const { task: computerUseTask } = await enqueueComputerUseLocalAgentGoalTask({
    goal: wrappedPrompt,
    deviceId: selectedDevice.device.device_id,
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
      retry_actor: retryActor.actor,
      retry_of_task_id: originalTask.id,
      requester_human_user_id: retryActor.requester.id,
      fulfiller_human_user_id: selectedDevice.device.human_user_id,
      device_id: selectedDevice.device.device_id,
      selection: selectedDevice.selection,
      fulfillment_playbooks: fulfillmentPlaybookSummaries,
    },
  });

  const retriedTask = await createGenericBrowserTask({
    agentId: HUMAN_SUBMISSION_AGENT_ID,
    agentUsernameLower: humanActorUsername(retryActor.requester.id),
    humanUserId: retryActor.requester.id,
    deviceId: selectedDevice.device.device_id,
    submissionSource: "human",
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
      type: "computeruse.run.retry_created",
      data: {
        retry_task_id: retriedTask.id,
        retry_run_id: run.id,
        retry_computeruse_task_id: computerUseTask.id,
        retry_actor: retryActor.actor,
        device_id: selectedDevice.device.device_id,
        selection: selectedDevice.selection,
        fulfillment_playbooks: fulfillmentPlaybookSummaries,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    task: formatGenericTaskForApi(retriedTask, retryActor.requester),
    run_id: run.id,
    retried_from_task_id: originalTask.id,
    fulfillment_playbooks: fulfillmentPlaybookSummaries,
    fulfillment: {
      selection: selectedDevice.selection,
      device_id: selectedDevice.device.device_id,
      fulfiller_human_user_id: selectedDevice.device.human_user_id,
      device_label: selectedDevice.device.label,
    },
  });
}
