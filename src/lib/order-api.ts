import { NextResponse } from "next/server";

import { getAgentByPrivateKey, type AgentRecord } from "@/lib/db";
import { verifyPrivateKey } from "@/lib/agent-auth";
import {
  ensureOttoAuthInternalHumanUser,
  getHumanCreditBalance,
  getHumanLinkForAgentUsername,
  getHumanUserById,
} from "@/lib/human-accounts";
import {
  createOrchestratedOrder,
  getOrderByPublicIdOrId,
  parseOrderForApi,
  type OttoAuthOrderRecord,
} from "@/lib/order-orchestration";
import { authenticateAgent } from "@/services/_shared/auth";
import {
  defaultX402TopUpCents,
  requireX402Funding,
} from "@/lib/x402-ottoauth";

export type AgentOrderAuth = {
  agent: AgentRecord;
  usernameLower: string;
};

export async function readJsonObject(request: Request) {
  const payload = (await request.json().catch(() => null)) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
    };
  }
  return { ok: true as const, payload: payload as Record<string, unknown> };
}

export function responseFromOrderError(error: unknown, fallbackStatus = 409) {
  const message = error instanceof Error ? error.message : "Order operation failed.";
  const lower = message.toLowerCase();
  const status =
    lower.includes("not found")
      ? 404
      : lower.includes("not authorized")
        ? 403
        : lower.includes("credit") || lower.includes("fund")
          ? 402
          : lower.includes("invalid") ||
              lower.includes("required") ||
              lower.includes("needs") ||
              lower.includes("must")
            ? 400
            : fallbackStatus;
  return NextResponse.json({ error: message }, { status });
}

export async function authenticateOrderAgentFromRequest(
  request: Request,
  payload: Record<string, unknown>,
): Promise<{ ok: true; auth: AgentOrderAuth } | { ok: false; response: NextResponse }> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    const agent = await getAgentByPrivateKey(bearer);
    if (!agent || !verifyPrivateKey(bearer, agent.private_key)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Invalid bearer token." }, { status: 401 }),
      };
    }
    return { ok: true, auth: { agent, usernameLower: agent.username_lower } };
  }

  const auth = await authenticateAgent(payload);
  if (!auth.ok) return { ok: false, response: auth.response };
  return { ok: true, auth: { agent: auth.agent, usernameLower: auth.usernameLower } };
}

function optionalString(value: unknown, maxLength = 2000) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function normalizeIdempotencyKey(request: Request, payload: Record<string, unknown>) {
  return optionalString(
    request.headers.get("idempotency-key") ??
      payload.idempotency_key ??
      payload.idempotencyKey,
    200,
  );
}

function normalizeExternalId(payload: Record<string, unknown>) {
  return optionalString(
    payload.external_id ??
      payload.externalId ??
      payload.reference_id ??
      payload.referenceId,
    200,
  );
}

function normalizeCallbackUrl(payload: Record<string, unknown>, agent: AgentRecord) {
  const raw = optionalString(
    payload.callback_url ??
      payload.callbackUrl ??
      payload.webhook_url ??
      payload.webhookUrl ??
      agent.callback_url,
    2000,
  );
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function requestedCap(payload: Record<string, unknown>) {
  const value =
    payload.max_charge_cents ??
    payload.maxChargeCents ??
    payload.max_spend_cents ??
    payload.maxSpendCents;
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export async function createOrderForAgentRequest(params: {
  request: Request;
  payload: Record<string, unknown>;
  auth: AgentOrderAuth;
  resourcePath: string;
}) {
  const humanLink = await getHumanLinkForAgentUsername(params.auth.usernameLower);
  const linkedHuman = humanLink ? await getHumanUserById(humanLink.human_user_id) : null;
  if (humanLink && !linkedHuman) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Linked human account no longer exists." },
        { status: 404 },
      ),
    };
  }

  const humanUser = linkedHuman ?? (await ensureOttoAuthInternalHumanUser());
  const hasLinkedHuman = Boolean(linkedHuman);
  const creditBalance = await getHumanCreditBalance(humanUser.id);
  const cap = requestedCap(params.payload);
  const defaultTopUpCents = defaultX402TopUpCents();
  const fundingRequiredCents = hasLinkedHuman
    ? creditBalance <= 0
      ? cap ?? defaultTopUpCents
      : cap != null && cap > creditBalance
        ? cap - creditBalance
        : 0
    : cap ?? defaultTopUpCents;

  let responseHeaders: Headers | null = null;
  if (fundingRequiredCents > 0) {
    const funding = await requireX402Funding({
      request: params.request,
      humanUserId: humanUser.id,
      amountCents: fundingRequiredCents,
      resourcePath: params.resourcePath,
      description: hasLinkedHuman
        ? "Fund OttoAuth credits for delegated order fulfillment"
        : "Pay OttoAuth for delegated order fulfillment",
      reason: hasLinkedHuman ? "linked_agent_order_topup" : "guest_agent_order",
      agentUsernameLower: params.auth.usernameLower,
      metadata: {
        linked_human: hasLinkedHuman,
        requested_max_charge_cents: cap,
        order_source: "order_orchestration",
      },
    });
    if (!funding.ok) return { ok: false as const, response: funding.response };
    responseHeaders = funding.responseHeaders;
  }

  const availableAfterFunding = hasLinkedHuman
    ? creditBalance + fundingRequiredCents
    : fundingRequiredCents;
  const effectiveMaxCharge = cap == null ? availableAfterFunding : cap;
  if (effectiveMaxCharge <= 0) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "max_charge_cents must be positive if provided." },
        { status: 400 },
      ),
    };
  }
  if (hasLinkedHuman && cap != null && cap > availableAfterFunding) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: `Requested max charge exceeds the human's current funded balance (${availableAfterFunding} cents available).`,
        },
        { status: 402 },
      ),
    };
  }

  const created = await createOrchestratedOrder({
    agentId: params.auth.agent.id,
    agentUsernameLower: params.auth.usernameLower,
    humanUserId: humanUser.id,
    submissionSource: "agent",
    payload: params.payload,
    maxChargeCents: effectiveMaxCharge,
    callbackUrl: normalizeCallbackUrl(params.payload, params.auth.agent),
    externalId: normalizeExternalId(params.payload),
    idempotencyKey: normalizeIdempotencyKey(params.request, params.payload),
  });

  return {
    ok: true as const,
    responseHeaders,
    humanUser,
    linkedHuman: hasLinkedHuman,
    availableAfterFunding,
    fundedCents: fundingRequiredCents,
    ...created,
  };
}

export async function requireAgentOrderAccess(params: {
  request: Request;
  payload: Record<string, unknown>;
  orderId: string;
}) {
  const auth = await authenticateOrderAgentFromRequest(params.request, params.payload);
  if (!auth.ok) return auth;
  const order = await getOrderByPublicIdOrId(params.orderId);
  if (!order) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Order not found." }, { status: 404 }),
    };
  }
  if (order.agent_username_lower !== auth.auth.usernameLower) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Not authorized to access this order." },
        { status: 403 },
      ),
    };
  }
  return { ok: true as const, auth: auth.auth, order };
}

export function orderApiBody(order: OttoAuthOrderRecord | null) {
  if (!order) return null;
  const apiOrder = parseOrderForApi(order);
  const request =
    apiOrder.request && typeof apiOrder.request === "object" && !Array.isArray(apiOrder.request)
      ? (apiOrder.request as Record<string, unknown>)
      : null;
  const normalized =
    request?.normalized && typeof request.normalized === "object" && !Array.isArray(request.normalized)
      ? (request.normalized as Record<string, unknown>)
      : null;
  const title = typeof normalized?.title === "string" ? normalized.title : order.public_id;
  return {
    order: apiOrder,
    task: {
      id: order.id,
      public_id: order.public_id,
      status: order.status,
      task_title: title,
      fulfillment_mode: order.fulfillment_mode,
      provider_id: order.provider_id,
    },
  };
}
