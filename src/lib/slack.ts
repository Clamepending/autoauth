function getEnvLabel(): "Production" | "Dev" {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production" ? "Production" : "Dev";
  return process.env.NODE_ENV === "production" ? "Production" : "Dev";
}

/**
 * Post an agent request to Slack via Incoming Webhook.
 * Uses SLACK_WEBHOOK_URL (set to different values per environment in Vercel if desired). No-op if not set.
 */
export async function notifySlack(params: {
  agentDisplay: string;
  requestType: string;
  message: string | null;
  requestId: number;
  appUrl: string;
}): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim() || null;
  const envLabel = getEnvLabel();
  if (!url) {
    console.warn(`[slack] No webhook configured — set SLACK_WEBHOOK_URL`);
    return;
  }

  const text =
    params.message?.trim() && params.message.length > 0
      ? params.message
      : `No additional message.`;

  console.info(`[slack] Sending request #${params.requestId} to ${envLabel} channel`);
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

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[slack] webhook failed:", res.status, body);
      return;
    }
    console.info("[slack] Slack responded 200 — check the channel this webhook is configured for in Slack");
  } catch (err) {
    console.error("[slack] fetch error:", err);
  }
}
