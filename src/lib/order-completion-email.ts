import type { GenericBrowserTaskRecord } from "@/lib/generic-browser-tasks";

type OrderCompletionRecipient = {
  email: string;
  displayName?: string | null;
};

type SendOrderCompletionEmailParams = {
  recipient: OrderCompletionRecipient;
  task: GenericBrowserTaskRecord;
  remainingCreditsCents: number;
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

function buildEmailContent(params: SendOrderCompletionEmailParams) {
  const orderUrl = `${canonicalBaseUrl()}/orders/${params.task.id}`;
  const summary =
    params.task.summary?.trim() ||
    params.task.error?.trim() ||
    params.task.task_title?.trim() ||
    `Task #${params.task.id}`;
  const title = params.task.task_title?.trim() || `Task #${params.task.id}`;
  const recipientName = params.recipient.displayName?.trim() || params.recipient.email;
  const totalDebited = `$${(params.task.total_cents / 100).toFixed(2)}`;
  const remainingCredits = `$${(params.remainingCreditsCents / 100).toFixed(2)}`;
  const merchant = params.task.merchant?.trim() || "Not specified";
  const subject = `OttoAuth completed: ${title}`;
  const pickup = params.task.pickup_details;
  const tracking = params.task.tracking_details;

  const websiteLine = params.task.website_url
    ? `Preferred website: ${params.task.website_url}\n`
    : "";
  const shippingLine = params.task.shipping_address
    ? `Shipping address used:\n${params.task.shipping_address}\n\n`
    : "";
  const pickupLines = pickup
    ? [
        pickup.order_number ? `Order number: ${pickup.order_number}` : null,
        pickup.confirmation_code ? `Confirmation code: ${pickup.confirmation_code}` : null,
        pickup.pickup_code ? `Pickup code: ${pickup.pickup_code}` : null,
        pickup.ready_time ? `Ready time: ${pickup.ready_time}` : null,
        pickup.pickup_name ? `Pickup name: ${pickup.pickup_name}` : null,
        pickup.order_reference ? `Order reference: ${pickup.order_reference}` : null,
        pickup.instructions ? `Pickup instructions: ${pickup.instructions}` : null,
        pickup.receipt_url ? `Receipt URL: ${pickup.receipt_url}` : null,
        pickup.receipt_text ? `Receipt details:\n${pickup.receipt_text}` : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n")
    : "";
  const trackingLines = tracking
    ? [
        tracking.tracking_number ? `Tracking number: ${tracking.tracking_number}` : null,
        tracking.tracking_url ? `Tracking URL: ${tracking.tracking_url}` : null,
        tracking.carrier ? `Carrier: ${tracking.carrier}` : null,
        tracking.status ? `Tracking status: ${tracking.status}` : null,
        tracking.delivery_eta ? `Delivery ETA: ${tracking.delivery_eta}` : null,
        tracking.delivery_window ? `Delivery window: ${tracking.delivery_window}` : null,
        tracking.instructions ? `Delivery instructions: ${tracking.instructions}` : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n")
    : "";
  const pickupTextSection = pickupLines ? `${pickupLines}\n\n` : "";
  const trackingTextSection = trackingLines ? `${trackingLines}\n\n` : "";
  const pickupHtmlRows = pickup
    ? [
        pickup.order_number
          ? `<strong>Order number:</strong> ${escapeHtml(pickup.order_number)}<br />`
          : "",
        pickup.confirmation_code
          ? `<strong>Confirmation code:</strong> ${escapeHtml(pickup.confirmation_code)}<br />`
          : "",
        pickup.pickup_code
          ? `<strong>Pickup code:</strong> ${escapeHtml(pickup.pickup_code)}<br />`
          : "",
        pickup.ready_time
          ? `<strong>Ready time:</strong> ${escapeHtml(pickup.ready_time)}<br />`
          : "",
        pickup.pickup_name
          ? `<strong>Pickup name:</strong> ${escapeHtml(pickup.pickup_name)}<br />`
          : "",
        pickup.order_reference
          ? `<strong>Order reference:</strong> ${escapeHtml(pickup.order_reference)}<br />`
          : "",
        pickup.instructions
          ? `<strong>Pickup instructions:</strong> ${escapeHtml(pickup.instructions)}<br />`
          : "",
        pickup.receipt_url
          ? `<strong>Receipt URL:</strong> <a href="${escapeHtml(pickup.receipt_url)}">${escapeHtml(pickup.receipt_url)}</a><br />`
          : "",
        pickup.receipt_text
          ? `<strong>Receipt details:</strong><br />${escapeHtml(pickup.receipt_text).replace(/\n/g, "<br />")}<br />`
          : "",
      ]
        .filter(Boolean)
        .join("")
    : "";
  const trackingHtmlRows = tracking
    ? [
        tracking.tracking_number
          ? `<strong>Tracking number:</strong> ${escapeHtml(tracking.tracking_number)}<br />`
          : "",
        tracking.tracking_url
          ? `<strong>Tracking URL:</strong> <a href="${escapeHtml(tracking.tracking_url)}">${escapeHtml(tracking.tracking_url)}</a><br />`
          : "",
        tracking.carrier
          ? `<strong>Carrier:</strong> ${escapeHtml(tracking.carrier)}<br />`
          : "",
        tracking.status
          ? `<strong>Tracking status:</strong> ${escapeHtml(tracking.status)}<br />`
          : "",
        tracking.delivery_eta
          ? `<strong>Delivery ETA:</strong> ${escapeHtml(tracking.delivery_eta)}<br />`
          : "",
        tracking.delivery_window
          ? `<strong>Delivery window:</strong> ${escapeHtml(tracking.delivery_window)}<br />`
          : "",
        tracking.instructions
          ? `<strong>Delivery instructions:</strong> ${escapeHtml(tracking.instructions)}<br />`
          : "",
      ]
        .filter(Boolean)
        .join("")
    : "";

  const text = `Hi ${recipientName},

Your OttoAuth task has completed.

Task: ${title}
Summary: ${summary}
Merchant: ${merchant}
Total debited: ${totalDebited}
Remaining credits: ${remainingCredits}
${websiteLine}${shippingLine}${pickupTextSection}${trackingTextSection}View the full run and live screenshots here:
${orderUrl}
`;

  const html = `<p>Hi ${escapeHtml(recipientName)},</p>
<p>Your OttoAuth task has completed.</p>
<p><strong>Task:</strong> ${escapeHtml(title)}<br />
<strong>Summary:</strong> ${escapeHtml(summary)}<br />
<strong>Merchant:</strong> ${escapeHtml(merchant)}<br />
<strong>Total debited:</strong> ${escapeHtml(totalDebited)}<br />
<strong>Remaining credits:</strong> ${escapeHtml(remainingCredits)}</p>
${params.task.website_url ? `<p><strong>Preferred website:</strong> <a href="${escapeHtml(params.task.website_url)}">${escapeHtml(params.task.website_url)}</a></p>` : ""}
${params.task.shipping_address ? `<p><strong>Shipping address used:</strong><br />${escapeHtml(params.task.shipping_address).replace(/\n/g, "<br />")}</p>` : ""}
${pickupHtmlRows ? `<p>${pickupHtmlRows}</p>` : ""}
${trackingHtmlRows ? `<p>${trackingHtmlRows}</p>` : ""}
<p><a href="${escapeHtml(orderUrl)}">Open the OttoAuth order page</a></p>`;

  return {
    orderUrl,
    subject,
    text,
    html,
  };
}

export async function sendOrderCompletionEmail(
  params: SendOrderCompletionEmailParams,
) {
  if (params.task.status !== "completed") {
    return { ok: true, skipped: "task_not_completed" as const };
  }

  const webhookUrl = process.env.OTTOAUTH_COMPLETION_EMAIL_WEBHOOK_URL?.trim();
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
        to: params.recipient.email,
        subject: content.subject,
        text: content.text,
        html: content.html,
        task_id: params.task.id,
        order_url: content.orderUrl,
      }),
    });
    if (!response.ok) {
      throw new Error(`Completion email webhook failed with HTTP ${response.status}.`);
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
        `Resend completion email failed with HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`,
      );
    }
    return { ok: true, provider: "resend" as const };
  }

  console.warn(
    `[order-completion-email] Skipping email for task ${params.task.id}; OTTOAUTH_COMPLETION_EMAIL_WEBHOOK_URL or RESEND_API_KEY + OTTOAUTH_FROM_EMAIL are not configured.`,
  );
  return { ok: true, skipped: "unconfigured" as const };
}
