import type { ServiceManifest } from "@/services/_shared/types";
import { getBaseUrl } from "@/lib/base-url";

export function getManifest(): ServiceManifest {
  const baseUrl = getBaseUrl();
  return {
    id: "amazon",
    name: "Amazon",
    description: "Price and buy physical goods on Amazon from a product URL",
    category: "commerce",
    status: "active",
    endpoints: [
      {
        name: "buy",
        method: "POST",
        path: "/api/services/amazon/buy",
        description: "Place an Amazon order (browser agent gets real price, then you pay)",
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
          shipping_address: {
            type: "string",
            required: true,
            description: "Full shipping address (street, city, state, zip)",
          },
        },
      },
      {
        name: "order_status",
        method: "GET",
        path: "/api/services/amazon/orders/:orderId",
        description: "Check the status of an Amazon order",
        params: {
          orderId: {
            type: "number",
            required: true,
            description: "The order ID returned by /buy",
          },
        },
      },
      {
        name: "history",
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
    docsMarkdown: `# Amazon — Buy physical goods from product URLs

## Agent-first discovery

For machine-readable tool discovery, first call \`GET ${baseUrl}/api/services\`, then call \`GET ${baseUrl}/api/services/amazon\`. This page is the human-readable reference.

## How it works

1. Your human asks you to buy something on Amazon.
2. You find the Amazon product URL.
3. You call \`POST ${baseUrl}/api/services/amazon/buy\` with the URL and shipping address.
4. A browser agent navigates Amazon to get the **real price** (including shipping and tax).
5. Once pricing is ready, the order status changes to \`pending_payment\` with a **payment_url**.
6. **You send the payment_url to your human.** They click it, review the price, and pay.
7. After payment, a browser agent automatically completes the Amazon purchase.
8. The order status changes to \`Fulfilled\` with a confirmation number.

Poll \`GET ${baseUrl}/api/services/amazon/orders/:orderId\` to check order status at any time.

You do NOT need Amazon credentials, a credit card, or any spending authority. OttoAuth handles the purchase after your human pays.

Amazon search is not exposed as a hosted callable tool yet. Use your own search method, ask the human for the product URL, or submit a structured browser task through \`computeruse\` if the human wants OttoAuth to search in a browser.

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
- \`shipping_address\` (string) — full shipping address (street, city, state, zip)

**Response (200):**
- \`order_id\` — the order ID
- \`status\` — \`"pending_price"\` (browser agent is checking real Amazon price)
- \`phase1_task_id\` — the browser task ID for price discovery
- \`message\` — next steps

**What to do next:** Poll \`GET ${baseUrl}/api/services/amazon/orders/:orderId\` until status is \`pending_payment\`, then send the \`payment_url\` to your human.

### Order Status

\`\`\`
GET ${baseUrl}/api/services/amazon/orders/:orderId
\`\`\`

**Response:** Full order details including \`status\`, \`payment_url\` (when pending_payment), \`confirmation_number\` (when fulfilled), etc.

**Statuses:** \`pending_price\` → \`pending_payment\` → \`Paid\` → \`fulfilling\` → \`Fulfilled\`

### History (list orders)

\`\`\`
POST ${baseUrl}/api/services/amazon/history
Content-Type: application/json
\`\`\`

**Body:**
- \`username\` (string) — your agent username
- \`private_key\` (string) — your agent private key

**Response:** List of orders.

## Example flow

\`\`\`
Human: "Buy me some razor refills from Amazon, ship to 123 Main St, Springfield IL 62701"

You:
1. Find the product URL on Amazon
2. POST ${baseUrl}/api/services/amazon/buy with item_url and shipping_address
3. Get back order_id and status "pending_price"
4. Poll GET ${baseUrl}/api/services/amazon/orders/{order_id} every ~10 seconds
5. When status is "pending_payment", get the payment_url
6. Tell human: "The item costs $X.XX. Here's the payment link: [payment_url]"
7. After human pays, the order is automatically fulfilled
8. Poll again for status "Fulfilled" to get confirmation_number
\`\`\`
`,
  };
}
