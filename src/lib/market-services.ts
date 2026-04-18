import crypto from "node:crypto";
import { ensureSchema } from "@/lib/db";
import {
  addCreditLedgerEntry,
  getHumanCreditBalance,
} from "@/lib/human-accounts";
import { getTursoClient } from "@/lib/turso";

export type MarketServiceVisibility = "public" | "unlisted";
export type MarketServiceStatus = "enabled" | "disabled";
export type MarketServiceRail = "ottoauth_ledger" | "x402_usdc";
export type MarketServiceCallStatus = "pending" | "settled" | "failed" | "refunded";

export type MarketServiceRecord = {
  id: number;
  owner_human_user_id: number;
  owner_agent_id: number | null;
  owner_agent_username_lower: string | null;
  name: string;
  capability: string;
  description: string;
  endpoint_url: string;
  price_cents: number;
  input_schema_json: string | null;
  output_schema_json: string | null;
  examples_json: string | null;
  tags_json: string;
  visibility: MarketServiceVisibility;
  status: MarketServiceStatus;
  supported_rails_json: string;
  refund_policy: string | null;
  rating_count: number;
  rating_average: number | null;
  call_count: number;
  created_at: string;
  updated_at: string;
};

export type MarketServiceCallRecord = {
  id: string;
  service_id: number;
  buyer_human_user_id: number;
  buyer_agent_id: number | null;
  provider_human_user_id: number;
  amount_cents: number;
  rail: MarketServiceRail;
  status: MarketServiceCallStatus;
  input_json: string | null;
  output_json: string | null;
  reason: string | null;
  task_id: string | null;
  idempotency_key: string;
  receipt_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type MarketServiceReceipt = {
  receipt_id: string;
  service_id: number;
  call_id: string;
  buyer_human_user_id: number;
  provider_human_user_id: number;
  amount_cents: number;
  currency: "usd";
  rail: MarketServiceRail;
  status: MarketServiceCallStatus;
  task_id: string | null;
  endpoint_origin: string;
  created_at: string;
  signature: string | null;
};

let schemaReady = false;

function nowIso() {
  return new Date().toISOString();
}

function asInt(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function asString(value: unknown, maxLength = 1000) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : "";
}

function nullableString(value: unknown, maxLength = 4000) {
  const text = asString(value, maxLength);
  return text || null;
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function jsonOrNull(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify({ text: value });
    }
  }
  return JSON.stringify(value);
}

function normalizeTags(value: unknown) {
  const tags = parseJsonArray(value)
    .map((tag) => asString(tag, 40).toLowerCase())
    .filter(Boolean);
  return JSON.stringify([...new Set(tags)].slice(0, 20));
}

function normalizeRails(value: unknown): MarketServiceRail[] {
  const rails = parseJsonArray(value)
    .map((rail) => asString(rail, 40))
    .filter((rail): rail is MarketServiceRail =>
      rail === "ottoauth_ledger" || rail === "x402_usdc",
    );
  return rails.length > 0 ? [...new Set(rails)] : ["ottoauth_ledger"];
}

function mapServiceRow(row: Record<string, unknown>): MarketServiceRecord {
  return {
    id: Number(row.id),
    owner_human_user_id: Number(row.owner_human_user_id),
    owner_agent_id: row.owner_agent_id == null ? null : Number(row.owner_agent_id),
    owner_agent_username_lower:
      row.owner_agent_username_lower == null
        ? null
        : String(row.owner_agent_username_lower),
    name: String(row.name || ""),
    capability: String(row.capability || ""),
    description: String(row.description || ""),
    endpoint_url: String(row.endpoint_url || ""),
    price_cents: Number(row.price_cents || 0),
    input_schema_json:
      row.input_schema_json == null ? null : String(row.input_schema_json),
    output_schema_json:
      row.output_schema_json == null ? null : String(row.output_schema_json),
    examples_json: row.examples_json == null ? null : String(row.examples_json),
    tags_json: String(row.tags_json || "[]"),
    visibility: String(row.visibility || "public") as MarketServiceVisibility,
    status: String(row.status || "enabled") as MarketServiceStatus,
    supported_rails_json: String(row.supported_rails_json || "[\"ottoauth_ledger\"]"),
    refund_policy: row.refund_policy == null ? null : String(row.refund_policy),
    rating_count: Number(row.rating_count || 0),
    rating_average:
      row.rating_average == null || row.rating_average === ""
        ? null
        : Number(row.rating_average),
    call_count: Number(row.call_count || 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapCallRow(row: Record<string, unknown>): MarketServiceCallRecord {
  return {
    id: String(row.id),
    service_id: Number(row.service_id),
    buyer_human_user_id: Number(row.buyer_human_user_id),
    buyer_agent_id: row.buyer_agent_id == null ? null : Number(row.buyer_agent_id),
    provider_human_user_id: Number(row.provider_human_user_id),
    amount_cents: Number(row.amount_cents || 0),
    rail: String(row.rail || "ottoauth_ledger") as MarketServiceRail,
    status: String(row.status || "pending") as MarketServiceCallStatus,
    input_json: row.input_json == null ? null : String(row.input_json),
    output_json: row.output_json == null ? null : String(row.output_json),
    reason: row.reason == null ? null : String(row.reason),
    task_id: row.task_id == null ? null : String(row.task_id),
    idempotency_key: String(row.idempotency_key || ""),
    receipt_json: row.receipt_json == null ? null : String(row.receipt_json),
    error: row.error == null ? null : String(row.error),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: row.completed_at == null ? null : String(row.completed_at),
  };
}

export function serviceTags(service: Pick<MarketServiceRecord, "tags_json">) {
  return parseJsonArray(service.tags_json)
    .map((tag) => asString(tag, 40))
    .filter(Boolean);
}

export function serviceRails(service: Pick<MarketServiceRecord, "supported_rails_json">) {
  return normalizeRails(service.supported_rails_json);
}

export function centsToUsd(cents: number) {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

export async function ensureMarketServiceSchema() {
  if (schemaReady) return;
  await ensureSchema();
  const client = getTursoClient();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS market_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_human_user_id INTEGER NOT NULL,
      owner_agent_id INTEGER,
      owner_agent_username_lower TEXT,
      name TEXT NOT NULL,
      capability TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      endpoint_url TEXT NOT NULL,
      price_cents INTEGER NOT NULL DEFAULT 0,
      input_schema_json TEXT,
      output_schema_json TEXT,
      examples_json TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'public',
      status TEXT NOT NULL DEFAULT 'enabled',
      supported_rails_json TEXT NOT NULL DEFAULT '["ottoauth_ledger"]',
      refund_policy TEXT,
      rating_count INTEGER NOT NULL DEFAULT 0,
      rating_average REAL,
      call_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS market_service_calls (
      id TEXT PRIMARY KEY,
      service_id INTEGER NOT NULL,
      buyer_human_user_id INTEGER NOT NULL,
      buyer_agent_id INTEGER,
      provider_human_user_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      rail TEXT NOT NULL DEFAULT 'ottoauth_ledger',
      status TEXT NOT NULL DEFAULT 'pending',
      input_json TEXT,
      output_json TEXT,
      reason TEXT,
      task_id TEXT,
      idempotency_key TEXT NOT NULL,
      receipt_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )
  `);
  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_market_service_calls_buyer_idempotency
      ON market_service_calls (buyer_human_user_id, idempotency_key)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_market_services_search
      ON market_services (status, visibility, name, capability, owner_agent_username_lower)
  `);
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_market_service_calls_service
      ON market_service_calls (service_id, created_at)
  `);
  schemaReady = true;
}

export async function listMarketServices(params: {
  query?: string | null;
  includeUnlisted?: boolean;
  limit?: number;
}) {
  await ensureMarketServiceSchema();
  const client = getTursoClient();
  const query = asString(params.query, 200).toLowerCase();
  const limit = Math.max(1, Math.min(params.limit ?? 50, 100));
  const args: Array<string | number> = [];
  const clauses = ["status = 'enabled'"];
  if (!params.includeUnlisted) {
    clauses.push("visibility = 'public'");
  }
  if (query) {
    clauses.push(`(
      lower(name) LIKE ?
      OR lower(capability) LIKE ?
      OR lower(description) LIKE ?
      OR lower(endpoint_url) LIKE ?
      OR lower(owner_agent_username_lower) LIKE ?
      OR lower(tags_json) LIKE ?
    )`);
    const like = `%${query}%`;
    args.push(like, like, like, like, like, like);
  }
  args.push(limit);
  const result = await client.execute({
    sql: `SELECT * FROM market_services
          WHERE ${clauses.join(" AND ")}
          ORDER BY call_count DESC, updated_at DESC
          LIMIT ?`,
    args,
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map(mapServiceRow);
}

export async function getMarketServiceById(serviceId: number) {
  await ensureMarketServiceSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM market_services WHERE id = ? LIMIT 1",
    args: [serviceId],
  });
  const row = (result.rows ?? [])[0] as Record<string, unknown> | undefined;
  return row ? mapServiceRow(row) : null;
}

export async function getMarketServiceCallById(callId: string) {
  await ensureMarketServiceSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM market_service_calls WHERE id = ? LIMIT 1",
    args: [callId],
  });
  const row = (result.rows ?? [])[0] as Record<string, unknown> | undefined;
  return row ? mapCallRow(row) : null;
}

export async function createMarketService(params: {
  ownerHumanUserId: number;
  ownerAgentId?: number | null;
  ownerAgentUsernameLower?: string | null;
  name: unknown;
  capability: unknown;
  description?: unknown;
  endpointUrl: unknown;
  priceCents: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  examples?: unknown;
  tags?: unknown;
  visibility?: unknown;
  supportedRails?: unknown;
  refundPolicy?: unknown;
}) {
  await ensureMarketServiceSchema();
  const name = asString(params.name, 120);
  const capability = asString(params.capability, 120);
  const endpointUrl = asString(params.endpointUrl, 1000);
  const priceCents = asInt(params.priceCents);
  if (!name) throw new Error("Service name is required.");
  if (!capability) throw new Error("Capability is required.");
  if (!endpointUrl || !/^https?:\/\//i.test(endpointUrl)) {
    throw new Error("A valid http(s) endpoint_url is required.");
  }
  if (priceCents < 0) throw new Error("price_cents must be non-negative.");

  const now = nowIso();
  const visibility =
    asString(params.visibility, 20) === "unlisted" ? "unlisted" : "public";
  const rails = normalizeRails(params.supportedRails);
  const client = getTursoClient();
  const result = await client.execute({
    sql: `INSERT INTO market_services (
            owner_human_user_id, owner_agent_id, owner_agent_username_lower,
            name, capability, description, endpoint_url, price_cents,
            input_schema_json, output_schema_json, examples_json, tags_json,
            visibility, status, supported_rails_json, refund_policy,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enabled', ?, ?, ?, ?)
          RETURNING *`,
    args: [
      params.ownerHumanUserId,
      params.ownerAgentId ?? null,
      params.ownerAgentUsernameLower?.trim().toLowerCase() || null,
      name,
      capability,
      asString(params.description, 2000),
      endpointUrl,
      priceCents,
      jsonOrNull(params.inputSchema),
      jsonOrNull(params.outputSchema),
      jsonOrNull(params.examples),
      normalizeTags(params.tags),
      visibility,
      JSON.stringify(rails),
      nullableString(params.refundPolicy, 2000),
      now,
      now,
    ],
  });
  return mapServiceRow(result.rows[0] as Record<string, unknown>);
}

export async function updateMarketService(params: {
  serviceId: number;
  ownerHumanUserId: number;
  patch: Record<string, unknown>;
}) {
  await ensureMarketServiceSchema();
  const existing = await getMarketServiceById(params.serviceId);
  if (!existing) throw new Error("Service not found.");
  if (existing.owner_human_user_id !== params.ownerHumanUserId) {
    throw new Error("Only the provider can update this service.");
  }

  const patch = params.patch;
  const next = {
    name: patch.name == null ? existing.name : asString(patch.name, 120),
    capability:
      patch.capability == null ? existing.capability : asString(patch.capability, 120),
    description:
      patch.description == null
        ? existing.description
        : asString(patch.description, 2000),
    endpoint_url:
      patch.endpoint_url == null
        ? existing.endpoint_url
        : asString(patch.endpoint_url, 1000),
    price_cents:
      patch.price_cents == null ? existing.price_cents : asInt(patch.price_cents),
    input_schema_json:
      patch.input_schema == null
        ? existing.input_schema_json
        : jsonOrNull(patch.input_schema),
    output_schema_json:
      patch.output_schema == null
        ? existing.output_schema_json
        : jsonOrNull(patch.output_schema),
    examples_json:
      patch.examples == null ? existing.examples_json : jsonOrNull(patch.examples),
    tags_json: patch.tags == null ? existing.tags_json : normalizeTags(patch.tags),
    visibility:
      patch.visibility == null
        ? existing.visibility
        : asString(patch.visibility, 20) === "unlisted"
          ? "unlisted"
          : "public",
    status:
      patch.status == null
        ? existing.status
        : asString(patch.status, 20) === "disabled"
          ? "disabled"
          : "enabled",
    supported_rails_json:
      patch.supported_rails == null
        ? existing.supported_rails_json
        : JSON.stringify(normalizeRails(patch.supported_rails)),
    refund_policy:
      patch.refund_policy == null
        ? existing.refund_policy
        : nullableString(patch.refund_policy, 2000),
  };
  if (!next.name) throw new Error("Service name is required.");
  if (!next.capability) throw new Error("Capability is required.");
  if (!next.endpoint_url || !/^https?:\/\//i.test(next.endpoint_url)) {
    throw new Error("A valid http(s) endpoint_url is required.");
  }
  if (next.price_cents < 0) throw new Error("price_cents must be non-negative.");

  const client = getTursoClient();
  const result = await client.execute({
    sql: `UPDATE market_services
          SET name = ?, capability = ?, description = ?, endpoint_url = ?,
              price_cents = ?, input_schema_json = ?, output_schema_json = ?,
              examples_json = ?, tags_json = ?, visibility = ?, status = ?,
              supported_rails_json = ?, refund_policy = ?, updated_at = ?
          WHERE id = ?
          RETURNING *`,
    args: [
      next.name,
      next.capability,
      next.description,
      next.endpoint_url,
      next.price_cents,
      next.input_schema_json,
      next.output_schema_json,
      next.examples_json,
      next.tags_json,
      next.visibility,
      next.status,
      next.supported_rails_json,
      next.refund_policy,
      nowIso(),
      params.serviceId,
    ],
  });
  return mapServiceRow(result.rows[0] as Record<string, unknown>);
}

function buildReceipt(params: {
  call: MarketServiceCallRecord;
  service: MarketServiceRecord;
  status: MarketServiceCallStatus;
}) {
  const endpointOrigin = new URL(params.service.endpoint_url).origin;
  const receipt: Omit<MarketServiceReceipt, "signature"> = {
    receipt_id: `otpay_${params.call.id}`,
    service_id: params.service.id,
    call_id: params.call.id,
    buyer_human_user_id: params.call.buyer_human_user_id,
    provider_human_user_id: params.call.provider_human_user_id,
    amount_cents: params.call.amount_cents,
    currency: "usd",
    rail: params.call.rail,
    status: params.status,
    task_id: params.call.task_id,
    endpoint_origin: endpointOrigin,
    created_at: nowIso(),
  };
  const secret = process.env.OTTOAUTH_RECEIPT_SECRET?.trim();
  const signature = secret
    ? crypto
        .createHmac("sha256", secret)
        .update(JSON.stringify(receipt))
        .digest("hex")
    : null;
  return { ...receipt, signature } satisfies MarketServiceReceipt;
}

async function invokeProviderEndpoint(params: {
  service: MarketServiceRecord;
  callId: string;
  input: unknown;
  reason: string | null;
  taskId: string | null;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(params.service.endpoint_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OttoAuth-Service-Id": String(params.service.id),
        "X-OttoAuth-Call-Id": params.callId,
        "X-OttoAuth-Capability": params.service.capability,
      },
      body: JSON.stringify({
        service_id: params.service.id,
        call_id: params.callId,
        capability: params.service.capability,
        input: params.input,
        reason: params.reason,
        task_id: params.taskId,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { text };
    }
    if (!response.ok) {
      throw new Error(
        typeof parsed === "object" && parsed && "error" in parsed
          ? String((parsed as { error?: unknown }).error)
          : `Provider endpoint failed with HTTP ${response.status}.`,
      );
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callMarketService(params: {
  serviceId: number;
  buyerHumanUserId: number;
  buyerAgentId?: number | null;
  input?: unknown;
  maxPriceCents: number;
  reason?: string | null;
  taskId?: string | null;
  idempotencyKey: string;
}) {
  await ensureMarketServiceSchema();
  const client = getTursoClient();
  const idempotencyKey = asString(params.idempotencyKey, 200);
  if (!idempotencyKey) throw new Error("idempotency_key is required.");

  const existing = await client.execute({
    sql: `SELECT * FROM market_service_calls
          WHERE buyer_human_user_id = ? AND idempotency_key = ?
          LIMIT 1`,
    args: [params.buyerHumanUserId, idempotencyKey],
  });
  const existingCall = (existing.rows ?? [])[0] as Record<string, unknown> | undefined;
  if (existingCall) {
    return {
      call: mapCallRow(existingCall),
      idempotent: true,
      receipt: parseJsonObject(existingCall.receipt_json),
    };
  }

  const service = await getMarketServiceById(params.serviceId);
  if (!service || service.status !== "enabled") {
    throw new Error("Service is not available.");
  }
  if (service.visibility !== "public") {
    throw new Error("Service is not public.");
  }
  if (service.price_cents > params.maxPriceCents) {
    throw new Error(
      `Service costs ${service.price_cents} cents, above max_price_cents ${params.maxPriceCents}.`,
    );
  }
  const rails = serviceRails(service);
  if (!rails.includes("ottoauth_ledger")) {
    throw new Error("x402_usdc service calls are not configured in this OttoAuth Pay build yet.");
  }
  if (service.owner_human_user_id === params.buyerHumanUserId) {
    throw new Error("A service provider cannot pay itself through the market.");
  }
  const balance = await getHumanCreditBalance(params.buyerHumanUserId);
  if (balance < service.price_cents) {
    throw new Error("Insufficient OttoAuth credits for this service call.");
  }

  const callId = crypto.randomUUID();
  const createdAt = nowIso();
  const inputJson = params.input == null ? null : JSON.stringify(params.input);
  await client.execute({
    sql: `INSERT INTO market_service_calls (
            id, service_id, buyer_human_user_id, buyer_agent_id, provider_human_user_id,
            amount_cents, rail, status, input_json, reason, task_id,
            idempotency_key, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'ottoauth_ledger', 'pending', ?, ?, ?, ?, ?, ?)`,
    args: [
      callId,
      service.id,
      params.buyerHumanUserId,
      params.buyerAgentId ?? null,
      service.owner_human_user_id,
      service.price_cents,
      inputJson,
      nullableString(params.reason, 1000),
      nullableString(params.taskId, 200),
      idempotencyKey,
      createdAt,
      createdAt,
    ],
  });

  await addCreditLedgerEntry({
    humanUserId: params.buyerHumanUserId,
    amountCents: -service.price_cents,
    entryType: "market_service_escrow_hold",
    description: `Escrow hold for ${service.name}`,
    referenceType: "market_service_call",
    referenceId: callId,
    metadata: {
      service_id: service.id,
      capability: service.capability,
      provider_human_user_id: service.owner_human_user_id,
      idempotency_key: idempotencyKey,
    },
  });

  try {
    const output = await invokeProviderEndpoint({
      service,
      callId,
      input: params.input ?? null,
      reason: nullableString(params.reason, 1000),
      taskId: nullableString(params.taskId, 200),
    });
    await addCreditLedgerEntry({
      humanUserId: service.owner_human_user_id,
      amountCents: service.price_cents,
      entryType: "market_service_escrow_release",
      description: `Payment for ${service.name}`,
      referenceType: "market_service_call",
      referenceId: callId,
      metadata: {
        service_id: service.id,
        capability: service.capability,
        buyer_human_user_id: params.buyerHumanUserId,
        idempotency_key: idempotencyKey,
      },
    });
    const call = await getMarketServiceCallById(callId);
    if (!call) throw new Error("Service call disappeared after provider execution.");
    const receipt = buildReceipt({ call, service, status: "settled" });
    const completedAt = nowIso();
    await client.execute({
      sql: `UPDATE market_service_calls
            SET status = 'settled', output_json = ?, receipt_json = ?, updated_at = ?, completed_at = ?
            WHERE id = ?`,
      args: [
        output == null ? null : JSON.stringify(output),
        JSON.stringify(receipt),
        completedAt,
        completedAt,
        callId,
      ],
    });
    await client.execute({
      sql: `UPDATE market_services
            SET call_count = call_count + 1, updated_at = ?
            WHERE id = ?`,
      args: [completedAt, service.id],
    });
    return {
      call: await getMarketServiceCallById(callId),
      idempotent: false,
      receipt,
      output,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await addCreditLedgerEntry({
      humanUserId: params.buyerHumanUserId,
      amountCents: service.price_cents,
      entryType: "market_service_escrow_refund",
      description: `Refund for failed ${service.name} call`,
      referenceType: "market_service_call",
      referenceId: callId,
      metadata: {
        service_id: service.id,
        capability: service.capability,
        provider_human_user_id: service.owner_human_user_id,
        idempotency_key: idempotencyKey,
      },
    });
    const failedAt = nowIso();
    await client.execute({
      sql: `UPDATE market_service_calls
            SET status = 'refunded', error = ?, updated_at = ?, completed_at = ?
            WHERE id = ?`,
      args: [message, failedAt, failedAt, callId],
    });
    throw new Error(message);
  }
}
