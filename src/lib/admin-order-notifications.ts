import type { GenericBrowserTaskRecord } from "@/lib/generic-browser-tasks";
import type { OttoAuthOrderRecord } from "@/lib/order-orchestration";
import type { AmazonOrderRecord } from "@/services/amazon/orders";
import type { SnackpassOrderRecord } from "@/services/snackpass/orders";

type SubmittedOrderNotification = {
  kind: "ottoauth" | "generic" | "amazon" | "snackpass";
  orderId: string;
  title: string;
  requester: string;
  source: string;
  status: string;
  url: string;
  providerLabel?: string | null;
  websiteUrl?: string | null;
  maxChargeCents?: number | null;
  estimateCents?: number | null;
  shippingLocation?: string | null;
  externalId?: string | null;
  idempotencyKey?: string | null;
};

type SlackBlock = Record<string, unknown>;

const SLACK_TIMEOUT_MS = 5_000;
const TWILIO_TIMEOUT_MS = 8_000;

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getEnvLabel(): "Production" | "Dev" {
  if (process.env.VERCEL_ENV) {
    return process.env.VERCEL_ENV === "production" ? "Production" : "Dev";
  }
  return process.env.NODE_ENV === "production" ? "Production" : "Dev";
}

function appBaseUrl() {
  const explicit = envValue("NEXT_PUBLIC_APP_URL") || envValue("APP_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelUrl = envValue("VERCEL_URL");
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, "");
  return process.env.NODE_ENV === "production"
    ? "https://ottoauth.vercel.app"
    : "http://127.0.0.1:3000";
}

function formatCents(value: number | null | undefined, currency = "usd") {
  if (value == null) return "Unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: value % 100 === 0 ? 0 : 2,
  }).format(Math.max(0, Math.trunc(value)) / 100);
}

function truncate(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function nestedRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function ottoauthOrderTitle(order: OttoAuthOrderRecord) {
  const humanPacket = parseJsonObject(order.human_packet_json);
  const request = parseJsonObject(order.request_json);
  const normalized = nestedRecord(request?.normalized);
  return (
    stringValue(humanPacket?.title) ||
    stringValue(normalized?.title) ||
    stringValue(request?.title) ||
    stringValue(normalized?.task) ||
    order.public_id
  );
}

function ottoauthOrderEstimate(order: OttoAuthOrderRecord) {
  if (order.quoted_total_cents != null) return order.quoted_total_cents;
  const request = parseJsonObject(order.request_json);
  const pricing = nestedRecord(request?.pricing);
  const displayTotal = pricing?.display_total_cents;
  return typeof displayTotal === "number" && Number.isFinite(displayTotal)
    ? displayTotal
    : null;
}

function ottoauthOrderNotification(
  order: OttoAuthOrderRecord,
): SubmittedOrderNotification {
  const baseUrl = appBaseUrl();
  return {
    kind: "ottoauth",
    orderId: order.public_id,
    title: ottoauthOrderTitle(order),
    requester: order.agent_username_lower,
    source: order.submission_source,
    status: order.status,
    url: `${baseUrl}/admindash/fulfillment/${encodeURIComponent(order.public_id)}`,
    providerLabel: order.provider_label,
    maxChargeCents: order.max_charge_cents,
    estimateCents: ottoauthOrderEstimate(order),
    externalId: order.external_id,
    idempotencyKey: order.idempotency_key,
  };
}

function genericOrderNotification(
  task: GenericBrowserTaskRecord,
): SubmittedOrderNotification {
  const baseUrl = appBaseUrl();
  return {
    kind: "generic",
    orderId: `task_${task.id}`,
    title: task.task_title?.trim() || truncate(task.task_prompt, 90) || `Task #${task.id}`,
    requester: task.agent_username_lower,
    source: task.submission_source,
    status: task.status,
    url: `${baseUrl}/orders/${task.id}`,
    websiteUrl: task.website_url,
    maxChargeCents: task.max_charge_cents,
  };
}

function amazonOrderNotification(order: AmazonOrderRecord): SubmittedOrderNotification {
  const baseUrl = appBaseUrl();
  return {
    kind: "amazon",
    orderId: `amazon_${order.id}`,
    title: order.product_title?.trim() || "Amazon order",
    requester: order.username_lower,
    source: "amazon_service",
    status: order.status,
    url: `${baseUrl}/admindash/amazon/orders/${order.id}`,
    websiteUrl: order.item_url,
    estimateCents:
      order.estimated_price_cents == null && order.estimated_tax_cents == null
        ? null
        : (order.estimated_price_cents ?? 0) +
          (order.estimated_tax_cents ?? 0) +
          (order.processing_fee_cents ?? 0),
    shippingLocation: order.shipping_location,
  };
}

function snackpassOrderNotification(
  order: SnackpassOrderRecord,
): SubmittedOrderNotification {
  const baseUrl = appBaseUrl();
  return {
    kind: "snackpass",
    orderId: `snackpass_${order.id}`,
    title: `${order.dish_name} at ${order.restaurant_name}`,
    requester: order.username_lower,
    source: "snackpass_service",
    status: order.status,
    url: `${baseUrl}/admindash/snackpass/orders/${order.id}`,
    estimateCents:
      order.estimated_price_cents +
      (order.estimated_tax_cents ?? 0) +
      (order.processing_fee_cents ?? 0) +
      (order.tip_cents ?? 0) +
      (order.service_fee_cents ?? 0) +
      (order.delivery_fee_cents ?? 0),
    shippingLocation: order.shipping_location,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function notifySlackSubmittedOrder(order: SubmittedOrderNotification) {
  const webhookUrl = envValue("SLACK_WEBHOOK_URL");
  if (!webhookUrl) {
    console.warn("[admin-order-notifications] SLACK_WEBHOOK_URL is not configured.");
    return;
  }

  const envLabel = getEnvLabel();
  const fields = [
    { type: "mrkdwn", text: `*Order:*\n${order.orderId}` },
    { type: "mrkdwn", text: `*Source:*\n${order.source}` },
    { type: "mrkdwn", text: `*Requester:*\n${order.requester}` },
    { type: "mrkdwn", text: `*Status:*\n${order.status}` },
    { type: "mrkdwn", text: `*Spend cap:*\n${formatCents(order.maxChargeCents)}` },
    { type: "mrkdwn", text: `*Estimate:*\n${formatCents(order.estimateCents)}` },
  ];
  if (order.providerLabel) {
    fields.push({ type: "mrkdwn", text: `*Provider:*\n${order.providerLabel}` });
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncate(`New OttoAuth order (${envLabel})`, 150),
        emoji: true,
      },
    },
    { type: "section", fields },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${truncate(order.title, 180)}*\n<${order.url}|Open order>`,
      },
    },
  ];

  const contextParts = [
    order.websiteUrl ? `Website: ${truncate(order.websiteUrl, 180)}` : null,
    order.shippingLocation ? `Location: ${truncate(order.shippingLocation, 120)}` : null,
    order.externalId ? `External: ${truncate(order.externalId, 80)}` : null,
    order.idempotencyKey ? `Idempotency: ${truncate(order.idempotencyKey, 80)}` : null,
  ].filter(Boolean);
  if (contextParts.length) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: contextParts.join(" | ") }],
    });
  }

  const response = await fetchWithTimeout(
    webhookUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `New OttoAuth order submitted (${envLabel})`,
        blocks,
      }),
    },
    SLACK_TIMEOUT_MS,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(
      `[admin-order-notifications] Slack notification failed for ${order.orderId}: HTTP ${response.status}${body ? ` ${body.slice(0, 200)}` : ""}`,
    );
    return;
  }

  console.info(
    `[admin-order-notifications] Slack notification accepted for ${order.orderId}.`,
  );
}

function parseRecipients(raw: string | null) {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function twilioAuthHeader(accountSid: string, authToken: string) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

function smsBody(order: SubmittedOrderNotification) {
  const lines = [
    `OttoAuth: new ${order.orderId} (${order.status})`,
    `${truncate(order.providerLabel || order.source, 48)} - cap ${formatCents(order.maxChargeCents)}`,
    truncate(order.title, 120),
    order.url,
  ];
  return lines.join("\n");
}

async function notifySmsSubmittedOrder(order: SubmittedOrderNotification) {
  const recipients = parseRecipients(envValue("OTTOAUTH_ADMIN_SMS_TO"));
  if (!recipients.length) {
    console.warn("[admin-order-notifications] OTTOAUTH_ADMIN_SMS_TO is not configured.");
    return;
  }

  const accountSid = envValue("TWILIO_ACCOUNT_SID");
  const authToken = envValue("TWILIO_AUTH_TOKEN");
  const fromNumber = envValue("TWILIO_FROM_NUMBER");
  const messagingServiceSid = envValue("TWILIO_MESSAGING_SERVICE_SID");

  if (!accountSid || !authToken) {
    console.warn(
      "[admin-order-notifications] Twilio credentials are not configured.",
    );
    return;
  }
  if (!fromNumber && !messagingServiceSid) {
    console.warn(
      "[admin-order-notifications] TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID is not configured.",
    );
    return;
  }

  const body = smsBody(order);
  for (const recipient of recipients) {
    const form = new URLSearchParams({
      To: recipient,
      Body: body,
    });
    if (messagingServiceSid) {
      form.set("MessagingServiceSid", messagingServiceSid);
    } else if (fromNumber) {
      form.set("From", fromNumber);
    }

    const response = await fetchWithTimeout(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: twilioAuthHeader(accountSid, authToken),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
      TWILIO_TIMEOUT_MS,
    );

    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      console.error(
        `[admin-order-notifications] SMS notification failed for ${order.orderId}: HTTP ${response.status} ${JSON.stringify(json)?.slice(0, 500)}`,
      );
      continue;
    }

    console.info(
      `[admin-order-notifications] SMS notification accepted for ${order.orderId}: sid=${stringValue(json?.sid) || "unknown"} status=${stringValue(json?.status) || "unknown"}.`,
    );
  }
}

async function notifyAdminSubmittedOrder(order: SubmittedOrderNotification) {
  const results = await Promise.allSettled([
    notifySlackSubmittedOrder(order),
    notifySmsSubmittedOrder(order),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(
        `[admin-order-notifications] Submitted order notification failed for ${order.orderId}:`,
        result.reason,
      );
    }
  }
}

export async function notifyAdminOttoAuthOrderSubmitted(
  order: OttoAuthOrderRecord,
) {
  await notifyAdminSubmittedOrder(ottoauthOrderNotification(order));
}

export async function notifyAdminGenericOrderSubmitted(
  task: GenericBrowserTaskRecord,
) {
  await notifyAdminSubmittedOrder(genericOrderNotification(task));
}

export async function notifyAdminAmazonOrderSubmitted(order: AmazonOrderRecord) {
  await notifyAdminSubmittedOrder(amazonOrderNotification(order));
}

export async function notifyAdminSnackpassOrderSubmitted(
  order: SnackpassOrderRecord,
) {
  await notifyAdminSubmittedOrder(snackpassOrderNotification(order));
}
