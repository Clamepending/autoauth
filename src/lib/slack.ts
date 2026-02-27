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
    text: "New ottoauth request for human fulfillment",
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
          { type: "mrkdwn", text: `*App:*\n<${params.appUrl}|ottoauth>` },
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

export async function notifySlackAmazonFulfillment(params: {
  orderId: number;
  username: string;
  productTitle: string | null;
  itemUrl: string;
  shippingLocation: string;
  estimatedTotal: string | null;
  appUrl: string;
}): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim() || null;
  const envLabel = getEnvLabel();
  if (!url) {
    console.warn(`[slack] No webhook configured — set SLACK_WEBHOOK_URL`);
    return;
  }

  const orderLink = `${params.appUrl}/admindash/amazon/orders/${params.orderId}`;
  const title = params.productTitle?.trim() || "Amazon order";
  const totalText = params.estimatedTotal ?? "Unknown";

  const payload = {
    text: "Amazon order ready for manual fulfillment",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Amazon paid order (${envLabel})`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Order ID:*\n#${params.orderId}` },
          { type: "mrkdwn", text: `*Agent:*\n${params.username}` },
          { type: "mrkdwn", text: `*Total:*\n${totalText}` },
          { type: "mrkdwn", text: `*Shipping:*\n${params.shippingLocation}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Item:*\n${title}\n<${params.itemUrl}|Open product page>`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<${orderLink}|Open fulfillment page>`,
        },
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
      console.error("[slack] amazon webhook failed:", res.status, body);
    }
  } catch (err) {
    console.error("[slack] amazon webhook fetch error:", err);
  }
}

export async function notifySlackSnackpassFulfillment(params: {
  orderId: number;
  username: string;
  dishName: string;
  restaurantName: string;
  orderType: string;
  shippingLocation: string;
  tipDisplay: string | null;
  estimatedTotal: string | null;
  appUrl: string;
}): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim() || null;
  const envLabel = getEnvLabel();
  if (!url) {
    console.warn(`[slack] No webhook configured — set SLACK_WEBHOOK_URL`);
    return;
  }

  const orderLink = `${params.appUrl}/admindash/snackpass/orders/${params.orderId}`;
  const totalText = params.estimatedTotal ?? "Unknown";

  const payload = {
    text: "Snackpass order ready for manual fulfillment",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Snackpass paid order (${envLabel})`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Order ID:*\n#${params.orderId}` },
          { type: "mrkdwn", text: `*Agent:*\n${params.username}` },
          { type: "mrkdwn", text: `*Total:*\n${totalText}` },
          { type: "mrkdwn", text: `*Type:*\n${params.orderType}` },
        ],
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Dish:*\n${params.dishName}` },
          { type: "mrkdwn", text: `*Restaurant:*\n${params.restaurantName}` },
          { type: "mrkdwn", text: `*Pickup/Delivery:*\n${params.shippingLocation}` },
          { type: "mrkdwn", text: `*Tip:*\n${params.tipDisplay ?? "None"}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<${orderLink}|Open fulfillment page>`,
        },
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
      console.error("[slack] snackpass webhook failed:", res.status, body);
    }
  } catch (err) {
    console.error("[slack] snackpass webhook fetch error:", err);
  }
}
