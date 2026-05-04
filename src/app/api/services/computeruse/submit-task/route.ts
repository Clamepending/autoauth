import { NextResponse } from "next/server";
import { authenticateAgent } from "@/services/_shared/auth";
import {
  appendComputerUseRunEvent,
  createComputerUseRun,
  markComputerUseRunFinalState,
  markComputerUseRunWaitingForTask,
} from "@/lib/computeruse-runs";
import {
  enqueueComputerUseLocalAgentGoalTask,
  selectInternalComputerUseDevice,
} from "@/lib/computeruse-store";
import {
  completeGenericBrowserTaskDirectly,
  createGenericBrowserTask,
  formatGenericTaskForApi,
} from "@/lib/generic-browser-tasks";
import { buildGenericTaskGoal } from "@/lib/computeruse-task-prompts";
import {
  selectFulfillmentPlaybooks,
  summarizeSelectedFulfillmentPlaybooks,
} from "@/lib/fulfillment-playbooks";
import {
  evaluateCommerceMandate,
  formatCommerceMandateDecisionForApi,
  normalizeCommerceMandateFromPayload,
} from "@/lib/commerce-mandates";
import {
  formatCommerceRoutePlanForApi,
  planCommerceRoute,
} from "@/lib/commerce-router";
import { executeCommerceApiCheckout } from "@/lib/commerce-api-adapters";
import {
  ensureOttoAuthInternalHumanUser,
  getHumanCreditBalance,
  getHumanLinkForAgentUsername,
  getHumanUserById,
} from "@/lib/human-accounts";
import { normalizePurchaseRequestPayload } from "@/lib/purchase-request";
import {
  defaultX402TopUpCents,
  requireX402Funding,
} from "@/lib/x402-ottoauth";

function hasDirectApiCheckoutPayload(payload: Record<string, unknown>) {
  return Boolean(
    payload.api_checkout ||
      payload.apiCheckout ||
      payload.vendor_api ||
      payload.vendorApi ||
      Array.isArray(payload.items) ||
      Array.isArray(payload.parts) ||
      Array.isArray(payload.line_items) ||
      Array.isArray(payload.model_urls) ||
      Array.isArray(payload.modelUrls) ||
      Array.isArray(payload.file_urls) ||
      Array.isArray(payload.fileUrls),
  );
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

  let purchaseRequest: ReturnType<typeof normalizePurchaseRequestPayload>;
  try {
    purchaseRequest = normalizePurchaseRequestPayload(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid task request." },
      { status: 400 },
    );
  }
  const {
    taskPrompt,
    taskTitle,
    rawTask,
    merchantName,
    platformHint,
    fulfillment,
    pickupLocation,
    websiteUrl,
    shippingAddress,
    urlPolicy,
    maxChargeCents: requestedMaxCharge,
    requestJson,
  } = purchaseRequest;

  const submittedMaxCharge =
    requestedMaxCharge == null ? null : Math.trunc(requestedMaxCharge);
  if (submittedMaxCharge != null && submittedMaxCharge <= 0) {
    return NextResponse.json(
      { error: "max_charge_cents must be positive if provided." },
      { status: 400 },
    );
  }

  let commerceMandate: ReturnType<typeof normalizeCommerceMandateFromPayload>;
  try {
    commerceMandate = normalizeCommerceMandateFromPayload(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid commerce mandate.",
      },
      { status: 400 },
    );
  }

  const commerceRoutePlan = planCommerceRoute({
    rawTask,
    taskPrompt,
    websiteUrl,
    merchantName,
    platformHint,
    fulfillment,
    requestJson,
    apiCheckoutRequested: hasDirectApiCheckoutPayload(payload),
  });
  const commerceRouteForApi = formatCommerceRoutePlanForApi(commerceRoutePlan);
  const commerceMandateDecision = evaluateCommerceMandate({
    mandate: commerceMandate,
    merchantName,
    platformHint,
    rawTask,
    taskPrompt,
    requestJson,
    maxChargeCents: submittedMaxCharge,
    category: commerceRoutePlan.category,
  });
  const commerceMandateForApi =
    formatCommerceMandateDecisionForApi(commerceMandateDecision);
  if (!commerceMandateDecision.ok) {
    return NextResponse.json(
      {
        error:
          commerceMandateDecision.status === "approval_required"
            ? "Commerce mandate requires approval before OttoAuth can queue this order."
            : "Commerce mandate rejected this order.",
        commerce_route: commerceRouteForApi,
        commerce_mandate: commerceMandateForApi,
      },
      { status: 403 },
    );
  }

  const humanLink = await getHumanLinkForAgentUsername(auth.usernameLower);

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

  const requestedCap = commerceMandateDecision.effectiveMaxChargeCents;
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
        commerce_preferred_rail: commerceRoutePlan.preferredRail,
        commerce_execution_rail: commerceRoutePlan.executionRail,
        commerce_adapter_id: commerceRoutePlan.adapterId,
        commerce_mandate_id: commerceMandate?.id ?? null,
        commerce_mandate_status: commerceMandateDecision.status,
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
  if (hasLinkedHuman && requestedCap != null && effectiveMaxCharge > availableAfterFunding) {
    return NextResponse.json(
      {
        error: `Requested max charge exceeds the human's current funded balance (${availableAfterFunding} cents available).`,
      },
      { status: 402 },
    );
  }

  if (commerceRoutePlan.fulfillmentCategory === "api") {
    const apiDeviceId = `api:${commerceRoutePlan.adapterId}`;
    const run = await createComputerUseRun({
      agentUsername: auth.usernameLower,
      deviceId: apiDeviceId,
      taskPrompt,
    });
    await appendComputerUseRunEvent({
      runId: run.id,
      type: "commerce.api.run.created",
      data: {
        task_prompt: taskPrompt,
        raw_task: rawTask,
        device_id: apiDeviceId,
        human_user_id: humanUser.id,
        credit_balance_cents: creditBalance,
        funded_via_x402_cents: fundingRequiredCents,
        linked_human: hasLinkedHuman,
        max_charge_cents: effectiveMaxCharge,
        website_url: websiteUrl,
        url_policy: urlPolicy,
        fulfillment_provider: commerceRoutePlan.executionRail,
        fulfillment_category: commerceRoutePlan.fulfillmentCategory,
        commerce_route: commerceRouteForApi,
        commerce_mandate: commerceMandateForApi,
        shipping_address_present: Boolean(shippingAddress),
      },
    });

    const createdTask = await createGenericBrowserTask({
      agentId: auth.agent.id,
      agentUsernameLower: auth.usernameLower,
      humanUserId: humanUser.id,
      deviceId: apiDeviceId,
      submissionSource: "agent",
      fulfillerHumanUserId: null,
      taskPrompt,
      taskTitle,
      websiteUrl,
      shippingAddress,
      maxChargeCents: effectiveMaxCharge,
      runId: run.id,
      computeruseTaskId: null,
      fulfillmentProvider: commerceRoutePlan.executionRail,
      commerceAdapterId: commerceRoutePlan.adapterId,
      commerceFulfillmentCategory: commerceRoutePlan.fulfillmentCategory,
      commerceRoute: commerceRouteForApi,
      commerceMandate: commerceMandateForApi,
    });

    await appendComputerUseRunEvent({
      runId: run.id,
      type: "commerce.api.checkout.started",
      data: {
        task_id: createdTask.id,
        adapter_id: commerceRoutePlan.adapterId,
        merchant_key: commerceRoutePlan.merchantKey,
        max_charge_cents: effectiveMaxCharge,
      },
    });

    const apiResult = await executeCommerceApiCheckout({
      payload,
      purchaseRequest,
      routePlan: commerceRoutePlan,
      maxChargeCents: effectiveMaxCharge,
    });
    await appendComputerUseRunEvent({
      runId: run.id,
      type:
        apiResult.status === "completed"
          ? "commerce.api.checkout.completed"
          : "commerce.api.checkout.failed",
      data: {
        task_id: createdTask.id,
        adapter_id: commerceRoutePlan.adapterId,
        result: apiResult.result,
        error: apiResult.error,
      },
    });
    await markComputerUseRunFinalState({
      runId: run.id,
      status: apiResult.status,
      result: apiResult.result,
      error: apiResult.error,
    });
    const finalized = await completeGenericBrowserTaskDirectly({
      taskId: createdTask.id,
      status: apiResult.status,
      result: apiResult.result,
      error: apiResult.error,
    });
    const taskForApi = finalized?.task ?? createdTask;
    const response = NextResponse.json({
      ok: apiResult.status === "completed",
      task: formatGenericTaskForApi(taskForApi),
      run_id: run.id,
      commerce_route: commerceRouteForApi,
      commerce_mandate: commerceMandateForApi,
      linked_human: hasLinkedHuman,
      human_credit_balance: `$${(availableAfterFunding / 100).toFixed(2)}`,
      x402_funded_cents: fundingRequiredCents,
      fulfillment: {
        selection: {
          mode: "api",
          adapter_id: commerceRoutePlan.adapterId,
        },
        provider: commerceRoutePlan.executionRail,
        category: commerceRoutePlan.fulfillmentCategory,
      },
      note:
        apiResult.status === "completed"
          ? "Order completed through a direct vendor API adapter."
          : "Direct vendor API checkout failed before internal fallback. Inspect task.error and run events.",
    });
    responseHeaders?.forEach((value, key) => response.headers.set(key, value));
    return response;
  }

  const selection = await selectInternalComputerUseDevice();
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

  const fulfillmentPlaybooks = selectFulfillmentPlaybooks({
    rawTask,
    taskPrompt,
    websiteUrl,
    merchantName,
    platformHint,
    fulfillment,
    pickupLocation,
    shippingAddress,
    requestJson,
  });
  const fulfillmentPlaybookSummaries =
    summarizeSelectedFulfillmentPlaybooks(fulfillmentPlaybooks);
  const wrappedPrompt = buildGenericTaskGoal({
    originalPrompt: taskPrompt,
    maxChargeCents: effectiveMaxCharge,
    websiteUrl,
    urlPolicy,
    shippingAddress,
    clarificationMode: "agent_webhook",
    fulfillmentPlaybooks,
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
      raw_task: rawTask,
      device_id: device.device_id,
      human_user_id: humanUser.id,
      credit_balance_cents: creditBalance,
      funded_via_x402_cents: fundingRequiredCents,
      linked_human: hasLinkedHuman,
      max_charge_cents: effectiveMaxCharge,
      website_url: websiteUrl,
      url_policy: urlPolicy,
      selection: selection.selection,
      fulfillment_provider: commerceRoutePlan.executionRail,
      fulfillment_category: commerceRoutePlan.fulfillmentCategory,
      commerce_route: commerceRouteForApi,
      commerce_mandate: commerceMandateForApi,
      shipping_address_present: Boolean(shippingAddress),
      fulfillment_playbooks: fulfillmentPlaybookSummaries,
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
      fulfillment_provider: commerceRoutePlan.executionRail,
      fulfillment_category: commerceRoutePlan.fulfillmentCategory,
      commerce_route: commerceRouteForApi,
      commerce_mandate: commerceMandateForApi,
      fulfillment_playbooks: fulfillmentPlaybookSummaries,
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
    taskTitle,
    websiteUrl,
    shippingAddress,
    maxChargeCents: effectiveMaxCharge,
    runId: run.id,
    computeruseTaskId: task.id,
    fulfillmentProvider: commerceRoutePlan.executionRail,
    commerceAdapterId: commerceRoutePlan.adapterId,
    commerceFulfillmentCategory: commerceRoutePlan.fulfillmentCategory,
    commerceRoute: commerceRouteForApi,
    commerceMandate: commerceMandateForApi,
  });

  const response = NextResponse.json({
    ok: true,
    task: formatGenericTaskForApi(createdTask),
    run_id: run.id,
    commerce_route: commerceRouteForApi,
    commerce_mandate: commerceMandateForApi,
    fulfillment_playbooks: fulfillmentPlaybookSummaries,
    linked_human: hasLinkedHuman,
    human_credit_balance: `$${(availableAfterFunding / 100).toFixed(2)}`,
    x402_funded_cents: fundingRequiredCents,
    fulfillment: {
      selection: selection.selection,
      provider: commerceRoutePlan.executionRail,
      category: commerceRoutePlan.fulfillmentCategory,
    },
    note:
      "General order task queued. OttoAuth will complete it through internal fulfillment and debit credits after execution finishes.",
  });
  responseHeaders?.forEach((value, key) => response.headers.set(key, value));
  return response;
}
