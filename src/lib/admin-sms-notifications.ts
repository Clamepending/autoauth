import type { OrderStatus, OttoAuthOrderRecord } from "@/lib/order-orchestration";

type AdminSmsSkipReason =
  | "status_not_configured"
  | "missing_recipients"
  | "missing_twilio_credentials"
  | "missing_twilio_sender";

export type AdminOrderSmsResult =
  | { ok: true; sent: number }
  | { ok: false; sent: number; skipped?: AdminSmsSkipReason; error?: string; status?: number };

const DEFAULT_ADMIN_SMS_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "human_required",
  "quote_requested",
  "awaiting_approval",
  "blocked",
  "failed",
  "disputed",
]);

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parseRecipients(raw: string | null) {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseStatusConfig(raw: string | null) {
  if (!raw) return DEFAULT_ADMIN_SMS_STATUSES;
  if (raw.trim().toLowerCase() === "all") return "all" as const;
  const statuses = raw
    .split(/[,;\s]+/)
    .map((value) => value.trim())
    .filter(Boolean) as OrderStatus[];
  return new Set(statuses);
}

function shouldNotifyForStatus(status: OrderStatus) {
  const configured = parseStatusConfig(envValue("OTTOAUTH_ADMIN_SMS_STATUSES"));
  return configured === "all" || configured.has(status);
}

function parseJsonObject(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nestedRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function displayTitle(order: OttoAuthOrderRecord) {
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

function pricingSummary(order: OttoAuthOrderRecord) {
  const request = parseJsonObject(order.request_json);
  const pricing = nestedRecord(request?.pricing);
  const displayTotal =
    typeof pricing?.display_total_cents === "number" ? pricing.display_total_cents : null;
  const state = stringValue(pricing?.state);
  if (order.quoted_total_cents != null) {
    return `quote ${formatCents(order.quoted_total_cents, order.currency)}`;
  }
  if (displayTotal != null && displayTotal > 0) {
    return `${state === "spend_limit_only" ? "limit" : "est"} ${formatCents(displayTotal, order.currency)}`;
  }
  if (order.max_charge_cents != null) {
    return `cap ${formatCents(order.max_charge_cents, order.currency)}`;
  }
  return "no cap";
}

function formatCents(cents: number, currency: string) {
  const amount = Math.max(0, Math.trunc(cents)) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "usd",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

function adminBaseUrl() {
  const explicit = envValue("NEXT_PUBLIC_APP_URL") || envValue("APP_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const vercelUrl = envValue("VERCEL_URL");
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/$/, "");
  return process.env.NODE_ENV === "production" ? "https://ottoauth.vercel.app" : "http://localhost:3000";
}

function truncateLine(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, Math.max(0, maxLength - 1))}...`;
}

function buildAdminOrderSmsBody(order: OttoAuthOrderRecord) {
  const orderRef = order.public_id || `ord_${order.id}`;
  const provider = truncateLine(order.provider_label || order.provider_id || "Unknown provider", 48);
  const title = truncateLine(displayTitle(order), 96);
  const price = pricingSummary(order);
  const url = `${adminBaseUrl()}/admindash/fulfillment/${encodeURIComponent(orderRef)}`;
  return [
    `OttoAuth: ${order.status} ${orderRef}`,
    `${provider} - ${price}`,
    title,
    url,
  ].join("\n");
}

async function sendTwilioMessage(params: {
  accountSid: string;
  authToken: string;
  fromNumber: string | null;
  messagingServiceSid: string | null;
  to: string;
  body: string;
}) {
  const form = new URLSearchParams({
    To: params.to,
    Body: params.body,
  });
  if (params.messagingServiceSid) {
    form.set("MessagingServiceSid", params.messagingServiceSid);
  } else if (params.fromNumber) {
    form.set("From", params.fromNumber);
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(params.accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${params.accountSid}:${params.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      error: `Twilio returned HTTP ${response.status}`,
    };
  }
  return { ok: true as const };
}

export async function sendAdminOrderSms(order: OttoAuthOrderRecord): Promise<AdminOrderSmsResult> {
  if (!shouldNotifyForStatus(order.status)) {
    return { ok: false, sent: 0, skipped: "status_not_configured" };
  }

  const recipients = parseRecipients(envValue("OTTOAUTH_ADMIN_SMS_TO"));
  if (!recipients.length) {
    return { ok: false, sent: 0, skipped: "missing_recipients" };
  }

  const accountSid = envValue("TWILIO_ACCOUNT_SID");
  const authToken = envValue("TWILIO_AUTH_TOKEN");
  if (!accountSid || !authToken) {
    return { ok: false, sent: 0, skipped: "missing_twilio_credentials" };
  }

  const fromNumber = envValue("TWILIO_FROM_NUMBER");
  const messagingServiceSid = envValue("TWILIO_MESSAGING_SERVICE_SID");
  if (!fromNumber && !messagingServiceSid) {
    return { ok: false, sent: 0, skipped: "missing_twilio_sender" };
  }

  const body = buildAdminOrderSmsBody(order);
  let sent = 0;
  for (const to of recipients) {
    const result = await sendTwilioMessage({
      accountSid,
      authToken,
      fromNumber,
      messagingServiceSid,
      to,
      body,
    });
    if (!result.ok) {
      return { ok: false, sent, status: result.status, error: result.error };
    }
    sent += 1;
  }
  return { ok: true, sent };
}
