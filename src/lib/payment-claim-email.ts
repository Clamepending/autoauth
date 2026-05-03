import type { HumanCreditClaimRecord, HumanUserRecord } from "@/lib/human-accounts";

type SendPendingCreditClaimEmailParams = {
  claim: HumanCreditClaimRecord;
  sender: HumanUserRecord;
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

function buildEmailContent(params: SendPendingCreditClaimEmailParams) {
  const amount = `$${(params.claim.amount_cents / 100).toFixed(2)}`;
  const senderLabel =
    params.sender.display_name?.trim() ||
    `@${params.sender.handle_display}`;
  const loginUrl = `${canonicalBaseUrl()}/login?returnTo=${encodeURIComponent("/dashboard")}`;
  const expiresAt = new Date(params.claim.expires_at);
  const expiresLabel = Number.isFinite(expiresAt.getTime())
    ? expiresAt.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Los_Angeles",
      })
    : "one week from when it was sent";
  const subject = `${senderLabel} sent you ${amount} on OttoAuth`;
  const text = `${senderLabel} sent ${amount} to you on OttoAuth.

Note: ${params.claim.note}

This claim expires in one week, on ${expiresLabel}.

Sign up or sign in with ${params.claim.recipient_email} to claim your money:
${loginUrl}

Claim id: ${params.claim.claim_public_id}
`;

  const html = `<p>${escapeHtml(senderLabel)} sent <strong>${escapeHtml(amount)}</strong> to you on OttoAuth.</p>
<p><strong>Note:</strong> ${escapeHtml(params.claim.note)}</p>
<p>This claim expires in one week, on ${escapeHtml(expiresLabel)}.</p>
<p><a href="${escapeHtml(loginUrl)}">Sign up or sign in with ${escapeHtml(params.claim.recipient_email)} to claim your money</a>.</p>
<p style="color:#666;font-size:12px;">Claim id: ${escapeHtml(params.claim.claim_public_id)}</p>`;

  return {
    subject,
    text,
    html,
    loginUrl,
  };
}

export async function sendPendingCreditClaimEmail(
  params: SendPendingCreditClaimEmailParams,
) {
  const webhookUrl =
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
        to: params.claim.recipient_email,
        subject: content.subject,
        text: content.text,
        html: content.html,
        claim_id: params.claim.claim_public_id,
        claim_url: content.loginUrl,
        expires_at: params.claim.expires_at,
      }),
    });
    if (!response.ok) {
      throw new Error(`Credit claim email webhook failed with HTTP ${response.status}.`);
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
        to: [params.claim.recipient_email],
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Resend credit claim email failed with HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`,
      );
    }
    return { ok: true, provider: "resend" as const };
  }

  console.warn(
    `[payment-claim-email] Skipping email for claim ${params.claim.claim_public_id}; OTTOAUTH_EMAIL_WEBHOOK_URL or RESEND_API_KEY + OTTOAUTH_FROM_EMAIL are not configured.`,
  );
  return { ok: true, skipped: "unconfigured" as const };
}
