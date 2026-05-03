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

function readTrimmedString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function readQuantity(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return readTrimmedString(value);
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return auth.response;

  const taskPrompt = readTrimmedString(payload.task_prompt, payload.taskPrompt);
  const taskTitle = readTrimmedString(payload.task_title, payload.taskTitle);
  const store = readTrimmedString(payload.store, payload.platform);
  const merchant = readTrimmedString(
    payload.merchant,
    payload.store_name,
    payload.storeName,
  );
  const orderType = readTrimmedString(
    payload.order_type,
    payload.orderType,
    payload.fulfillment_method,
    payload.fulfillmentMethod,
  );
  const itemName = readTrimmedString(
    payload.item_name,
    payload.itemName,
    payload.product,
    payload.product_name,
    payload.productName,
  );
  const quantity = readQuantity(payload.quantity);
  const orderDetails = readTrimmedString(
    payload.order_details,
    payload.orderDetails,
    payload.instructions,
  );
  const additionalInstructions = readTrimmedString(
    payload.additional_instructions,
    payload.additionalInstructions,
  );
  const structuredLines = [
    store ? `Platform: ${store}` : "",
    merchant ? `Store or merchant name: ${merchant}` : "",
    orderType ? `Fulfillment method: ${orderType}` : "",
    itemName ? `Item name: ${itemName}` : "",
    quantity ? `Quantity: ${quantity}` : "",
    orderDetails
      ? `Order details, modifiers, and preferences: ${orderDetails}`
      : "",
    additionalInstructions
      ? `Additional instructions: ${additionalInstructions}`
      : "",
  ].filter(Boolean);
  const effectiveTaskPrompt = [...structuredLines, taskPrompt]
    .filter(Boolean)
    .join("\n");
  let websiteUrl: string | null = null;
  let shippingAddress: string | null = null;
  try {
    websiteUrl = normalizeOptionalWebsiteUrl(
      payload.website_url ??
        payload.websiteUrl ??
        payload.store_url ??
        payload.storeUrl,
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

  if (!effectiveTaskPrompt) {
    return NextResponse.json(
      {
        error:
          "Provide task_prompt or structured order fields such as store, merchant, item_name, order_type, or order_details.",
      },
      { status: 400 },
    );
  }

  const humanLink = await getHumanLinkForAgentUsername(auth.usernameLower);
  if (!humanLink) {
    return NextResponse.json(
      {
        error:
          "This agent is not linked to any human yet. Ask the human to sign in to OttoAuth and generate dashboard API keys for this agent.",
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
    originalPrompt: effectiveTaskPrompt,
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
      task_prompt: effectiveTaskPrompt,
      freeform_task_prompt: taskPrompt || null,
      store: store || null,
      merchant: merchant || null,
      order_type: orderType || null,
      item_name: itemName || null,
      quantity: quantity || null,
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
    taskPrompt: effectiveTaskPrompt,
    taskTitle:
      taskTitle ||
      [merchant || store, itemName || orderType].filter(Boolean).join(": ") ||
      effectiveTaskPrompt.slice(0, 80),
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
      "General order task queued. OttoAuth will complete it on the human's claimed device and debit credits after execution finishes.",
  });
}
