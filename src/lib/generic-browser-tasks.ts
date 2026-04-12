import { ensureSchema } from "@/lib/db";
import {
  addCreditLedgerEntry,
  getHumanCreditBalance,
  getHumanUserById,
  type HumanUserRecord,
} from "@/lib/human-accounts";
import {
  calculateInferenceCostCents,
  type ModelUsageRecord,
} from "@/lib/model-pricing";
import { sendOrderCompletionEmail } from "@/lib/order-completion-email";
import { getTursoClient } from "@/lib/turso";
import { makeAgentClarificationDeadline } from "@/lib/computeruse-agent-clarification-config";

export type GenericBrowserTaskStatus =
  | "queued"
  | "running"
  | "awaiting_agent_clarification"
  | "completed"
  | "failed";

export type GenericBrowserTaskClarificationCallbackStatus =
  | "not_requested"
  | "sent"
  | "failed"
  | "timed_out";

export type GenericBrowserTaskBillingStatus =
  | "pending"
  | "debited"
  | "completed_no_charge"
  | "not_charged";

export type GenericBrowserTaskSubmissionSource = "agent" | "human";

export type GenericBrowserTaskPayoutStatus =
  | "pending"
  | "credited"
  | "self_fulfilled"
  | "not_applicable"
  | "not_charged";

export type GenericBrowserTaskRecord = {
  id: number;
  agent_id: number;
  agent_username_lower: string;
  human_user_id: number;
  device_id: string;
  submission_source: GenericBrowserTaskSubmissionSource;
  fulfiller_human_user_id: number | null;
  task_title: string | null;
  task_prompt: string;
  website_url: string | null;
  shipping_address: string | null;
  max_charge_cents: number | null;
  status: GenericBrowserTaskStatus;
  billing_status: GenericBrowserTaskBillingStatus;
  payout_cents: number;
  payout_status: GenericBrowserTaskPayoutStatus;
  payout_credited_at: string | null;
  merchant: string | null;
  currency: string;
  goods_cents: number;
  shipping_cents: number;
  tax_cents: number;
  other_cents: number;
  inference_cents: number;
  total_cents: number;
  input_tokens: number;
  output_tokens: number;
  run_id: string | null;
  computeruse_task_id: string | null;
  result_json: string | null;
  pickup_details: GenericBrowserTaskPickupDetails | null;
  pickup_summary: string | null;
  tracking_details: GenericBrowserTaskTrackingDetails | null;
  tracking_summary: string | null;
  fulfillment_details_missing: boolean;
  usage_json: string | null;
  clarification_request: string | null;
  clarification_requested_at: string | null;
  clarification_deadline_at: string | null;
  clarification_response: string | null;
  clarification_responded_at: string | null;
  clarification_callback_status: GenericBrowserTaskClarificationCallbackStatus;
  clarification_callback_http_status: number | null;
  clarification_callback_error: string | null;
  clarification_callback_last_attempt_at: string | null;
  summary: string | null;
  error: string | null;
  requester_rating: number | null;
  requester_rating_at: string | null;
  charged_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type HumanFulfillmentRatingStats = {
  human_user_id: number;
  submitted_task_count: number;
  fulfilled_task_count: number;
  rating_count: number;
  average_rating: number | null;
};

export type GenericBrowserTaskSnapshotRecord = {
  id: number;
  task_id: number;
  run_id: string | null;
  computeruse_task_id: string | null;
  device_id: string;
  image_base64: string;
  width: number | null;
  height: number | null;
  tabs: Array<{
    id: number;
    title: string;
    url: string;
    active: boolean;
  }>;
  created_at: string;
};

function isDuplicateColumnError(error: unknown, columnName: string) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.toLowerCase().includes(`duplicate column name: ${columnName}`.toLowerCase());
}

async function safeAddColumn(
  client: ReturnType<typeof getTursoClient>,
  sql: string,
  columnName: string,
) {
  try {
    await client.execute(sql);
  } catch (error) {
    if (isDuplicateColumnError(error, columnName)) {
      return;
    }
    throw error;
  }
}

export type GenericBrowserTaskPickupDetails = {
  order_number: string | null;
  confirmation_code: string | null;
  pickup_code: string | null;
  ready_time: string | null;
  pickup_name: string | null;
  instructions: string | null;
  order_reference: string | null;
  receipt_url: string | null;
  receipt_text: string | null;
};

export type GenericBrowserTaskTrackingDetails = {
  tracking_number: string | null;
  tracking_url: string | null;
  carrier: string | null;
  status: string | null;
  delivery_eta: string | null;
  delivery_window: string | null;
  instructions: string | null;
};

let schemaReady = false;

function mapTaskRow(row: Record<string, unknown>): GenericBrowserTaskRecord {
  const resultJson = row.result_json == null ? null : String(row.result_json);
  const parsedResult = parseJsonObject(resultJson);
  const pickupDetails = extractPickupDetails(parsedResult);
  const trackingDetails = extractTrackingDetails(parsedResult);
  return {
    id: Number(row.id),
    agent_id: Number(row.agent_id),
    agent_username_lower: String(row.agent_username_lower),
    human_user_id: Number(row.human_user_id),
    device_id: String(row.device_id),
    submission_source: String(row.submission_source || "agent") as GenericBrowserTaskSubmissionSource,
    fulfiller_human_user_id:
      row.fulfiller_human_user_id == null || row.fulfiller_human_user_id === ""
        ? null
        : Number(row.fulfiller_human_user_id),
    task_title: row.task_title == null ? null : String(row.task_title),
    task_prompt: String(row.task_prompt),
    website_url: row.website_url == null ? null : String(row.website_url),
    shipping_address:
      row.shipping_address == null ? null : String(row.shipping_address),
    max_charge_cents:
      row.max_charge_cents == null || row.max_charge_cents === ""
        ? null
        : Number(row.max_charge_cents),
    status: String(row.status) as GenericBrowserTaskStatus,
    billing_status: String(row.billing_status) as GenericBrowserTaskBillingStatus,
    payout_cents: Number(row.payout_cents ?? 0),
    payout_status: String(row.payout_status || "pending") as GenericBrowserTaskPayoutStatus,
    payout_credited_at:
      row.payout_credited_at == null ? null : String(row.payout_credited_at),
    merchant: row.merchant == null ? null : String(row.merchant),
    currency: String(row.currency || "usd"),
    goods_cents: Number(row.goods_cents ?? 0),
    shipping_cents: Number(row.shipping_cents ?? 0),
    tax_cents: Number(row.tax_cents ?? 0),
    other_cents: Number(row.other_cents ?? 0),
    inference_cents: Number(row.inference_cents ?? 0),
    total_cents: Number(row.total_cents ?? 0),
    input_tokens: Number(row.input_tokens ?? 0),
    output_tokens: Number(row.output_tokens ?? 0),
    run_id: row.run_id == null ? null : String(row.run_id),
    computeruse_task_id:
      row.computeruse_task_id == null ? null : String(row.computeruse_task_id),
    result_json: resultJson,
    pickup_details: pickupDetails,
    pickup_summary: formatPickupSummary(pickupDetails),
    tracking_details: trackingDetails,
    tracking_summary: formatTrackingSummary(trackingDetails),
    fulfillment_details_missing: areFulfillmentDetailsMissing({
      status: String(row.status),
      totalCents: Number(row.total_cents ?? 0),
      pickupDetails,
      trackingDetails,
    }),
    usage_json: row.usage_json == null ? null : String(row.usage_json),
    clarification_request:
      row.clarification_request == null ? null : String(row.clarification_request),
    clarification_requested_at:
      row.clarification_requested_at == null
        ? null
        : String(row.clarification_requested_at),
    clarification_deadline_at:
      row.clarification_deadline_at == null
        ? null
        : String(row.clarification_deadline_at),
    clarification_response:
      row.clarification_response == null ? null : String(row.clarification_response),
    clarification_responded_at:
      row.clarification_responded_at == null
        ? null
        : String(row.clarification_responded_at),
    clarification_callback_status: String(
      row.clarification_callback_status || "not_requested",
    ) as GenericBrowserTaskClarificationCallbackStatus,
    clarification_callback_http_status:
      row.clarification_callback_http_status == null ||
      row.clarification_callback_http_status === ""
        ? null
        : Number(row.clarification_callback_http_status),
    clarification_callback_error:
      row.clarification_callback_error == null
        ? null
        : String(row.clarification_callback_error),
    clarification_callback_last_attempt_at:
      row.clarification_callback_last_attempt_at == null
        ? null
        : String(row.clarification_callback_last_attempt_at),
    summary: row.summary == null ? null : String(row.summary),
    error: row.error == null ? null : String(row.error),
    requester_rating:
      row.requester_rating == null || row.requester_rating === ""
        ? null
        : Number(row.requester_rating),
    requester_rating_at:
      row.requester_rating_at == null ? null : String(row.requester_rating_at),
    charged_at: row.charged_at == null ? null : String(row.charged_at),
    completed_at: row.completed_at == null ? null : String(row.completed_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapSnapshotRow(row: Record<string, unknown>): GenericBrowserTaskSnapshotRecord {
  let tabs: GenericBrowserTaskSnapshotRecord["tabs"] = [];
  if (row.tabs_json != null && row.tabs_json !== "") {
    try {
      const parsed = JSON.parse(String(row.tabs_json));
      if (Array.isArray(parsed)) {
        tabs = parsed
          .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const record = entry as Record<string, unknown>;
            const id = Number(record.id);
            if (!Number.isFinite(id)) return null;
            return {
              id,
              title: typeof record.title === "string" ? record.title : "",
              url: typeof record.url === "string" ? record.url : "",
              active: Boolean(record.active),
            };
          })
          .filter((entry): entry is GenericBrowserTaskSnapshotRecord["tabs"][number] => entry != null);
      }
    } catch {
      tabs = [];
    }
  }
  return {
    id: Number(row.id),
    task_id: Number(row.task_id),
    run_id: row.run_id == null ? null : String(row.run_id),
    computeruse_task_id:
      row.computeruse_task_id == null ? null : String(row.computeruse_task_id),
    device_id: String(row.device_id),
    image_base64: String(row.image_base64),
    width:
      row.width == null || row.width === "" ? null : Number(row.width),
    height:
      row.height == null || row.height === "" ? null : Number(row.height),
    tabs,
    created_at: String(row.created_at),
  };
}

function toInt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return 0;
}

function extractString(value: unknown, maxLength = 500) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function extractText(value: unknown, maxLength = 4000) {
  if (typeof value === "string" && value.trim()) {
    return value.trim().slice(0, maxLength);
  }
  if (Array.isArray(value)) {
    const lines = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
    if (lines.length > 0) {
      return lines.join("\n").slice(0, maxLength);
    }
  }
  return null;
}

function extractObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return extractObject(parsed);
  } catch {
    return null;
  }
}

function firstString(values: unknown[], maxLength = 500) {
  for (const value of values) {
    const extracted = extractString(value, maxLength);
    if (extracted) return extracted;
  }
  return null;
}

function formatReference(prefix: string, value: string | null) {
  if (!value) return null;
  if (value.toLowerCase().includes(prefix.toLowerCase())) {
    return value;
  }
  return `${prefix} ${value}`;
}

function extractPickupDetails(
  result: Record<string, unknown> | null,
): GenericBrowserTaskPickupDetails | null {
  const pickup = extractObject(result?.pickup_details) ?? extractObject(result?.pickup);
  const receipt =
    extractObject(result?.receipt_details) ?? extractObject(result?.receipt);
  const details: GenericBrowserTaskPickupDetails = {
    order_number: firstString([
      pickup?.order_number,
      pickup?.order_id,
      result?.order_number,
      result?.order_id,
      result?.confirmation_number,
    ]),
    confirmation_code: firstString([
      pickup?.confirmation_code,
      receipt?.confirmation_code,
      result?.confirmation_code,
    ]),
    pickup_code: firstString([
      pickup?.pickup_code,
      receipt?.pickup_code,
      result?.pickup_code,
      result?.pickup_number,
    ]),
    ready_time: firstString([
      pickup?.ready_time,
      pickup?.estimated_ready_time,
      result?.ready_time,
      result?.estimated_ready_time,
      result?.pickup_eta,
      result?.eta,
    ]),
    pickup_name: firstString([
      pickup?.pickup_name,
      pickup?.name_for_pickup,
      result?.pickup_name,
      result?.name_for_pickup,
    ]),
    instructions: firstString([
      pickup?.instructions,
      pickup?.pickup_instructions,
      receipt?.instructions,
      result?.pickup_instructions,
    ], 1000),
    order_reference: firstString([
      receipt?.order_reference,
      receipt?.reference,
      result?.order_reference,
      result?.reference,
    ]),
    receipt_url: firstString([
      receipt?.receipt_url,
      receipt?.url,
      result?.receipt_url,
    ], 2000),
    receipt_text: extractText(
      receipt?.receipt_text ??
        receipt?.summary ??
        result?.receipt_text ??
        result?.receipt,
      8000,
    ),
  };
  return Object.values(details).some(Boolean) ? details : null;
}

function formatPickupSummary(details: GenericBrowserTaskPickupDetails | null) {
  if (!details) return null;
  const parts = [
    formatReference("Order", details.order_number),
    formatReference("Pickup code", details.pickup_code),
    !details.pickup_code ? formatReference("Code", details.confirmation_code) : null,
    formatReference("Ready", details.ready_time),
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function extractTrackingDetails(
  result: Record<string, unknown> | null,
): GenericBrowserTaskTrackingDetails | null {
  const tracking =
    extractObject(result?.tracking_details) ??
    extractObject(result?.tracking) ??
    extractObject(result?.delivery_details);
  const details: GenericBrowserTaskTrackingDetails = {
    tracking_number: firstString([
      tracking?.tracking_number,
      tracking?.number,
      result?.tracking_number,
    ]),
    tracking_url: firstString([
      tracking?.tracking_url,
      tracking?.url,
      result?.tracking_url,
    ], 2000),
    carrier: firstString([
      tracking?.carrier,
      tracking?.shipping_carrier,
      result?.carrier,
    ]),
    status: firstString([
      tracking?.status,
      tracking?.delivery_status,
      result?.tracking_status,
      result?.delivery_status,
    ]),
    delivery_eta: firstString([
      tracking?.delivery_eta,
      tracking?.estimated_delivery,
      result?.delivery_eta,
      result?.estimated_delivery,
      result?.est_delivery,
    ]),
    delivery_window: firstString([
      tracking?.delivery_window,
      tracking?.delivery_window_text,
      result?.delivery_window,
    ]),
    instructions: firstString([
      tracking?.instructions,
      tracking?.delivery_instructions,
      result?.delivery_instructions,
    ], 1000),
  };
  return Object.values(details).some(Boolean) ? details : null;
}

function formatTrackingSummary(details: GenericBrowserTaskTrackingDetails | null) {
  if (!details) return null;
  const parts = [
    formatReference("Tracking", details.tracking_number),
    details.carrier,
    details.status ? `Status ${details.status}` : null,
    details.delivery_eta ? `ETA ${details.delivery_eta}` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function areFulfillmentDetailsMissing(args: {
  status: string;
  totalCents: number;
  pickupDetails: GenericBrowserTaskPickupDetails | null;
  trackingDetails: GenericBrowserTaskTrackingDetails | null;
}) {
  if (args.status !== "completed" || args.totalCents <= 0) return false;
  const hasPickupIdentifier = Boolean(
    args.pickupDetails?.order_number ||
      args.pickupDetails?.pickup_code ||
      args.pickupDetails?.confirmation_code,
  );
  const hasTrackingIdentifier = Boolean(args.trackingDetails?.tracking_number);
  return !hasPickupIdentifier && !hasTrackingIdentifier;
}

function extractBillingFields(result: Record<string, unknown> | null) {
  const nestedCharges =
    result?.charges && typeof result.charges === "object"
      ? (result.charges as Record<string, unknown>)
      : null;
  const source = nestedCharges ?? result ?? {};

  return {
    summary:
      extractString(result?.summary) ||
      extractString(result?.message) ||
      extractString(result?.status),
    merchant: extractString(source.merchant) || extractString(result?.merchant),
    currency: extractString(source.currency) || "usd",
    goodsCents: toInt(source.goods_cents),
    shippingCents: toInt(source.shipping_cents),
    taxCents: toInt(source.tax_cents),
    otherCents:
      toInt(source.other_cents) ||
      toInt(source.platform_fee_cents) ||
      toInt(source.fees_cents),
  };
}

function buildFallbackTaskSummary(args: {
  status: "completed" | "failed";
  result?: Record<string, unknown> | null;
  error?: string | null;
  existingTaskTitle?: string | null;
}) {
  const extracted = extractBillingFields(args.result ?? null).summary;
  if (extracted) return extracted;
  const pickupSummary = formatPickupSummary(extractPickupDetails(args.result ?? null));
  const trackingSummary = formatTrackingSummary(extractTrackingDetails(args.result ?? null));
  if (args.status === "failed") {
    return extractString(args.error) || "Task failed before the fulfiller returned a written summary.";
  }
  if (pickupSummary) {
    return extractString(args.existingTaskTitle)
      ? `Completed ${extractString(args.existingTaskTitle)}. ${pickupSummary}.`
      : `Completed successfully. ${pickupSummary}.`;
  }
  if (trackingSummary) {
    return extractString(args.existingTaskTitle)
      ? `Completed ${extractString(args.existingTaskTitle)}. ${trackingSummary}.`
      : `Completed successfully. ${trackingSummary}.`;
  }
  return extractString(args.existingTaskTitle)
    ? `Completed: ${extractString(args.existingTaskTitle)}. The fulfiller did not return a written summary.`
    : "Completed successfully, but the fulfiller did not return a written summary.";
}

function looksLikeClarificationRequest(text: string | null) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return false;

  const strongMarkers = [
    "how would you like me to proceed",
    "how should i proceed",
    "please clarify",
    "could you clarify",
    "can you clarify",
    "i need clarification",
    "i need more information",
    "i need more detail",
    "what would you like me to do",
    "which option would you like",
    "please let me know how to proceed",
    "tell me how to proceed",
    "waiting for clarification",
    "clarification_requested",
  ];
  if (strongMarkers.some((marker) => normalized.includes(marker))) {
    return true;
  }

  if (!normalized.includes("?")) {
    return false;
  }

  return /(would you like|how should i|how would you like|can you clarify|could you clarify|should i proceed|what should i do|which .* should i)/.test(
    normalized,
  );
}

function extractClarificationRequest(
  result: Record<string, unknown> | null,
  error?: string | null,
) {
  const explicitFlag =
    result?.clarification_requested === true ||
    result?.needs_agent_clarification === true;
  const question = firstString(
    [
      result?.clarification_question,
      result?.clarification_request,
      result?.question,
      result?.error,
      result?.summary,
      error,
    ],
    2000,
  );
  if (!question) return null;
  if (explicitFlag || looksLikeClarificationRequest(question)) {
    return question;
  }
  return null;
}

export async function ensureGenericBrowserTaskSchema() {
  if (schemaReady) return;
  await ensureSchema();
  const client = getTursoClient();
  await client.execute(
    `CREATE TABLE IF NOT EXISTS generic_browser_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      agent_username_lower TEXT NOT NULL,
      human_user_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      submission_source TEXT NOT NULL DEFAULT 'agent',
      fulfiller_human_user_id INTEGER,
      task_title TEXT,
      task_prompt TEXT NOT NULL,
      website_url TEXT,
      shipping_address TEXT,
      max_charge_cents INTEGER,
      status TEXT NOT NULL DEFAULT 'queued',
      billing_status TEXT NOT NULL DEFAULT 'pending',
      payout_cents INTEGER NOT NULL DEFAULT 0,
      payout_status TEXT NOT NULL DEFAULT 'pending',
      payout_credited_at TEXT,
      merchant TEXT,
      currency TEXT NOT NULL DEFAULT 'usd',
      goods_cents INTEGER NOT NULL DEFAULT 0,
      shipping_cents INTEGER NOT NULL DEFAULT 0,
      tax_cents INTEGER NOT NULL DEFAULT 0,
      other_cents INTEGER NOT NULL DEFAULT 0,
      inference_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      run_id TEXT,
      computeruse_task_id TEXT,
      result_json TEXT,
      usage_json TEXT,
      clarification_request TEXT,
      clarification_requested_at TEXT,
      clarification_deadline_at TEXT,
      clarification_response TEXT,
      clarification_responded_at TEXT,
      clarification_callback_status TEXT NOT NULL DEFAULT 'not_requested',
      clarification_callback_http_status INTEGER,
      clarification_callback_error TEXT,
      clarification_callback_last_attempt_at TEXT,
      summary TEXT,
      error TEXT,
      requester_rating INTEGER,
      requester_rating_at TEXT,
      charged_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  const tableInfo = await client.execute({
    sql: "PRAGMA table_info(generic_browser_tasks)",
    args: [],
  });
  const columns = (tableInfo.rows ?? []) as unknown as { name: string }[];
  if (!columns.some((c) => c.name === "submission_source")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN submission_source TEXT NOT NULL DEFAULT 'agent'",
      "submission_source",
    );
  }
  if (!columns.some((c) => c.name === "fulfiller_human_user_id")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN fulfiller_human_user_id INTEGER",
      "fulfiller_human_user_id",
    );
  }
  if (!columns.some((c) => c.name === "payout_cents")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN payout_cents INTEGER NOT NULL DEFAULT 0",
      "payout_cents",
    );
  }
  if (!columns.some((c) => c.name === "payout_status")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN payout_status TEXT NOT NULL DEFAULT 'pending'",
      "payout_status",
    );
  }
  if (!columns.some((c) => c.name === "payout_credited_at")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN payout_credited_at TEXT",
      "payout_credited_at",
    );
  }
  if (!columns.some((c) => c.name === "requester_rating")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN requester_rating INTEGER",
      "requester_rating",
    );
  }
  if (!columns.some((c) => c.name === "requester_rating_at")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN requester_rating_at TEXT",
      "requester_rating_at",
    );
  }
  if (!columns.some((c) => c.name === "website_url")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN website_url TEXT",
      "website_url",
    );
  }
  if (!columns.some((c) => c.name === "shipping_address")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN shipping_address TEXT",
      "shipping_address",
    );
  }
  if (!columns.some((c) => c.name === "clarification_request")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN clarification_request TEXT",
      "clarification_request",
    );
  }
  if (!columns.some((c) => c.name === "clarification_requested_at")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN clarification_requested_at TEXT",
      "clarification_requested_at",
    );
  }
  if (!columns.some((c) => c.name === "clarification_deadline_at")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN clarification_deadline_at TEXT",
      "clarification_deadline_at",
    );
  }
  if (!columns.some((c) => c.name === "clarification_response")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN clarification_response TEXT",
      "clarification_response",
    );
  }
  if (!columns.some((c) => c.name === "clarification_responded_at")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN clarification_responded_at TEXT",
      "clarification_responded_at",
    );
  }
  if (!columns.some((c) => c.name === "clarification_callback_status")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN clarification_callback_status TEXT NOT NULL DEFAULT 'not_requested'",
      "clarification_callback_status",
    );
  }
  if (!columns.some((c) => c.name === "clarification_callback_http_status")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN clarification_callback_http_status INTEGER",
      "clarification_callback_http_status",
    );
  }
  if (!columns.some((c) => c.name === "clarification_callback_error")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN clarification_callback_error TEXT",
      "clarification_callback_error",
    );
  }
  if (!columns.some((c) => c.name === "clarification_callback_last_attempt_at")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_tasks ADD COLUMN clarification_callback_last_attempt_at TEXT",
      "clarification_callback_last_attempt_at",
    );
  }
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_generic_browser_tasks_agent ON generic_browser_tasks(agent_username_lower, created_at)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_generic_browser_tasks_human ON generic_browser_tasks(human_user_id, created_at)",
  );
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_generic_browser_tasks_run_id ON generic_browser_tasks(run_id)",
  );
  await client.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_generic_browser_tasks_cu_task ON generic_browser_tasks(computeruse_task_id)",
  );
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_generic_browser_tasks_fulfiller ON generic_browser_tasks(fulfiller_human_user_id, created_at)"
  );
  await client.execute(
    `CREATE TABLE IF NOT EXISTS generic_browser_task_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      run_id TEXT,
      computeruse_task_id TEXT,
      device_id TEXT NOT NULL,
      image_base64 TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      tabs_json TEXT,
      created_at TEXT NOT NULL
    )`
  );
  const snapshotTableInfo = await client.execute({
    sql: "PRAGMA table_info(generic_browser_task_snapshots)",
    args: [],
  });
  const snapshotColumns = (snapshotTableInfo.rows ?? []) as unknown as { name: string }[];
  if (!snapshotColumns.some((c) => c.name === "tabs_json")) {
    await safeAddColumn(
      client,
      "ALTER TABLE generic_browser_task_snapshots ADD COLUMN tabs_json TEXT",
      "tabs_json",
    );
  }
  await client.execute(
    "CREATE INDEX IF NOT EXISTS idx_generic_browser_task_snapshots_task ON generic_browser_task_snapshots(task_id, created_at)"
  );
  schemaReady = true;
}

export async function createGenericBrowserTask(params: {
  agentId: number;
  agentUsernameLower: string;
  humanUserId: number;
  deviceId: string;
  submissionSource?: GenericBrowserTaskSubmissionSource;
  fulfillerHumanUserId?: number | null;
  taskPrompt: string;
  taskTitle?: string | null;
  websiteUrl?: string | null;
  shippingAddress?: string | null;
  maxChargeCents?: number | null;
  runId?: string | null;
  computeruseTaskId?: string | null;
}) {
  await ensureGenericBrowserTaskSchema();
  const client = getTursoClient();
  const now = new Date().toISOString();
  const insertResult = await client.execute({
    sql: `INSERT INTO generic_browser_tasks
          (agent_id, agent_username_lower, human_user_id, device_id, submission_source,
           fulfiller_human_user_id, task_title, task_prompt, website_url, shipping_address, max_charge_cents, status,
           billing_status, payout_cents, payout_status, run_id, computeruse_task_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'pending', 0, 'pending', ?, ?, ?, ?)`,
    args: [
      params.agentId,
      params.agentUsernameLower.trim().toLowerCase(),
      params.humanUserId,
      params.deviceId.trim(),
      params.submissionSource ?? "agent",
      params.fulfillerHumanUserId ?? null,
      params.taskTitle?.trim() || null,
      params.taskPrompt.trim(),
      params.websiteUrl?.trim() || null,
      params.shippingAddress?.trim() || null,
      params.maxChargeCents ?? null,
      params.runId?.trim() || null,
      params.computeruseTaskId?.trim() || null,
      now,
      now,
    ],
  });
  const rawId = (insertResult as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  const taskId = rawId != null ? Number(rawId) : 0;
  if (!taskId) throw new Error("Failed to create generic browser task.");
  const created = await getGenericBrowserTaskById(taskId);
  if (!created) throw new Error("Failed to load generic browser task.");
  return created;
}

export async function getGenericBrowserTaskById(id: number) {
  await ensureGenericBrowserTaskSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM generic_browser_tasks WHERE id = ? LIMIT 1",
    args: [id],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapTaskRow(row) : null;
}

export async function getGenericBrowserTaskByComputerUseTaskId(computeruseTaskId: string) {
  await ensureGenericBrowserTaskSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM generic_browser_tasks WHERE computeruse_task_id = ? LIMIT 1",
    args: [computeruseTaskId.trim()],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapTaskRow(row) : null;
}

export async function markGenericBrowserTaskRunningByComputerUseTaskId(computeruseTaskId: string) {
  await ensureGenericBrowserTaskSchema();
  const existing = await getGenericBrowserTaskByComputerUseTaskId(computeruseTaskId);
  if (!existing || existing.status !== "queued") return existing;
  const client = getTursoClient();
  const now = new Date().toISOString();
  await client.execute({
    sql: `UPDATE generic_browser_tasks
          SET status = 'running', updated_at = ?
          WHERE computeruse_task_id = ?`,
    args: [now, computeruseTaskId.trim()],
  });
  return getGenericBrowserTaskByComputerUseTaskId(computeruseTaskId);
}

export async function markGenericBrowserTaskAwaitingAgentClarification(params: {
  computeruseTaskId: string;
  clarificationRequest: string;
  clarificationDeadlineAt: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
  usages?: ModelUsageRecord[];
}) {
  await ensureGenericBrowserTaskSchema();
  const existing = await getGenericBrowserTaskByComputerUseTaskId(params.computeruseTaskId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const client = getTursoClient();
  await client.execute({
    sql: `UPDATE generic_browser_tasks
          SET status = 'awaiting_agent_clarification',
              result_json = ?,
              usage_json = ?,
              summary = ?,
              error = NULL,
              clarification_request = ?,
              clarification_requested_at = ?,
              clarification_deadline_at = ?,
              clarification_response = NULL,
              clarification_responded_at = NULL,
              clarification_callback_status = 'not_requested',
              clarification_callback_http_status = NULL,
              clarification_callback_error = NULL,
              clarification_callback_last_attempt_at = NULL,
              completed_at = NULL,
              updated_at = ?
          WHERE id = ?`,
    args: [
      params.result ? JSON.stringify(params.result) : null,
      params.usages && params.usages.length > 0 ? JSON.stringify(params.usages) : null,
      "Awaiting agent clarification.",
      params.clarificationRequest.trim().slice(0, 2000),
      now,
      params.clarificationDeadlineAt,
      now,
      existing.id,
    ],
  });
  return getGenericBrowserTaskById(existing.id);
}

export async function recordGenericBrowserTaskClarificationCallbackAttempt(params: {
  taskId: number;
  ok: boolean;
  httpStatus?: number | null;
  error?: string | null;
}) {
  await ensureGenericBrowserTaskSchema();
  const now = new Date().toISOString();
  const client = getTursoClient();
  await client.execute({
    sql: `UPDATE generic_browser_tasks
          SET clarification_callback_status = ?,
              clarification_callback_http_status = ?,
              clarification_callback_error = ?,
              clarification_callback_last_attempt_at = ?,
              updated_at = ?
          WHERE id = ?`,
    args: [
      params.ok ? "sent" : "failed",
      params.httpStatus ?? null,
      params.error?.trim() || null,
      now,
      now,
      params.taskId,
    ],
  });
  return getGenericBrowserTaskById(params.taskId);
}

export async function resumeGenericBrowserTaskAfterClarification(params: {
  taskId: number;
  clarificationResponse: string;
  newComputeruseTaskId: string;
}) {
  await ensureGenericBrowserTaskSchema();
  const existing = await getGenericBrowserTaskById(params.taskId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const client = getTursoClient();
  await client.execute({
    sql: `UPDATE generic_browser_tasks
          SET status = 'queued',
              computeruse_task_id = ?,
              result_json = NULL,
              usage_json = NULL,
              summary = 'Queued after agent clarification.',
              error = NULL,
              clarification_response = ?,
              clarification_responded_at = ?,
              clarification_deadline_at = NULL,
              completed_at = NULL,
              updated_at = ?
          WHERE id = ?`,
    args: [
      params.newComputeruseTaskId.trim(),
      params.clarificationResponse.trim().slice(0, 4000),
      now,
      now,
      existing.id,
    ],
  });
  return getGenericBrowserTaskById(existing.id);
}

export async function cancelGenericBrowserTaskAwaitingClarification(params: {
  taskId: number;
  reason: string;
  callbackStatus?: GenericBrowserTaskClarificationCallbackStatus;
  callbackHttpStatus?: number | null;
  callbackError?: string | null;
}) {
  await ensureGenericBrowserTaskSchema();
  const existing = await getGenericBrowserTaskById(params.taskId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const client = getTursoClient();
  await client.execute({
    sql: `UPDATE generic_browser_tasks
          SET status = 'failed',
              billing_status = 'not_charged',
              payout_cents = 0,
              payout_status = 'not_charged',
              payout_credited_at = NULL,
              summary = ?,
              error = ?,
              clarification_callback_status = ?,
              clarification_callback_http_status = ?,
              clarification_callback_error = ?,
              clarification_callback_last_attempt_at = ?,
              completed_at = ?,
              updated_at = ?
          WHERE id = ?`,
    args: [
      params.reason.trim().slice(0, 2000),
      params.reason.trim().slice(0, 2000),
      params.callbackStatus ?? existing.clarification_callback_status,
      params.callbackHttpStatus ?? existing.clarification_callback_http_status,
      params.callbackError?.trim() || existing.clarification_callback_error,
      now,
      now,
      now,
      existing.id,
    ],
  });
  return getGenericBrowserTaskById(existing.id);
}

export async function listGenericBrowserTasksForHuman(humanUserId: number, limit = 50) {
  await ensureGenericBrowserTaskSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM generic_browser_tasks
          WHERE human_user_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [humanUserId, Math.max(1, Math.min(limit, 200))],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map(mapTaskRow);
}

export async function listGenericBrowserTasksRelatedToHuman(humanUserId: number, limit = 50) {
  await ensureGenericBrowserTaskSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM generic_browser_tasks
          WHERE human_user_id = ?
             OR fulfiller_human_user_id = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [humanUserId, humanUserId, Math.max(1, Math.min(limit, 200))],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map(mapTaskRow);
}

export async function getHumanFulfillmentRatingStats(
  humanUserId: number,
): Promise<HumanFulfillmentRatingStats> {
  await ensureGenericBrowserTaskSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT
            (SELECT COUNT(*)
             FROM generic_browser_tasks
             WHERE human_user_id = ?) AS submitted_task_count,
            (SELECT COUNT(*)
             FROM generic_browser_tasks
             WHERE fulfiller_human_user_id = ?
               AND status = 'completed') AS fulfilled_task_count,
            (SELECT COUNT(*)
             FROM generic_browser_tasks
             WHERE fulfiller_human_user_id = ?
               AND status = 'completed'
               AND human_user_id != fulfiller_human_user_id
               AND requester_rating BETWEEN 1 AND 5) AS rating_count,
            (SELECT AVG(CAST(requester_rating AS REAL))
             FROM generic_browser_tasks
             WHERE fulfiller_human_user_id = ?
               AND status = 'completed'
               AND human_user_id != fulfiller_human_user_id
               AND requester_rating BETWEEN 1 AND 5) AS average_rating`,
    args: [humanUserId, humanUserId, humanUserId, humanUserId],
  });
  const row = result.rows?.[0] as
    | {
        submitted_task_count?: number | bigint | string;
        fulfilled_task_count?: number | bigint | string;
        rating_count?: number | bigint | string;
        average_rating?: number | string | null;
      }
    | undefined;
  return {
    human_user_id: humanUserId,
    submitted_task_count:
      row?.submitted_task_count != null ? Number(row.submitted_task_count) : 0,
    fulfilled_task_count:
      row?.fulfilled_task_count != null ? Number(row.fulfilled_task_count) : 0,
    rating_count: row?.rating_count != null ? Number(row.rating_count) : 0,
    average_rating:
      row?.average_rating == null || row.average_rating === ""
        ? null
        : Number(row.average_rating),
  };
}

export async function createGenericBrowserTaskSnapshotFromDevice(params: {
  computeruseTaskId: string;
  deviceId: string;
  imageBase64: string;
  width?: number | null;
  height?: number | null;
  tabs?: Array<{
    id: number;
    title: string;
    url: string;
    active: boolean;
  }>;
}) {
  await ensureGenericBrowserTaskSchema();
  const task = await getGenericBrowserTaskByComputerUseTaskId(params.computeruseTaskId);
  if (!task) return null;

  const imageBase64 = params.imageBase64.trim();
  if (!imageBase64) {
    throw new Error("imageBase64 is required.");
  }
  if (imageBase64.length > 3_000_000) {
    throw new Error("Snapshot image is too large.");
  }

  const client = getTursoClient();
  const now = new Date().toISOString();
  const tabsJson = JSON.stringify(
    Array.isArray(params.tabs)
      ? params.tabs
          .filter((tab) => Number.isFinite(tab.id))
          .map((tab) => ({
            id: Math.round(tab.id),
            title: String(tab.title || ""),
            url: String(tab.url || ""),
            active: Boolean(tab.active),
          }))
      : [],
  );
  const insertResult = await client.execute({
    sql: `INSERT INTO generic_browser_task_snapshots
          (task_id, run_id, computeruse_task_id, device_id, image_base64, width, height, tabs_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      task.id,
      task.run_id,
      task.computeruse_task_id,
      params.deviceId.trim(),
      imageBase64,
      params.width ?? null,
      params.height ?? null,
      tabsJson,
      now,
    ],
  });
  const rawId = (insertResult as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  const snapshotId = rawId != null ? Number(rawId) : 0;
  await client.execute({
    sql: `DELETE FROM generic_browser_task_snapshots
          WHERE task_id = ?
            AND id NOT IN (
              SELECT id
              FROM generic_browser_task_snapshots
              WHERE task_id = ?
              ORDER BY created_at DESC, id DESC
              LIMIT 30
            )`,
    args: [task.id, task.id],
  });
  const snapshot = await getGenericBrowserTaskSnapshotById(snapshotId);
  return snapshot;
}

export async function getGenericBrowserTaskSnapshotById(id: number) {
  await ensureGenericBrowserTaskSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: "SELECT * FROM generic_browser_task_snapshots WHERE id = ? LIMIT 1",
    args: [id],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapSnapshotRow(row) : null;
}

export async function getLatestGenericBrowserTaskSnapshot(taskId: number) {
  await ensureGenericBrowserTaskSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM generic_browser_task_snapshots
          WHERE task_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
    args: [taskId],
  });
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return row ? mapSnapshotRow(row) : null;
}

export async function listGenericBrowserTaskSnapshots(taskId: number, limit = 10) {
  await ensureGenericBrowserTaskSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM generic_browser_task_snapshots
          WHERE task_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
    args: [taskId, Math.max(1, Math.min(limit, 50))],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map(mapSnapshotRow);
}

export async function listGenericBrowserTasksForAgent(agentUsernameLower: string, limit = 50) {
  await ensureGenericBrowserTaskSchema();
  const client = getTursoClient();
  const result = await client.execute({
    sql: `SELECT * FROM generic_browser_tasks
          WHERE agent_username_lower = ?
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [agentUsernameLower.trim().toLowerCase(), Math.max(1, Math.min(limit, 200))],
  });
  return ((result.rows ?? []) as Record<string, unknown>[]).map(mapTaskRow);
}

export async function completeGenericBrowserTaskFromExtension(params: {
  computeruseTaskId: string;
  status: "completed" | "failed";
  result?: Record<string, unknown> | null;
  error?: string | null;
  usages?: ModelUsageRecord[];
}) {
  await ensureGenericBrowserTaskSchema();
  const existing = await getGenericBrowserTaskByComputerUseTaskId(params.computeruseTaskId);
  if (!existing) return null;
  if (existing.completed_at) {
    return existing;
  }

  const clarificationRequest =
    params.status === "failed"
      ? extractClarificationRequest(params.result ?? null, params.error)
      : null;
  if (clarificationRequest) {
    const updated = await markGenericBrowserTaskAwaitingAgentClarification({
      computeruseTaskId: params.computeruseTaskId,
      clarificationRequest,
      clarificationDeadlineAt: makeAgentClarificationDeadline(),
      result: params.result,
      error: params.error,
      usages: params.usages,
    });
    return updated
      ? {
          task: updated,
          clarificationRequested: true as const,
          clarificationRequest,
        }
      : null;
  }

  const billing = extractBillingFields(params.result ?? null);
  const finalSummary = buildFallbackTaskSummary({
    status: params.status,
    result: params.result,
    error: params.error,
    existingTaskTitle: existing.task_title,
  });
  const inference = calculateInferenceCostCents(params.usages ?? []);
  const shouldCharge = params.status === "completed";

  const goodsCents = shouldCharge ? billing.goodsCents : 0;
  const shippingCents = shouldCharge ? billing.shippingCents : 0;
  const taxCents = shouldCharge ? billing.taxCents : 0;
  const otherCents = shouldCharge ? billing.otherCents : 0;
  const inferenceCents = shouldCharge ? inference.cents : 0;
  const totalCents = goodsCents + shippingCents + taxCents + otherCents + inferenceCents;
  const now = new Date().toISOString();
  const billingStatus: GenericBrowserTaskBillingStatus = shouldCharge
    ? totalCents > 0
      ? "debited"
      : "completed_no_charge"
    : "not_charged";
  let payoutCents = 0;
  let payoutStatus: GenericBrowserTaskPayoutStatus = shouldCharge
    ? "not_applicable"
    : "not_charged";
  let payoutCreditedAt: string | null = null;

  if (shouldCharge && totalCents > 0) {
    await addCreditLedgerEntry({
      humanUserId: existing.human_user_id,
      amountCents: -totalCents,
      entryType: "task_debit",
      description:
        finalSummary ||
        existing.task_title ||
        `Browser task #${existing.id} completed`,
      referenceType: "generic_browser_task",
      referenceId: String(existing.id),
      metadata: {
        merchant: billing.merchant,
        currency: billing.currency,
        goods_cents: goodsCents,
        shipping_cents: shippingCents,
        tax_cents: taxCents,
        other_cents: otherCents,
        inference_cents: inferenceCents,
        input_tokens: inference.totalInputTokens,
        output_tokens: inference.totalOutputTokens,
        usage_details: inference.details,
      },
    });

    if (existing.fulfiller_human_user_id == null) {
      payoutStatus = "not_applicable";
    } else {
      payoutCents = totalCents;
      payoutStatus = "credited";
      payoutCreditedAt = now;
      await addCreditLedgerEntry({
        humanUserId: existing.fulfiller_human_user_id,
        amountCents: totalCents,
        entryType: "task_payout",
        description:
          existing.fulfiller_human_user_id === existing.human_user_id
            ? finalSummary ||
              existing.task_title ||
              `Self-fulfilled browser task #${existing.id}`
            : finalSummary ||
              existing.task_title ||
              `Fulfilled browser task #${existing.id}`,
        referenceType: "generic_browser_task",
        referenceId: String(existing.id),
        metadata: {
          source_human_user_id: existing.human_user_id,
          self_fulfilled:
            existing.fulfiller_human_user_id === existing.human_user_id,
          merchant: billing.merchant,
          currency: billing.currency,
          goods_cents: goodsCents,
          shipping_cents: shippingCents,
          tax_cents: taxCents,
          other_cents: otherCents,
          inference_cents: inferenceCents,
          input_tokens: inference.totalInputTokens,
          output_tokens: inference.totalOutputTokens,
          usage_details: inference.details,
        },
      });
    }
  }

  const client = getTursoClient();
  await client.execute({
    sql: `UPDATE generic_browser_tasks
          SET status = ?, billing_status = ?, payout_cents = ?, payout_status = ?, payout_credited_at = ?,
              merchant = ?, currency = ?,
              goods_cents = ?, shipping_cents = ?, tax_cents = ?, other_cents = ?,
              inference_cents = ?, total_cents = ?, input_tokens = ?, output_tokens = ?,
              result_json = ?, usage_json = ?, summary = ?, error = ?, charged_at = ?, completed_at = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      params.status,
      billingStatus,
      payoutCents,
      payoutStatus,
      payoutCreditedAt,
      billing.merchant,
      billing.currency,
      goodsCents,
      shippingCents,
      taxCents,
      otherCents,
      inferenceCents,
      totalCents,
      inference.totalInputTokens,
      inference.totalOutputTokens,
      params.result ? JSON.stringify(params.result) : null,
      params.usages && params.usages.length > 0 ? JSON.stringify(params.usages) : null,
      finalSummary,
      params.error?.trim() || null,
      shouldCharge ? now : null,
      now,
      now,
      existing.id,
    ],
  });

  const updated = await getGenericBrowserTaskById(existing.id);
  if (!updated) return null;
  const remainingCredits = await getHumanCreditBalance(existing.human_user_id);
  if (updated.status === "completed") {
    const requester = await getHumanUserById(existing.human_user_id);
    if (requester?.email) {
      void sendOrderCompletionEmail({
        recipient: {
          email: requester.email,
          displayName: requester.display_name,
        },
        task: updated,
        remainingCreditsCents: remainingCredits,
      }).catch((error) => {
        console.error(
          `[generic-browser-tasks] Failed to send completion email for task ${updated.id}:`,
          error,
        );
      });
    }
  }
  return {
    task: updated,
    remainingCreditsCents: remainingCredits,
  };
}

export async function rateGenericBrowserTaskByRequester(params: {
  taskId: number;
  requesterHumanUserId: number;
  rating: number;
}) {
  await ensureGenericBrowserTaskSchema();
  const rating = Math.trunc(params.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new Error("Rating must be an integer between 1 and 5.");
  }

  const existing = await getGenericBrowserTaskById(params.taskId);
  if (!existing) {
    throw new Error("Task not found.");
  }
  if (existing.human_user_id !== params.requesterHumanUserId) {
    throw new Error("Only the requester can rate this fulfillment.");
  }
  if (existing.status !== "completed") {
    throw new Error("Only completed tasks can be rated.");
  }
  if (existing.fulfiller_human_user_id == null) {
    throw new Error("This task does not have a recorded fulfiller.");
  }
  if (existing.fulfiller_human_user_id === existing.human_user_id) {
    throw new Error("Self-fulfilled tasks do not need a rating.");
  }

  const now = new Date().toISOString();
  const client = getTursoClient();
  await client.execute({
    sql: `UPDATE generic_browser_tasks
          SET requester_rating = ?, requester_rating_at = ?, updated_at = ?
          WHERE id = ?`,
    args: [rating, now, now, existing.id],
  });

  const updatedTask = await getGenericBrowserTaskById(existing.id);
  if (!updatedTask) {
    throw new Error("Failed to load updated task rating.");
  }
  const fulfillerRating = await getHumanFulfillmentRatingStats(
    existing.fulfiller_human_user_id,
  );
  return {
    task: updatedTask,
    fulfillerRating,
  };
}

export function formatGenericTaskForApi(task: GenericBrowserTaskRecord, viewer?: HumanUserRecord | null) {
  const fmt = (cents: number | null) => (cents != null ? `$${(cents / 100).toFixed(2)}` : null);
  return {
    id: task.id,
    submission_source: task.submission_source,
    status: task.status,
    billing_status: task.billing_status,
    payout_status: task.payout_status,
    task_title: task.task_title,
    task_prompt: task.task_prompt,
    website_url: task.website_url,
    shipping_address: task.shipping_address,
    pickup_details: task.pickup_details,
    pickup_summary: task.pickup_summary,
    tracking_details: task.tracking_details,
    tracking_summary: task.tracking_summary,
    fulfillment_details_missing: task.fulfillment_details_missing,
    clarification: task.clarification_request
      ? {
          question: task.clarification_request,
          requested_at: task.clarification_requested_at,
          deadline_at: task.clarification_deadline_at,
          response: task.clarification_response,
          responded_at: task.clarification_responded_at,
          callback_status: task.clarification_callback_status,
          callback_http_status: task.clarification_callback_http_status,
          callback_error: task.clarification_callback_error,
          callback_last_attempt_at: task.clarification_callback_last_attempt_at,
        }
      : null,
    summary: task.summary,
    error: task.error,
    requester_rating: task.requester_rating,
    requester_rating_at: task.requester_rating_at,
    merchant: task.merchant,
    currency: task.currency,
    goods_total: fmt(task.goods_cents),
    shipping_total: fmt(task.shipping_cents),
    tax_total: fmt(task.tax_cents),
    other_total: fmt(task.other_cents),
    inference_total: fmt(task.inference_cents),
    total_debited: fmt(task.total_cents),
    payout_total: fmt(task.payout_cents),
    input_tokens: task.input_tokens,
    output_tokens: task.output_tokens,
    run_id: task.run_id,
    computeruse_task_id: task.computeruse_task_id,
    created_at: task.created_at,
    completed_at: task.completed_at,
    charged_at: task.charged_at,
    payout_credited_at: task.payout_credited_at,
    fulfiller_human_user_id: task.fulfiller_human_user_id,
    max_charge:
      task.max_charge_cents != null ? fmt(task.max_charge_cents) : null,
    human_context:
      viewer == null
        ? undefined
        : {
            human_email: viewer.email,
          },
  };
}
