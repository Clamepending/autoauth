import { NextResponse } from "next/server";
import {
  appendComputerUseRunEvent,
  createComputerUseRun,
  markComputerUseRunWaitingForTask,
} from "@/lib/computeruse-runs";
import { getBaseUrl } from "@/lib/base-url";
import {
  enqueueComputerUseLocalAgentGoalTask,
  getDefaultComputerUseDeviceForHuman,
} from "@/lib/computeruse-store";
import {
  buildGenericTaskGoal,
  normalizeOptionalShippingAddress,
} from "@/lib/computeruse-task-prompts";
import {
  createGenericBrowserTask,
  formatGenericTaskForApi,
} from "@/lib/generic-browser-tasks";
import { getHumanCreditBalance } from "@/lib/human-accounts";
import {
  getMarketServiceById,
  getMarketServiceCallById,
} from "@/lib/market-services";
import { getStandardFulfillmentService } from "@/lib/standard-fulfillment-services";

export const dynamic = "force-dynamic";

type Context = {
  params: {
    serviceKey: string;
  };
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function optionalPositiveInt(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatStructuredValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => formatStructuredValue(item))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function detailLine(label: string, value: unknown) {
  const formatted = formatStructuredValue(value);
  return formatted ? `${label}: ${formatted}` : null;
}

function centsLine(label: string, value: unknown) {
  const cents = optionalPositiveInt(value);
  return cents == null ? null : `${label}: $${(cents / 100).toFixed(2)}`;
}

function buildBuyerPrompt(params: {
  definitionName: string;
  promptPrefix: string;
  input: Record<string, unknown>;
  reason: unknown;
}) {
  const request = firstString([
    params.input.request,
    params.input.task_prompt,
    params.input.prompt,
    params.input.order,
    params.input.item,
    params.input.search_query,
    params.input.item_url,
    params.input.listing_url,
    params.reason,
  ]);
  const fulfillmentMethod = firstString([
    params.input.fulfillment_method,
    params.input.method,
  ]);
  const notes = firstString([params.input.notes, params.input.instructions]);
  const emailBody = firstString([
    params.input.body,
    params.input.email_body,
    params.input.message,
  ]);
  const structuredDetails = [
    detailLine("Email to", params.input.to ?? params.input.email_to ?? params.input.recipient),
    detailLine("Email CC", params.input.cc),
    detailLine("Email BCC", params.input.bcc),
    detailLine("Email subject", params.input.subject),
    emailBody ? `Email body:\n${emailBody}` : null,
    detailLine("Send mode", params.input.send_mode),
    detailLine("Listing URL", params.input.item_url ?? params.input.listing_url ?? params.input.url),
    detailLine("Search query", params.input.search_query),
    centsLine(
      "Max item price",
      params.input.max_item_price_cents ?? params.input.max_price_cents,
    ),
    detailLine("Requested condition", params.input.condition),
    detailLine("Buy It Now only", params.input.buy_now_only),
    detailLine("Quantity", params.input.quantity),
  ].filter((part): part is string => Boolean(part));

  if (!request && !fulfillmentMethod && !notes && structuredDetails.length === 0) {
    return "";
  }

  const parts = [
    params.promptPrefix,
    request ? `Buyer request for ${params.definitionName}: ${request}` : null,
    fulfillmentMethod ? `Requested fulfillment method: ${fulfillmentMethod}` : null,
    ...structuredDetails,
    notes ? `Additional requester notes: ${notes}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.join("\n\n");
}

export async function POST(request: Request, context: Context) {
  const definition = getStandardFulfillmentService(context.params.serviceKey);
  if (!definition) {
    return NextResponse.json({ error: "Unknown standard fulfillment service." }, { status: 404 });
  }

  const serviceId = Number(request.headers.get("x-ottoauth-service-id") ?? 0);
  const callId = request.headers.get("x-ottoauth-call-id")?.trim() ?? "";
  if (!Number.isInteger(serviceId) || serviceId <= 0 || !callId) {
    return NextResponse.json(
      { error: "Missing OttoAuth Pay service/call headers." },
      { status: 402 },
    );
  }

  const [call, service, body] = await Promise.all([
    getMarketServiceCallById(callId),
    getMarketServiceById(serviceId),
    request.json().catch(() => null) as Promise<Record<string, unknown> | null>,
  ]);
  if (!call || !service || call.service_id !== service.id) {
    return NextResponse.json({ error: "Market service call not found." }, { status: 404 });
  }
  if (call.status !== "pending") {
    return NextResponse.json({ error: "Market service call is not pending." }, { status: 409 });
  }
  if (service.capability !== definition.capability) {
    return NextResponse.json({ error: "Service capability mismatch." }, { status: 409 });
  }
  if (!service.owner_agent_id || !service.owner_agent_username_lower) {
    return NextResponse.json(
      { error: "This standard fulfillment service is not linked to an agent." },
      { status: 409 },
    );
  }

  const input = asObject(body?.input);
  const taskPrompt = buildBuyerPrompt({
    definitionName: definition.name,
    promptPrefix: definition.promptPrefix,
    input,
    reason: body?.reason,
  });
  if (!taskPrompt) {
    return NextResponse.json(
      { error: "A request or structured service input is required for this fulfillment service." },
      { status: 400 },
    );
  }

  let deliveryAddress: string | null = null;
  try {
    deliveryAddress = normalizeOptionalShippingAddress(
      input.delivery_address ?? input.shipping_address,
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid delivery address." },
      { status: 400 },
    );
  }

  const [creditBalance, device] = await Promise.all([
    getHumanCreditBalance(call.buyer_human_user_id),
    getDefaultComputerUseDeviceForHuman(call.provider_human_user_id),
  ]);
  if (creditBalance <= 0) {
    return NextResponse.json(
      { error: "The buyer has no OttoAuth credits remaining." },
      { status: 402 },
    );
  }
  if (!device) {
    return NextResponse.json(
      { error: "The provider does not have an enabled fulfillment device." },
      { status: 409 },
    );
  }

  const requestedMaxCharge = optionalPositiveInt(
    input.max_charge_cents ?? input.spend_cap_cents,
  );
  const effectiveMaxCharge = requestedMaxCharge ?? creditBalance;
  if (effectiveMaxCharge > creditBalance) {
    return NextResponse.json(
      {
        error: `Requested max charge exceeds the buyer's current credit balance (${creditBalance} cents available).`,
      },
      { status: 402 },
    );
  }

  const wrappedPrompt = buildGenericTaskGoal({
    originalPrompt: taskPrompt,
    maxChargeCents: effectiveMaxCharge,
    websiteUrl: definition.websiteUrl,
    shippingAddress: deliveryAddress,
    clarificationMode: "human_reply_window",
  });

  const run = await createComputerUseRun({
    agentUsername: service.owner_agent_username_lower,
    deviceId: device.device_id,
    taskPrompt: wrappedPrompt,
  });
  await appendComputerUseRunEvent({
    runId: run.id,
    type: "market.standard_fulfillment.created",
    data: {
      service_id: service.id,
      service_key: definition.key,
      market_call_id: call.id,
      buyer_human_user_id: call.buyer_human_user_id,
      provider_human_user_id: call.provider_human_user_id,
      device_id: device.device_id,
      max_charge_cents: effectiveMaxCharge,
    },
  });

  const { task } = await enqueueComputerUseLocalAgentGoalTask({
    goal: wrappedPrompt,
    deviceId: device.device_id,
    source: "computeruse_tasks",
    agentUsername: service.owner_agent_username_lower,
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
      task_kind: "market_standard_fulfillment",
      service_id: service.id,
      market_call_id: call.id,
      device_id: device.device_id,
    },
  });

  const createdTask = await createGenericBrowserTask({
    agentId: service.owner_agent_id,
    agentUsernameLower: service.owner_agent_username_lower,
    humanUserId: call.buyer_human_user_id,
    deviceId: device.device_id,
    submissionSource: "human",
    fulfillerHumanUserId: call.provider_human_user_id,
    taskPrompt,
    taskTitle: definition.name,
    websiteUrl: definition.websiteUrl,
    shippingAddress: deliveryAddress,
    maxChargeCents: effectiveMaxCharge,
    runId: run.id,
    computeruseTaskId: task.id,
  });

  const orderUrl = `${getBaseUrl()}/orders/${createdTask.id}`;
  return NextResponse.json({
    ok: true,
    status: "queued",
    task_id: createdTask.id,
    order_url: orderUrl,
    task: formatGenericTaskForApi(createdTask),
    run_id: run.id,
    summary: `${definition.name} queued on ${device.label || device.device_id}.`,
  });
}
