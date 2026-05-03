import type { GenericBrowserTaskRecord } from "@/lib/generic-browser-tasks";

type OrderConfirmationRecipient = {
  email: string;
  displayName?: string | null;
};

type SendOrderConfirmationEmailParams = {
  recipient: OrderConfirmationRecipient;
  task: GenericBrowserTaskRecord;
};

function canonicalBaseUrl() {
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL_URL?.trim()) {
    return `https://${process.env.VERCEL_URL.trim()}`.replace(/\/$/, "");
  }
  return process.env.NODE_ENV === "production"
    ? "https://ottoauth.vercel.app"
    : "http://127.0.0.1:3000";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCents(value: number | null) {
  return value == null ? null : `$${(value / 100).toFixed(2)}`;
}

function buildEmailContent(params: SendOrderConfirmationEmailParams) {
  const orderUrl = `${canonicalBaseUrl()}/orders/${params.task.id}`;
  const title = params.task.task_title?.trim() || `Order #${params.task.id}`;
  const recipientName = params.recipient.displayName?.trim() || params.recipient.email;
  const merchant =
    params.task.merchant?.trim() ||
    params.task.website_url?.trim() ||
    "To be determined";
  const source =
    params.task.submission_source === "human"
      ? "OttoAuth dashboard"
      : "linked agent";
  const maxCharge = formatCents(params.task.max_charge_cents);
  const subject = `OttoAuth received: ${title}`;
  const websiteLine = params.task.website_url
    ? `Preferred website: ${params.task.website_url}\n`
    : "";
  const maxChargeLine = maxCharge ? `Spend cap: ${maxCharge}\n` : "";
  const shippingLine = params.task.shipping_address
    ? `Shipping address provided:\n${params.task.shipping_address}\n\n`
    : "";

  const text = `Hi ${recipientName},

We received your OttoAuth order and queued it for browser fulfillment.

Order: ${title}
Merchant: ${merchant}
Submitted from: ${source}
Status: queued
${maxChargeLine}${websiteLine}${shippingLine}Order instructions:
${params.task.task_prompt}

Track the order here:
${orderUrl}
`;

  const html = `<p>Hi ${escapeHtml(recipientName)},</p>
<p>We received your OttoAuth order and queued it for browser fulfillment.</p>
<p><strong>Order:</strong> ${escapeHtml(title)}<br />
<strong>Merchant:</strong> ${escapeHtml(merchant)}<br />
<strong>Submitted from:</strong> ${escapeHtml(source)}<br />
<strong>Status:</strong> queued${maxCharge ? `<br />\n<strong>Spend cap:</strong> ${escapeHtml(maxCharge)}` : ""}</p>
${params.task.website_url ? `<p><strong>Preferred website:</strong> <a href="${escapeHtml(params.task.website_url)}">${escapeHtml(params.task.website_url)}</a></p>` : ""}
${params.task.shipping_address ? `<p><strong>Shipping address provided:</strong><br />${escapeHtml(params.task.shipping_address).replace(/\n/g, "<br />")}</p>` : ""}
<p><strong>Order instructions:</strong><br />${escapeHtml(params.task.task_prompt).replace(/\n/g, "<br />")}</p>
<p><a href="${escapeHtml(orderUrl)}">Open the OttoAuth order page</a></p>`;

  return {
    orderUrl,
    subject,
    text,
    html,
  };
}

export async function sendOrderConfirmationEmail(
  params: SendOrderConfirmationEmailParams,
) {
  const webhookUrl =
    process.env.OTTOAUTH_ORDER_CONFIRMATION_EMAIL_WEBHOOK_URL?.trim() ||
    process.env.OTTOAUTH_EMAIL_WEBHOOK_URL?.trim() ||
    process.env.OTTOAUTH_COMPLETION_EMAIL_WEBHOOK_URL?.trim();
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.OTTOAUTH_FROM_EMAIL?.trim();
  const content = buildEmailContent(params);

  if (webhookUrl) {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: "ottoauth.order.created",
        to: params.recipient.email,
        subject: content.subject,
        text: content.text,
        html: content.html,
        task_id: params.task.id,
        order_url: content.orderUrl,
      }),
    });
    if (!response.ok) {
      throw new Error(`Confirmation email webhook failed with HTTP ${response.status}.`);
    }
    return { ok: true, provider: "webhook" as const };
  }

  if (resendApiKey && fromEmail) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [params.recipient.email],
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Resend confirmation email failed with HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`,
      );
    }
    return { ok: true, provider: "resend" as const };
  }

  console.warn(
    `[order-confirmation-email] Skipping email for task ${params.task.id}; OTTOAUTH_ORDER_CONFIRMATION_EMAIL_WEBHOOK_URL, OTTOAUTH_EMAIL_WEBHOOK_URL, OTTOAUTH_COMPLETION_EMAIL_WEBHOOK_URL, or RESEND_API_KEY + OTTOAUTH_FROM_EMAIL are not configured.`,
  );
  return { ok: true, skipped: "unconfigured" as const };
}
