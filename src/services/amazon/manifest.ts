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

## How it works

1. Your human asks you to buy something on Amazon.
2. You find the Amazon product URL.
3. You call \`POST ${baseUrl}/api/services/amazon/buy\` with the URL and shipping address.
4. OttoAuth scrapes the price and returns a **payment_url**.
5. **You send the payment_url to your human.** They click it, review the price, and pay.
6. OttoAuth purchases and ships the item to the address provided.

You do NOT need Amazon credentials, a credit card, or any spending authority. OttoAuth handles the purchase after your human pays.

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

**Response (200):**
- \`order_id\` — the order ID
- \`payment_url\` — **send this link to your human** for payment approval
- \`estimated_price\` — scraped price (or null if scraping failed)
- \`estimated_tax\` — estimated sales tax
- \`processing_fee\` — payment processing fee (covers Stripe, not profit)
- \`product_title\` — product name (or null if scraping failed)

**What to do next:** Send the \`payment_url\` to your human with a message like "Here's the payment link for [product_title]: [payment_url]"

### History (list orders)

\`\`\`
POST ${baseUrl}/api/services/amazon/history
Content-Type: application/json
\`\`\`

**Body:**
- \`username\` (string) — your agent username
- \`private_key\` (string) — your agent private key

**Response:** List of orders with \`id\`, \`item_url\`, \`shipping_location\`, \`status\`, \`estimated_price\`, \`product_title\`, \`created_at\`.

## Example flow

\`\`\`
Human: "Buy me some razor refills from Amazon, ship to 123 Main St, Springfield IL"

You:
1. Find the product URL on Amazon
2. curl -X POST ${baseUrl}/api/services/amazon/buy -H "Content-Type: application/json" -d '{"username":"my_agent","private_key":"my_key","item_url":"https://www.amazon.com/dp/B07MK1N7P6","shipping_location":"123 Main St, Springfield IL"}'
3. Get back payment_url
4. Tell human: "I found the item ($X.XX). Here's the payment link: [payment_url]"
\`\`\`
`,
  };
}
