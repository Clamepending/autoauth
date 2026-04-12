import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import {
  appendComputerUseRunEvent,
  createComputerUseRun,
  markComputerUseRunWaitingForTask,
} from "@/lib/computeruse-runs";
import {
  enqueueComputerUseLocalAgentGoalTask,
  getDefaultComputerUseDeviceForHuman,
} from "@/lib/computeruse-store";
import {
  createGenericBrowserTask,
  formatGenericTaskForApi,
} from "@/lib/generic-browser-tasks";
import {
  buildGenericTaskGoal,
  normalizeOptionalShippingAddress,
  normalizeOptionalWebsiteUrl,
} from "@/lib/computeruse-task-prompts";
import {
  getHumanCreditBalance,
  getHumanLinkForAgentUsername,
  getHumanUserById,
} from "@/lib/human-accounts";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

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

  if (!taskPrompt) {
    return NextResponse.json(
      { error: "task_prompt is required." },
      { status: 400 },
    );
  }

  const humanLink = await getHumanLinkForAgentUsername(auth.usernameLower);
  if (!humanLink) {
    return NextResponse.json(
      {
        error:
          "This agent is not linked to any human yet. Ask the human to sign in to OttoAuth and paste the pairing key into their dashboard.",
      },
      { status: 409 },
    );
  }

  const [humanUser, creditBalance, device] = await Promise.all([
    getHumanUserById(humanLink.human_user_id),
    getHumanCreditBalance(humanLink.human_user_id),
    getDefaultComputerUseDeviceForHuman(humanLink.human_user_id),
  ]);
  if (!humanUser) {
    return NextResponse.json(
      { error: "Linked human account no longer exists." },
      { status: 404 },
    );
  }
  if (!device) {
    return NextResponse.json(
      {
        error:
          "The linked human has not claimed an OttoAuth browser device yet. They need to generate a device claim code in the dashboard and pair the extension.",
      },
      { status: 409 },
    );
  }
  if (creditBalance <= 0) {
    return NextResponse.json(
      { error: "The linked human account has no credits remaining." },
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
        error: `Requested max charge exceeds the human's current credit balance (${creditBalance} cents available).`,
      },
      { status: 402 },
    );
  }

  const wrappedPrompt = buildGenericTaskGoal({
    originalPrompt: taskPrompt,
    maxChargeCents: effectiveMaxCharge,
    websiteUrl,
    shippingAddress,
    clarificationMode: "agent_webhook",
  });

  const run = await createComputerUseRun({
    agentUsername: auth.usernameLower,
    deviceId: device.device_id,
    taskPrompt: wrappedPrompt,
  });
  await appendComputerUseRunEvent({
    runId: run.id,
    type: "computeruse.run.created",
    data: {
      task_prompt: taskPrompt,
      device_id: device.device_id,
      human_user_id: humanUser.id,
      credit_balance_cents: creditBalance,
      max_charge_cents: effectiveMaxCharge,
      website_url: websiteUrl,
      shipping_address_present: Boolean(shippingAddress),
    },
  });

  const { task } = await enqueueComputerUseLocalAgentGoalTask({
    goal: wrappedPrompt,
    deviceId: device.device_id,
    source: "computeruse_tasks",
    agentUsername: auth.usernameLower,
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
      device_id: device.device_id,
      human_user_id: humanUser.id,
    },
  });

  const createdTask = await createGenericBrowserTask({
    agentId: auth.agent.id,
    agentUsernameLower: auth.usernameLower,
    humanUserId: humanUser.id,
    deviceId: device.device_id,
    submissionSource: "agent",
    fulfillerHumanUserId: device.human_user_id,
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
    task: formatGenericTaskForApi(createdTask),
    run_id: run.id,
    human_credit_balance: `$${(creditBalance / 100).toFixed(2)}`,
    note:
      "Generic browser task queued. OttoAuth will complete it on the human's claimed device and debit credits after execution finishes.",
  });
}
