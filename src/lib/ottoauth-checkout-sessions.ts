import { randomBytes } from "node:crypto";

import { getAgentById, type AgentRecord } from "@/lib/db";
import {
  getHumanCreditBalance,
  getHumanLinkForAgentUsername,
  getHumanUserById,
} from "@/lib/human-accounts";
import {
  createOrderForAgentRequest,
  type AgentOrderAuth,
} from "@/lib/order-api";
import {
  normalizeSdkAppId,
  normalizeSdkAppName,
  parseAllowedSdkReturnUrl,
} from "@/lib/ottoauth-sdk";
import { normalizeSdkCheckoutPayload } from "@/lib/ottoauth-sdk-checkout";
import type { OttoAuthAgentAuthSuccess } from "@/lib/ottoauth-api-auth";
import { resolveNonBrowserPriceQuote } from "@/lib/non-browser-price-quotes";
import { getTursoClient } from "@/lib/turso";

export type CheckoutSessionStatus =
  | "open"
  | "confirming"
  | "confirmed"
  | "canceled"
  | "expired";

export type OttoAuthCheckoutSessionRecord = {
  id: string;
  agent_id: number;
  agent_username_lower: string;
  app_id: string;
  app_name: string;
  status: CheckoutSessionStatus;
  order_json: string;
  price_quote_json: string | null;
  metadata_json: string | null;
  success_url: string | null;
  cancel_url: string | null;
  order_task_id: number | null;
  order_public_id: string | null;
  last_error: string | null;
  expires_at: string;
  confirmed_at: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
};

type SessionCreateUrls = {
  successUrl: string | null;
  cancelUrl: string | null;
};

let checkoutSessionSchemaReady = false;

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown, maxLength = 2000) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function optionalInteger(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function baseUrlFromRequest(request: Request) {
  const configuredBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (configuredBaseUrl) return configuredBaseUrl.replace(/\/+$/, "");

  const requestUrl = new URL(request.url);
  const host = request.headers.get("host")?.trim() || requestUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || requestUrl.protocol.replace(/:$/, "") || "http";
  return `${protocol}://${host}`;
}

function jsonString(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return optionalRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeSessionId() {
  return `cs_${randomBytes(18).toString("hex")}`;
}

function defaultExpiry() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function isExpired(session: OttoAuthCheckoutSessionRecord, now = new Date()) {
  return new Date(session.expires_at).getTime() <= now.getTime();
}

function mapCheckoutSessionRow(row: Record<string, unknown>): OttoAuthCheckoutSessionRecord {
  return {
    id: String(row.id),
    agent_id: Number(row.agent_id),
    agent_username_lower: String(row.agent_username_lower),
    app_id: String(row.app_id || "local-app"),
    app_name: String(row.app_name || "Local app"),
    status: String(row.status || "open") as CheckoutSessionStatus,
    order_json: String(row.order_json || "{}"),
    price_quote_json: row.price_quote_json == null ? null : String(row.price_quote_json),
    metadata_json: row.metadata_json == null ? null : String(row.metadata_json),
    success_url: row.success_url == null ? null : String(row.success_url),
    cancel_url: row.cancel_url == null ? null : String(row.cancel_url),
    order_task_id:
      row.order_task_id == null || row.order_task_id === ""
        ? null
        : Number(row.order_task_id),
    order_public_id:
      row.order_public_id == null || row.order_public_id === ""
        ? null
        : String(row.order_public_id),
    last_error: row.last_error == null ? null : String(row.last_error),
    expires_at: String(row.expires_at),
    confirmed_at: row.confirmed_at == null ? null : String(row.confirmed_at),
    canceled_at: row.canceled_at == null ? null : String(row.canceled_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function ensureCheckoutSessionSchema() {
  if (checkoutSessionSchemaReady) return;
  const client = getTursoClient();
  await client.execute(
    `CREATE TABLE IF NOT EXISTS checkout_sessions (
      id TEXT PRIMARY KEY,
      agent_id INTEGER NOT NULL,
      agent_username_lower TEXT NOT NULL,
      app_id TEXT NOT NULL,
      app_name TEXT NOT NULL,
      status TEXT NOT NULL,
      order_json TEXT NOT NULL,
      price_quote_json TEXT,
      metadata_json TEXT,
      success_url TEXT,
      cancel_url TEXT,
      order_task_id INTEGER,
      order_public_id TEXT,
      last_error TEXT,
      expires_at TEXT NOT NULL,
      confirmed_at TEXT,
      canceled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_checkout_sessions_agent ON checkout_sessions(agent_username_lower, created_at)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_checkout_sessions_status ON checkout_sessions(status, expires_at)",
  );
  checkoutSessionSchemaReady = true;
}

function normalizeSessionUrls(
  payload: Record<string, unknown>,
): SessionCreateUrls {
  const successRaw = optionalString(payload.success_url ?? payload.successUrl);
  const cancelRaw = optionalString(payload.cancel_url ?? payload.cancelUrl);
  const successUrl = successRaw && parseAllowedSdkReturnUrl(successRaw) ? successRaw : null;
  const cancelUrl = cancelRaw && parseAllowedSdkReturnUrl(cancelRaw) ? cancelRaw : null;

  if (successRaw && !successUrl) {
    throw new Error("success_url must be http(s), localhost, or an allowed SDK return origin.");
  }
  if (cancelRaw && !cancelUrl) {
    throw new Error("cancel_url must be http(s), localhost, or an allowed SDK return origin.");
  }

  return { successUrl, cancelUrl };
}

function normalizeCheckoutOrderPayload(payload: Record<string, unknown>) {
  const order = optionalRecord(payload.order) ?? optionalRecord(payload.checkout);
  const rawOrder = order ? { ...order } : { ...payload };
  delete rawOrder.success_url;
  delete rawOrder.successUrl;
  delete rawOrder.cancel_url;
  delete rawOrder.cancelUrl;
  delete rawOrder.expires_at;
  delete rawOrder.expiresAt;
  delete rawOrder.private_key;
  delete rawOrder.privateKey;
  delete rawOrder.username;

  const appId = normalizeSdkAppId(payload.app_id ?? payload.appId ?? rawOrder.app_id ?? rawOrder.appId);
  const appName = normalizeSdkAppName(
    payload.app_name ?? payload.appName ?? rawOrder.app_name ?? rawOrder.appName,
    appId,
  );
  const normalized = normalizeSdkCheckoutPayload({
    app_id: appId,
    app_name: appName,
    order: rawOrder,
  });

  if (payload.external_id != null && normalized.external_id == null) {
    normalized.external_id = payload.external_id;
  }
  if (payload.externalId != null && normalized.external_id == null) {
    normalized.external_id = payload.externalId;
  }
  if (payload.metadata != null && normalized.metadata == null) {
    normalized.metadata = payload.metadata;
  }
  if (payload.callback_url != null && normalized.callback_url == null) {
    normalized.callback_url = payload.callback_url;
  }
  if (payload.callbackUrl != null && normalized.callback_url == null) {
    normalized.callback_url = payload.callbackUrl;
  }

  delete normalized.private_key;
  delete normalized.privateKey;
  delete normalized.username;
  return {
    appId,
    appName,
    order: normalized,
  };
}

function normalizeExpiresAt(value: unknown) {
  const raw = optionalString(value, 120);
  if (!raw) return defaultExpiry();
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("expires_at must be an ISO date if provided.");
  }
  const min = Date.now() + 5 * 60 * 1000;
  const max = Date.now() + 24 * 60 * 60 * 1000;
  const timestamp = Math.max(min, Math.min(max, date.getTime()));
  return new Date(timestamp).toISOString();
}

async function resolvePreviewQuote(order: Record<string, unknown>) {
  try {
    return await resolveNonBrowserPriceQuote({
      payload: order,
      rawTask: optionalString(
        order.task ?? order.task_prompt ?? order.taskPrompt ?? order.request ?? order.prompt,
        5000,
      ),
      taskPrompt: optionalString(
        order.task ?? order.task_prompt ?? order.taskPrompt ?? order.request ?? order.prompt,
        5000,
      ),
      websiteUrl: optionalString(
        order.url ??
          order.product_url ??
          order.productUrl ??
          order.store_url ??
          order.storeUrl ??
          order.website_url ??
          order.websiteUrl,
        2000,
      ),
      merchantName: optionalString(
        order.merchant ??
          order.merchant_name ??
          order.merchantName ??
          order.store ??
          order.platform ??
          order.service,
        200,
      ),
      platformHint: optionalString(
        order.platform_hint ??
          order.platformHint ??
          order.platform ??
          order.service ??
          order.store,
        120,
      ),
      requestJson: order,
    });
  } catch (error) {
    return {
      status: "unavailable",
      source: "checkout_session_validation",
      source_label: "Checkout session validation",
      confidence: "low",
      billing_mode: "retroactive_after_fulfillment",
      total_cents: null,
      currency: "usd",
      display_total: null,
      missing_components: ["final_checkout_total"],
      message: error instanceof Error ? error.message : "Price could not be resolved.",
      billed_retroactively: true,
    };
  }
}

export async function createCheckoutSession(params: {
  request: Request;
  payload: Record<string, unknown>;
  auth: OttoAuthAgentAuthSuccess;
  baseUrl: string;
}) {
  const { appId, appName, order } = normalizeCheckoutOrderPayload(params.payload);
  const { successUrl, cancelUrl } = normalizeSessionUrls(params.payload);
  const expiresAt = normalizeExpiresAt(params.payload.expires_at ?? params.payload.expiresAt);
  const priceQuote = await resolvePreviewQuote(order);
  const sessionId = makeSessionId();
  const now = nowIso();
  const client = getTursoClient();
  await ensureCheckoutSessionSchema();
  await client.execute({
    sql: `INSERT INTO checkout_sessions (
      id, agent_id, agent_username_lower, app_id, app_name, status,
      order_json, price_quote_json, metadata_json, success_url, cancel_url,
      order_task_id, order_public_id, last_error, expires_at,
      confirmed_at, canceled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, ?)`,
    args: [
      sessionId,
      params.auth.agent.id,
      params.auth.usernameLower,
      appId,
      appName,
      JSON.stringify(order),
      JSON.stringify(priceQuote),
      jsonString(optionalRecord(params.payload.metadata) ?? optionalRecord(order.metadata)),
      successUrl,
      cancelUrl,
      expiresAt,
      now,
      now,
    ],
  });
  const session = await getCheckoutSessionById(sessionId);
  if (!session) throw new Error("Checkout session creation failed.");
  return session;
}

export async function getCheckoutSessionById(id: string) {
  await ensureCheckoutSessionSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM checkout_sessions WHERE id = ? LIMIT 1",
    args: [id],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapCheckoutSessionRow(row) : null;
}

async function updateExpiredSession(session: OttoAuthCheckoutSessionRecord) {
  if (session.status !== "open" || !isExpired(session)) return session;
  const client = getTursoClient();
  const now = nowIso();
  await client.execute({
    sql: "UPDATE checkout_sessions SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'open'",
    args: [now, session.id],
  });
  return (await getCheckoutSessionById(session.id)) ?? session;
}

export async function getFreshCheckoutSessionById(id: string) {
  const session = await getCheckoutSessionById(id);
  return session ? updateExpiredSession(session) : null;
}

export function checkoutSessionUrl(session: OttoAuthCheckoutSessionRecord, baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/checkout/${encodeURIComponent(session.id)}`;
}

export function formatCheckoutSessionForApi(
  session: OttoAuthCheckoutSessionRecord,
  baseUrl: string,
) {
  return {
    id: session.id,
    object: "checkout.session",
    status: session.status,
    url: checkoutSessionUrl(session, baseUrl),
    app: {
      id: session.app_id,
      name: session.app_name,
    },
    order: parseJsonObject(session.order_json),
    price_quote: parseJsonObject(session.price_quote_json),
    metadata: parseJsonObject(session.metadata_json),
    success_url: session.success_url,
    cancel_url: session.cancel_url,
    order_id: session.order_public_id,
    order_task_id: session.order_task_id,
    last_error: session.last_error,
    expires_at: session.expires_at,
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}

export async function checkoutSessionDisplay(session: OttoAuthCheckoutSessionRecord) {
  const [agent, link] = await Promise.all([
    getAgentById(session.agent_id),
    getHumanLinkForAgentUsername(session.agent_username_lower),
  ]);
  const humanUser = link ? await getHumanUserById(link.human_user_id) : null;
  const balanceCents = humanUser ? await getHumanCreditBalance(humanUser.id) : null;
  return {
    session: formatCheckoutSessionForApi(session, ""),
    rawOrder: parseJsonObject(session.order_json) ?? {},
    priceQuote: parseJsonObject(session.price_quote_json),
    agent,
    linkedHuman: humanUser
      ? {
          id: humanUser.id,
          email: humanUser.email,
          display_name: humanUser.display_name,
          balance_cents: balanceCents ?? 0,
        }
      : null,
  };
}

function replacementUrl(
  rawUrl: string | null,
  params: {
    sessionId: string;
    orderId: string | null;
    taskId: number | null;
    status: string;
  },
) {
  if (!rawUrl) return null;
  const replacements: Array<[string, string]> = [
    ["{CHECKOUT_SESSION_ID}", params.sessionId],
    ["{SESSION_ID}", params.sessionId],
    ["{ORDER_ID}", params.orderId ?? ""],
    ["{TASK_ID}", params.taskId == null ? "" : String(params.taskId)],
    ["{STATUS}", params.status],
  ];
  return replacements.reduce(
    (url, [token, value]) => url.split(token).join(encodeURIComponent(value)),
    rawUrl,
  );
}

function confirmedCheckoutResult(params: {
  session: OttoAuthCheckoutSessionRecord;
  request: Request;
  baseUrl?: string;
}) {
  return {
    ok: true as const,
    session: params.session,
    orderId: params.session.order_public_id,
    taskId: params.session.order_task_id,
    redirectUrl:
      replacementUrl(params.session.success_url, {
        sessionId: params.session.id,
        orderId: params.session.order_public_id,
        taskId: params.session.order_task_id,
        status: "confirmed",
      }) ??
      `${params.baseUrl ?? baseUrlFromRequest(params.request)}/orders/${params.session.order_task_id}`,
    reused: true,
  };
}

async function waitForCheckoutConfirmation(sessionId: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(175);
    const latest = await getCheckoutSessionById(sessionId);
    if (!latest || latest.status !== "confirming") return latest;
  }
  return getCheckoutSessionById(sessionId);
}

export async function confirmCheckoutSession(params: {
  request: Request;
  sessionId: string;
  baseUrl?: string;
  maxChargeCents?: number | null;
}) {
  const session = await getFreshCheckoutSessionById(params.sessionId);
  if (!session) {
    return { ok: false as const, status: 404, error: "Checkout session not found." };
  }
  if (session.status === "confirmed") {
    return confirmedCheckoutResult({
      session,
      request: params.request,
      baseUrl: params.baseUrl,
    });
  }
  if (session.status === "confirming") {
    const latest = await waitForCheckoutConfirmation(session.id);
    if (latest?.status === "confirmed") {
      return confirmedCheckoutResult({
        session: latest,
        request: params.request,
        baseUrl: params.baseUrl,
      });
    }
    return {
      ok: false as const,
      status: 409,
      error:
        latest?.status === "confirming"
          ? "This checkout is still being confirmed. Refresh in a moment."
          : latest?.last_error
            ? String(latest.last_error)
            : `Checkout session is ${latest?.status ?? "not available"}.`,
      session: latest ?? session,
    };
  }
  if (session.status !== "open") {
    return {
      ok: false as const,
      status: 409,
      error: `Checkout session is ${session.status}.`,
      session,
    };
  }

  const agent = await getAgentById(session.agent_id);
  if (!agent) {
    return { ok: false as const, status: 404, error: "Agent not found.", session };
  }

  const orderPayload = parseJsonObject(session.order_json);
  if (!orderPayload) {
    return { ok: false as const, status: 400, error: "Checkout session order is invalid.", session };
  }
  if (!orderPayload.idempotency_key && !orderPayload.idempotencyKey) {
    orderPayload.idempotency_key = `checkout-session-${session.id}`;
  }
  if (params.maxChargeCents != null) {
    const maxChargeCents = Math.trunc(params.maxChargeCents);
    if (!Number.isFinite(maxChargeCents) || maxChargeCents <= 0) {
      return {
        ok: false as const,
        status: 400,
        error: "Spend cap must be a positive dollar amount.",
        session,
      };
    }
    orderPayload.max_charge_cents = maxChargeCents;
  }

  const client = getTursoClient();
  const lockedAt = nowIso();
  const lock = await client.execute({
    sql: "UPDATE checkout_sessions SET status = 'confirming', last_error = NULL, updated_at = ? WHERE id = ? AND status = 'open'",
    args: [lockedAt, session.id],
  });
  if ((lock.rowsAffected ?? 0) === 0) {
    let latest = await getCheckoutSessionById(session.id);
    if (latest?.status === "confirming") {
      latest = await waitForCheckoutConfirmation(session.id);
    }
    if (latest?.status === "confirmed") {
      return confirmedCheckoutResult({
        session: latest,
        request: params.request,
        baseUrl: params.baseUrl,
      });
    }
    return {
      ok: false as const,
      status: 409,
      error:
        latest?.status === "confirming"
          ? "This checkout is still being confirmed. Refresh in a moment."
          : latest?.last_error
            ? String(latest.last_error)
            : `Checkout session is ${latest?.status ?? "not available"}.`,
      session: latest ?? session,
    };
  }

  const auth: AgentOrderAuth = {
    agent: agent as AgentRecord,
    usernameLower: session.agent_username_lower,
  };
  const baseUrl = params.baseUrl ?? baseUrlFromRequest(params.request);
  const created = await createOrderForAgentRequest({
    request: params.request,
    payload: orderPayload,
    auth,
    resourcePath: `/checkout/${session.id}/confirm`,
  });
  if (!created.ok) {
    let error = "Could not create order.";
    try {
      const body = (await created.response.clone().json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) error = body.error.trim();
    } catch {
      error = created.response.statusText || error;
    }
    const now = nowIso();
    await client.execute({
      sql: "UPDATE checkout_sessions SET status = 'open', last_error = ?, updated_at = ? WHERE id = ? AND status = 'confirming'",
      args: [error, now, session.id],
    });
    return {
      ok: false as const,
      status: created.response.status,
      error,
      session: (await getCheckoutSessionById(session.id)) ?? session,
    };
  }

  const publicOrderId = created.order.public_id;
  const now = nowIso();
  await client.execute({
    sql: `UPDATE checkout_sessions
          SET status = 'confirmed',
              order_task_id = ?,
              order_public_id = ?,
              confirmed_at = ?,
              last_error = NULL,
              updated_at = ?
          WHERE id = ? AND status = 'confirming'`,
    args: [created.order.id, publicOrderId, now, now, session.id],
  });
  const confirmed = (await getCheckoutSessionById(session.id)) ?? session;
  return {
    ok: true as const,
    session: confirmed,
    orderId: publicOrderId,
    taskId: created.order.id,
    order: created.order,
    redirectUrl:
      replacementUrl(session.success_url, {
        sessionId: session.id,
        orderId: publicOrderId,
        taskId: created.order.id,
        status: "confirmed",
      }) ?? `${baseUrl}/admindash/fulfillment/${publicOrderId}`,
    reused: false,
  };
}

export async function cancelCheckoutSession(params: {
  sessionId: string;
  baseUrl: string;
}) {
  const session = await getFreshCheckoutSessionById(params.sessionId);
  if (!session) {
    return { ok: false as const, status: 404, error: "Checkout session not found." };
  }
  if (session.status === "open") {
    const now = nowIso();
    await getTursoClient().execute({
      sql: "UPDATE checkout_sessions SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?",
      args: [now, now, session.id],
    });
  }
  const updated = (await getCheckoutSessionById(session.id)) ?? session;
  return {
    ok: true as const,
    session: updated,
    redirectUrl:
      replacementUrl(updated.cancel_url, {
        sessionId: updated.id,
        orderId: updated.order_public_id,
        taskId: updated.order_task_id,
        status: "canceled",
      }) ?? checkoutSessionUrl(updated, params.baseUrl),
  };
}

export function orderSummaryFromPayload(order: Record<string, unknown>) {
  const files = Array.isArray(order.files)
    ? (order.files as Array<Record<string, unknown>>).filter((file) => optionalRecord(file))
    : [];
  return {
    title:
      optionalString(order.task_title ?? order.taskTitle ?? order.title, 120) ??
      optionalString(order.item_name ?? order.itemName, 120) ??
      "OttoAuth order",
    task: optionalString(order.task ?? order.task_prompt ?? order.taskPrompt, 3000) ?? "",
    merchant:
      optionalString(order.merchant_name ?? order.merchantName ?? order.merchant ?? order.store, 120) ??
      optionalString(order.platform_hint ?? order.platformHint, 120) ??
      "OttoAuth fulfillment",
    maxChargeCents: optionalInteger(order.max_charge_cents ?? order.maxChargeCents),
    shippingAddress: optionalString(order.shipping_address ?? order.shippingAddress, 1200),
    files: files.map((file, index) => ({
      index,
      name:
        optionalString(file.name ?? file.filename ?? file.label, 180) ??
        `Attachment ${index + 1}`,
      url: optionalString(file.url ?? file.download_url ?? file.downloadUrl, 2000),
      purpose: optionalString(file.purpose, 240),
      contentType: optionalString(file.content_type ?? file.contentType ?? file.format, 120),
    })),
  };
}
