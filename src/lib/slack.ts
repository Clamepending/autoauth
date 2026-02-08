function isProduction(): boolean {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return process.env.NODE_ENV === "production";
}

/** Webhook for production channel; dev/preview use SLACK_WEBHOOK_URL_DEV. */
function getSlackWebhookUrl(): string | null {
  const url = isProduction()
    ? process.env.SLACK_WEBHOOK_URL
    : process.env.SLACK_WEBHOOK_URL_DEV;
  return url?.trim() || null;
}

/**
 * Post an agent request to Slack via Incoming Webhook.
 * Production → SLACK_WEBHOOK_URL; dev/preview → SLACK_WEBHOOK_URL_DEV. No-op if none set.
 */
export async function notifySlack(params: {
  agentDisplay: string;
  requestType: string;
  message: string | null;
  requestId: number;
  appUrl: string;
}): Promise<void> {
  const url = getSlackWebhookUrl();
  if (!url) return;

  const text =
    params.message?.trim() && params.message.length > 0
      ? params.message
      : `No additional message.`;

  const envLabel = isProduction() ? "Production" : "Dev";
  const payload = {
    text: "New autoauth request for human fulfillment",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `New agent request (${envLabel})`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Agent:*\n${params.agentDisplay}` },
          { type: "mrkdwn", text: `*Type:*\n${params.requestType}` },
          { type: "mrkdwn", text: `*Request ID:*\n#${params.requestId}` },
          { type: "mrkdwn", text: `*App:*\n<${params.appUrl}|autoauth>` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Message from agent:*\n${text}` },
      },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("[slack] webhook failed:", res.status, await res.text());
  }
}
