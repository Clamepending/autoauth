import type { ServiceManifest } from "@/services/_shared/types";
import { getBaseUrl } from "@/lib/base-url";

export function getManifest(): ServiceManifest {
  const baseUrl = getBaseUrl();
  return {
    id: "amazon",
    name: "Amazon",
    description: "Shop and order via Amazon",
    category: "commerce",
    status: "active",
    endpoints: [
      {
        method: "POST",
        path: "/api/services/amazon/buy",
        description: "Place an Amazon order",
        params: {
          username: {
            type: "string",
            required: true,
            description: "Your agent username",
          },
          private_key: {
            type: "string",
            required: true,
            description: "Your agent private key",
          },
          item_url: {
            type: "string",
            required: true,
            description: "Full URL to the Amazon product page",
          },
          shipping_location: {
            type: "string",
            required: true,
            description: "Shipping address or description",
          },
        },
      },
      {
        method: "POST",
        path: "/api/services/amazon/history",
        description: "List your Amazon orders",
        params: {
          username: {
            type: "string",
            required: true,
            description: "Your agent username",
          },
          private_key: {
            type: "string",
            required: true,
            description: "Your agent private key",
          },
        },
      },
    ],
    docsMarkdown: `# Amazon — Shop and order via Amazon

## Overview

This service lets agents place Amazon orders and view order history. All requests require agent \`username\` and \`private_key\` (your agent password).

The price is automatically scraped from the Amazon product page when you place an order. If scraping fails, the order is still created and a human will determine the price.

## Endpoints

### Buy (place order)

\`\`\`
POST ${baseUrl}/api/services/amazon/buy
Content-Type: application/json
\`\`\`

**Body:**
- \`username\` (string) — your agent username
- \`private_key\` (string) — your agent private key
- \`item_url\` (string) — full URL to the Amazon product page
- \`shipping_location\` (string) — shipping address or description

**Response:**
- \`order_id\` — the order ID
- \`payment_url\` — send this link to your human for payment
- \`estimated_price\` — scraped price (or null if scraping failed)
- \`product_title\` — product name (or null if scraping failed)

### History (list orders)

\`\`\`
POST ${baseUrl}/api/services/amazon/history
Content-Type: application/json
\`\`\`

**Body:**
- \`username\` (string) — your agent username
- \`private_key\` (string) — your agent private key

**Response:** List of orders with \`id\`, \`item_url\`, \`shipping_location\`, \`status\`, \`estimated_price\`, \`product_title\`, \`created_at\`.
`,
  };
}
