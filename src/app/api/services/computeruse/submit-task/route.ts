import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import {
  appendComputerUseRunEvent,
  createComputerUseRun,
  markComputerUseRunWaitingForTask,
} from "@/lib/computeruse-runs";
import {
  enqueueComputerUseLocalAgentGoalTask,
  selectInternalComputerUseDevice,
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
  ensureOttoAuthInternalHumanUser,
  getHumanCreditBalance,
  getHumanLinkForAgentUsername,
  getHumanUserById,
} from "@/lib/human-accounts";
import {
  defaultX402TopUpCents,
  requireX402Funding,
} from "@/lib/x402-ottoauth";

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

  const [humanLink, selection] = await Promise.all([
    getHumanLinkForAgentUsername(auth.usernameLower),
    selectInternalComputerUseDevice(),
  ]);
  if (!selection?.device) {
    return NextResponse.json(
      {
        error:
          "OttoAuth internal fulfillment is not available right now. Try again shortly.",
      },
      { status: 409 },
    );
  }
  const device = selection.device;

  const linkedHuman = humanLink
    ? await getHumanUserById(humanLink.human_user_id)
    : null;
  if (humanLink && !linkedHuman) {
    return NextResponse.json(
      { error: "Linked human account no longer exists." },
      { status: 404 },
    );
  }
  const humanUser = linkedHuman ?? (await ensureOttoAuthInternalHumanUser());
  const hasLinkedHuman = Boolean(linkedHuman);
  const creditBalance = await getHumanCreditBalance(humanUser.id);

  const requestedCap =
    requestedMaxCharge == null ? null : Math.trunc(requestedMaxCharge);
  const defaultTopUpCents = defaultX402TopUpCents();
  const guestPaymentCents = requestedCap ?? defaultTopUpCents;
  const fundingRequiredCents = hasLinkedHuman
    ? creditBalance <= 0
      ? requestedCap ?? defaultTopUpCents
      : requestedCap != null && requestedCap > creditBalance
        ? requestedCap - creditBalance
        : 0
    : guestPaymentCents;
  let responseHeaders: Headers | null = null;
  if (fundingRequiredCents > 0) {
    const funding = await requireX402Funding({
      request,
      humanUserId: humanUser.id,
      amountCents: fundingRequiredCents,
      resourcePath: "/api/services/computeruse/submit-task",
      description: hasLinkedHuman
        ? "Fund OttoAuth credits for delegated browser checkout"
        : "Pay OttoAuth for internal browser checkout",
      reason: hasLinkedHuman ? "linked_agent_credit_topup" : "guest_agent_checkout",
      agentUsernameLower: auth.usernameLower,
      metadata: {
        linked_human: hasLinkedHuman,
        requested_max_charge_cents: requestedCap,
        task_title: taskTitle || null,
      },
    });
    if (!funding.ok) return funding.response;
    responseHeaders = funding.responseHeaders;
  }

  const availableAfterFunding = hasLinkedHuman
    ? creditBalance + fundingRequiredCents
    : fundingRequiredCents;
  const effectiveMaxCharge =
    requestedCap == null ? availableAfterFunding : requestedCap;
  if (effectiveMaxCharge <= 0) {
    return NextResponse.json(
      { error: "max_charge_cents must be positive if provided." },
      { status: 400 },
    );
  }
  if (hasLinkedHuman && requestedCap != null && effectiveMaxCharge > availableAfterFunding) {
    return NextResponse.json(
      {
        error: `Requested max charge exceeds the human's current funded balance (${availableAfterFunding} cents available).`,
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
      funded_via_x402_cents: fundingRequiredCents,
      linked_human: hasLinkedHuman,
      max_charge_cents: effectiveMaxCharge,
      website_url: websiteUrl,
      selection: selection.selection,
      fulfillment_provider: "ottoauth_internal",
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
      linked_human: hasLinkedHuman,
      selection: selection.selection,
      fulfillment_provider: "ottoauth_internal",
    },
  });

  const createdTask = await createGenericBrowserTask({
    agentId: auth.agent.id,
    agentUsernameLower: auth.usernameLower,
    humanUserId: humanUser.id,
    deviceId: device.device_id,
    submissionSource: "agent",
    fulfillerHumanUserId: null,
    taskPrompt,
    taskTitle: taskTitle || taskPrompt.slice(0, 80),
    websiteUrl,
    shippingAddress,
    maxChargeCents: effectiveMaxCharge,
    runId: run.id,
    computeruseTaskId: task.id,
  });

  const response = NextResponse.json({
    ok: true,
    task: formatGenericTaskForApi(createdTask),
    run_id: run.id,
    linked_human: hasLinkedHuman,
    human_credit_balance: `$${(availableAfterFunding / 100).toFixed(2)}`,
    x402_funded_cents: fundingRequiredCents,
    fulfillment: {
      selection: selection.selection,
      provider: "ottoauth_internal",
    },
    note:
      "Generic browser task queued. OttoAuth will complete it through internal fulfillment and debit credits after execution finishes.",
  });
  responseHeaders?.forEach((value, key) => response.headers.set(key, value));
  return response;
}
