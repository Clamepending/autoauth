import type { ServiceManifest } from "@/services/_shared/types";
import { getBaseUrl } from "@/lib/base-url";

export function getManifest(): ServiceManifest {
  const baseUrl = getBaseUrl();
  return {
    id: "snackpass",
    name: "Snackpass",
    description: "Order food from a curated Snackpass menu",
    category: "commerce",
    status: "active",
    endpoints: [
      {
        method: "POST",
        path: "/api/services/snackpass/order",
        description: "Place a Snackpass order and receive a payment link",
        params: {
          username: { type: "string", required: true, description: "Your agent username" },
          private_key: { type: "string", required: true, description: "Your agent private key" },
          dish_name: { type: "string", required: true, description: "Dish name (e.g., Pollo Asado Burrito)" },
          restaurant_name: { type: "string", required: false, description: "Restaurant name (recommended if multiple matches)" },
          shipping_location: { type: "string", required: true, description: "Pickup or delivery instructions/address" },
          order_type: { type: "string", required: false, description: "pickup (default) or delivery" },
          tip_cents: { type: "number", required: false, description: "Optional tip in cents" },
          delivery_instructions: { type: "string", required: false, description: "Optional delivery notes" },
        },
      },
      {
        method: "POST",
        path: "/api/services/snackpass/history",
        description: "List your Snackpass orders",
        params: {
          username: { type: "string", required: true, description: "Your agent username" },
          private_key: { type: "string", required: true, description: "Your agent private key" },
        },
      },
    ],
    docsMarkdown: `# Snackpass — Order food from a curated menu

## How it works

1. Your human asks you to order a dish on Snackpass.
2. You call \`POST ${baseUrl}/api/services/snackpass/order\` with the dish name and pickup/delivery info.
3. OttoAuth matches the dish from a curated menu and returns a **payment_url**.
4. **Send the payment_url to your human.** They review and pay.
5. After payment, a human operator places the Snackpass order manually.

## Important behavior (dish matching)

- If the dish name is **ambiguous**, the API will respond with a list of suggested matches and ask you to pick one.
- If the dish is **not found**, the API will create a manual request and ask you to provide more detail or wait.

## Endpoints

### Order (place order)

\`POST ${baseUrl}/api/services/snackpass/order\`

**Body:**
- \`username\` (string) — your agent username
- \`private_key\` (string) — your agent private key
- \`dish_name\` (string) — name of the dish
- \`restaurant_name\` (string, optional) — restaurant to disambiguate
- \`shipping_location\` (string) — pickup or delivery instructions
- \`order_type\` (string, optional) — \`pickup\` (default) or \`delivery\`
- \`tip_cents\` (number, optional) — tip in cents
- \`delivery_instructions\` (string, optional)

**Response (success):**
- \`order_id\`
- \`payment_url\` — send to your human
- \`estimated_price\`
- \`estimated_tax\`
- \`service_fee\`
- \`delivery_fee\`
- \`processing_fee\`
- \`estimated_total\`
- \`dish_name\`, \`restaurant_name\`

**Response (ambiguous):**
- \`matches\`: list of suggested dishes with ids and names
- \`message\`: ask for clarification

**Response (not found):**
- \`request_id\`
- \`message\`: request created; wait for manual update

### History (list orders)

\`POST ${baseUrl}/api/services/snackpass/history\`

**Body:**
- \`username\` (string)
- \`private_key\` (string)

**Response:** list of orders with status and totals.

## Example

\`\`\`
POST ${baseUrl}/api/services/snackpass/order
Content-Type: application/json

{
  "username":"my_agent",
  "private_key":"MY_PRIVATE_KEY",
  "dish_name":"Pollo Asado Burrito",
  "restaurant_name":"La Burrita",
  "shipping_location":"Pickup at 2524 Durant Ave, Berkeley",
  "order_type":"pickup",
  "tip_cents":200
}
\`\`\`

If you receive multiple matches, ask your human to pick one and retry with \`restaurant_name\` to disambiguate.
`,
  };
}
